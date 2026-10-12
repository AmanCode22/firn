// Runs inside every web page, in its own isolated world: the page's own
// scripts can't see it or call it, and it gives them nothing. It does two
// things for saved passwords (see src/passwords.ts):
// - when you sign in (submit a form with a password, press Enter in a
//   password field, or click its button), it tells Firn the username and
//   password typed;
// - when you click into a login form, it asks Firn for a saved login for
//   this site and fills it in.
// Firn checks the page's real address itself; nothing here is trusted
// about which site it is.
import { ipcRenderer } from 'electron';

type Field = HTMLInputElement;

const isVisible = (el: Element) => {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};

const passwordFields = (root: ParentNode = document) =>
  [...root.querySelectorAll<Field>('input[type=password]')].filter(isVisible);

// The username field that goes with a password field: one marked as a
// username or email, or else the last text-like field before it.
function usernameFieldFor(password: Field): Field | null {
  const scope = password.form ?? document;
  const fields = [
    ...scope.querySelectorAll<Field>(
      'input:not([type]), input[type=text], input[type=email], input[type=tel]',
    ),
  ].filter(isVisible);
  const marked = fields.find((f) =>
    /username|email/i.test(f.autocomplete || ''),
  );
  if (marked) return marked;
  const before = fields.filter(
    (f) =>
      password.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  return before.at(-1) ?? null;
}

// Two-step sign-ins ask for the email first and the password on the next
// step: remember the last username-like value typed on this page.
let lastUsername = '';
document.addEventListener(
  'change',
  (e) => {
    const el = e.target as Field;
    if (
      el instanceof HTMLInputElement &&
      /^(text|email|tel|)$/.test(el.type) &&
      (/username|email/i.test(el.autocomplete || '') ||
        /user|mail|login|account|identifier/i.test(`${el.name} ${el.id}`))
    )
      lastUsername = el.value.trim();
  },
  true,
);

// The login just typed, from a password field (or the form it's in).
function loginFrom(scope: Field | HTMLFormElement | null) {
  const fields = passwordFields(
    scope instanceof HTMLFormElement ? scope : (scope?.form ?? document),
  ).filter((f) => f.value);
  if (!fields.length) return null;
  // A change-password form: the new password is the one to keep.
  const field =
    fields.find((f) => f.autocomplete === 'new-password') ?? fields.at(-1)!;
  const username = usernameFieldFor(field)?.value.trim() || lastUsername;
  return {
    username: username.slice(0, 200),
    password: field.value.slice(0, 500),
  };
}

let lastSent = '';
function report(scope: Field | HTMLFormElement | null) {
  const login = loginFrom(scope);
  if (!login) return;
  const key = `${login.username}\n${login.password}`;
  if (key === lastSent) return;
  lastSent = key;
  ipcRenderer.send('firn-page:login', login);
}

document.addEventListener(
  'submit',
  (e) => report(e.target as HTMLFormElement),
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    const el = e.target as Field;
    if (
      e.key === 'Enter' &&
      el instanceof HTMLInputElement &&
      el.type === 'password'
    )
      report(el);
  },
  true,
);
document.addEventListener(
  'click',
  (e) => {
    const button = (e.target as Element).closest?.(
      'button, input[type=submit], input[type=button], [role=button]',
    );
    if (button && passwordFields().some((f) => f.value)) report(null);
  },
  true,
);

// Sets a field's value the way typing would, so the site's own code
// (React and the like) notices.
function fill(field: Field, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

// Only you can make Firn fill a login: by clicking into the field, or
// tabbing to it, a moment ago. A site's own script moving focus (or a
// hidden form an ad or tracker slipped in) gets nothing, the way Chrome
// guards against scripts harvesting saved passwords. Events the person
// makes are "trusted"; ones a script makes aren't.
const PERSON_WITHIN_MS = 1000;
let pressedOn: { target: EventTarget | null; at: number } = {
  target: null,
  at: 0,
};
let tabbedAt = 0;
document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.isTrusted) pressedOn = { target: e.target, at: performance.now() };
  },
  true,
);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.isTrusted && e.key === 'Tab') tabbedAt = performance.now();
  },
  true,
);
const personFocused = (el: Field) => {
  const now = performance.now();
  const clicked =
    now - pressedOn.at < PERSON_WITHIN_MS &&
    pressedOn.target instanceof Node &&
    (pressedOn.target === el ||
      el.contains(pressedOn.target) ||
      (el.labels ? [...el.labels] : []).some((l) =>
        l.contains(pressedOn.target as Node),
      ));
  return clicked || now - tabbedAt < PERSON_WITHIN_MS;
};
// Shown for real: not see-through or hidden by the page's styles.
const reallyShown = (el: Element) =>
  isVisible(el) &&
  el.checkVisibility({ opacityProperty: true, visibilityProperty: true });

// Clicking into a login form fills the saved login (once per page, and
// only into empty fields).
let filled = false;
document.addEventListener(
  'focusin',
  async (e) => {
    if (filled) return;
    const el = e.target as Field;
    if (!(el instanceof HTMLInputElement)) return;
    if (!e.isTrusted || !personFocused(el)) return;
    const password =
      el.type === 'password'
        ? el
        : passwordFields(el.form ?? document).find(
            (p) => usernameFieldFor(p) === el,
          );
    if (!password || password.value) return;
    if (!reallyShown(el) || !reallyShown(password)) return;
    filled = true;
    const login: { username: string; password: string } | null =
      await ipcRenderer.invoke('firn-page:saved-login');
    if (!login) return;
    const username = usernameFieldFor(password);
    if (username && !username.value && login.username)
      fill(username, login.username);
    fill(password, login.password);
  },
  true,
);
