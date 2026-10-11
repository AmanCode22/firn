import { useEffect, useRef, useState } from 'react';
import { SPACE_ICON_NAMES } from '../spaceIcons';
import type { Settings, SettingsState, SpacesState } from '../types';
import { BASECAMP_SUGGESTIONS, SPACE_COLOR_CHOICES } from '../welcome';
import { Scene } from './FirstLight';
import { SpaceIcon } from './SpaceIcon';

const ALL_STEPS = [
  'hello',
  'address',
  'space',
  'basecamp',
  'default',
  'tips',
] as const;
type Step = (typeof ALL_STEPS)[number];

// The welcome, the first time Firn opens: a full-window "First light"
// scene (see FirstLight.tsx) and a few short steps. Every choice applies
// right away; from the space step on, the snow takes the space's color, so
// choices show live. Esc (or "Skip setup") leaves it at any point.
//
// "Open links in Firn?" (making Firn the default browser) only shows where
// this copy can be the default and isn't yet. Whether to show it is decided
// once, on leaving the first screen (by then Firn has looked it up), so the
// steps don't shift under the person afterwards.
export function Welcome({
  settings,
  defaultBrowser,
  spaces,
}: {
  settings: Settings | null;
  defaultBrowser: SettingsState['defaultBrowser'];
  spaces: SpacesState;
}) {
  const [step, setStep] = useState(0);
  const [offerDefault, setOfferDefault] = useState<boolean | null>(null);
  const STEPS: readonly Step[] = ALL_STEPS.filter(
    (s) => s !== 'default' || offerDefault,
  );
  // The card takes the keyboard once, when it opens (not on every redraw,
  // which would pull it out of the name box after each letter).
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => card.current?.focus(), []);
  // The sites' own icons, picked the way Basecamp picks them (see
  // welcomeIcon in src/main.ts); until one arrives (or if none can), its
  // letter.
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const site of BASECAMP_SUGGESTIONS)
      void window.firn
        .welcomeIcon(site.url)
        .catch(() => null)
        .then((data) => {
          if (data && live) setIcons((all) => ({ ...all, [site.url]: data }));
        });
    return () => {
      live = false;
    };
  }, []);
  const [picked, setPicked] = useState<string[]>([]);
  const space = spaces.spaces.find((s) => s.id === spaces.activeSpaceId);
  const [name, setName] = useState(space?.name ?? 'Personal');
  const mac = window.firn.platform === 'darwin';
  const key = mac ? 'Cmd' : 'Ctrl';

  const saveName = () => {
    if (space && name.trim() && name.trim() !== space.name)
      window.firn.updateSpace(space.id, { name: name.trim() });
  };
  // The finish ("Start browsing", Skip or Esc): the card fades, the sun
  // rises, "Welcome in.", and the browser comes up from behind the snow
  // (about 2.4s; a plain 300ms fade with reduced motion). Firn's own
  // welcome closes once it's over.
  const [finishing, setFinishing] = useState(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // If the welcome is closed or opened again meanwhile, this one's finish
  // doesn't close the new one.
  useEffect(() => () => clearTimeout(finishTimer.current), []);
  const finish = () => {
    if (finishing) return;
    saveName();
    setFinishing(true);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    finishTimer.current = setTimeout(
      () => window.firn.finishWelcome(picked),
      calm ? 300 : 2400,
    );
  };
  const next = () => {
    if (step === 0 && offerDefault === null)
      setOfferDefault(defaultBrowser === 'no');
    if (STEPS[step] === 'space') saveName();
    if (step === STEPS.length - 1) finish();
    else setStep(step + 1);
  };
  const back = () => setStep(Math.max(0, step - 1));
  const accent = space?.color ?? SPACE_COLOR_CHOICES[0].hex;

  let body: React.JSX.Element;
  switch (STEPS[step]) {
    case 'hello':
      body = (
        <>
          <span className="welcome-mark" />
          <h1 className="welcome-hello">Welcome to Firn</h1>
          <p>
            A calm place for the web. Let's set up a few things; it takes a
            minute, and you can change any of it later.
          </p>
          <button
            className="welcome-next"
            data-testid="welcome-next"
            onClick={next}
            autoFocus
          >
            Let's begin
          </button>
        </>
      );
      break;
    case 'address':
      body = (
        <>
          <h1>Where should the address bar go?</h1>
          <p>You can change this anytime in Settings.</p>
          <div className="welcome-looks" role="radiogroup">
            {(
              [
                ['sidebar', 'In the sidebar', 'More room for the page.'],
                ['top', 'At the top', 'Where most browsers have it.'],
              ] as const
            ).map(([value, label, note]) => (
              <button
                key={value}
                role="radio"
                aria-checked={settings?.addressBar === value}
                className={`welcome-look${settings?.addressBar === value ? ' is-on' : ''}`}
                style={{ '--accent': accent } as React.CSSProperties}
                onClick={() =>
                  window.firn.updateSettings({ addressBar: value })
                }
              >
                <LookPicture top={value === 'top'} />
                <strong>{label}</strong>
                <small>{note}</small>
              </button>
            ))}
          </div>
        </>
      );
      break;
    case 'space':
      body = (
        <>
          <h1>Make your first space</h1>
          <p>
            Spaces keep things apart, like Work and Personal: each has its own
            tabs, color, and icon. You can add more later.
          </p>
          {space && (
            <div className="welcome-space">
              <label className="welcome-name">
                <span
                  className="welcome-name-icon"
                  style={{ color: space.color }}
                >
                  <SpaceIcon name={space.icon} size={18} />
                </span>
                <input
                  value={name}
                  maxLength={40}
                  aria-label="Space name"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') next();
                  }}
                />
              </label>
              <div className="welcome-colors" role="radiogroup">
                {SPACE_COLOR_CHOICES.map((c) => (
                  <button
                    key={c.hex}
                    role="radio"
                    title={c.name}
                    aria-label={c.name}
                    aria-checked={space.color === c.hex}
                    className={`welcome-color${space.color === c.hex ? ' is-on' : ''}`}
                    style={{ '--swatch': c.hex } as React.CSSProperties}
                    onClick={() =>
                      window.firn.updateSpace(space.id, { color: c.hex })
                    }
                  />
                ))}
              </div>
              <div className="welcome-icons" role="radiogroup">
                {SPACE_ICON_NAMES.map((icon) => (
                  <button
                    key={icon}
                    role="radio"
                    aria-label={icon}
                    aria-checked={space.icon === icon}
                    className={`welcome-icon${space.icon === icon ? ' is-on' : ''}`}
                    style={{ color: space.color }}
                    onClick={() => window.firn.updateSpace(space.id, { icon })}
                  >
                    <SpaceIcon name={icon} size={18} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      );
      break;
    case 'basecamp':
      body = (
        <>
          <h1>Pick your everyday sites</h1>
          <p>
            They stay at the top of the sidebar in every space, one click away.
            Choose a few, or none.
          </p>
          <div className="welcome-sites">
            {BASECAMP_SUGGESTIONS.map((site) => {
              const on = picked.includes(site.url);
              return (
                <button
                  key={site.url}
                  aria-pressed={on}
                  className={`welcome-site${on ? ' is-on' : ''}`}
                  data-testid="welcome-site"
                  style={{ '--accent': accent } as React.CSSProperties}
                  onClick={() =>
                    setPicked(
                      on
                        ? picked.filter((u) => u !== site.url)
                        : [...picked, site.url],
                    )
                  }
                >
                  <span
                    className={`welcome-site-tile${icons[site.url] ? ' has-icon' : ''}`}
                  >
                    {icons[site.url] ? (
                      <img src={icons[site.url]} alt="" />
                    ) : (
                      site.name[0]
                    )}
                    {on && (
                      <span className="welcome-site-check">
                        <svg viewBox="0 0 16 16" aria-hidden>
                          <path d="M4 8.4 6.8 11 12 5.2" />
                        </svg>
                      </span>
                    )}
                  </span>
                  <span className="welcome-site-name">{site.name}</span>
                </button>
              );
            })}
          </div>
        </>
      );
      break;
    case 'default':
      body = (
        <>
          <h1>Open links in Firn?</h1>
          <p>
            Make Firn your default browser, so links from mail, chat, and other
            apps open here, as new tabs. You can change this anytime in
            Settings.
          </p>
          <div className="welcome-default">
            {defaultBrowser === 'yes' ? (
              <p className="welcome-default-done">
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path d="M4 8.4 6.8 11 12 5.2" />
                </svg>
                Firn is your default browser
              </p>
            ) : (
              <>
                <button
                  className="welcome-quiet welcome-default-button"
                  onClick={() => window.firn.makeDefaultBrowser()}
                >
                  Make Firn default
                </button>
                <small>
                  {mac
                    ? 'Your Mac will ask you to confirm.'
                    : 'Windows opens its settings: choose Firn there, then come back.'}
                </small>
              </>
            )}
          </div>
        </>
      );
      break;
    case 'tips':
      body = (
        <>
          <h1>You're all set</h1>
          <p>Three things worth knowing:</p>
          <ul className="welcome-tips">
            <li>
              <span className="welcome-keys">
                <kbd>{key}</kbd>
                <kbd>T</kbd>
              </span>
              <span>Open a new tab, or find any tab, page or setting.</span>
            </li>
            <li>
              <span className="welcome-keys">
                <kbd>Right-click</kbd>
              </span>
              <span>Tabs, links, and spaces each have a short menu.</span>
            </li>
            <li>
              <span className="welcome-keys">
                <kbd>{key}</kbd>
                <kbd>S</kbd>
              </span>
              <span>
                Hide the sidebar for more room. It peeks back at the left edge.
              </span>
            </li>
          </ul>
        </>
      );
      break;
  }

  // The snow follows the space's color from the space step on.
  const tint = step >= STEPS.indexOf('space') ? accent : null;

  return (
    <div
      className={`welcome${finishing ? ' is-finishing' : ''}`}
      role="dialog"
      aria-label="Welcome to Firn"
      tabIndex={-1}
      ref={card}
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish();
      }}
    >
      <Scene tint={tint}>
        {/* "Welcome in." sits in the sky; the browser rises over it. */}
        {finishing && <p className="welcome-in">Welcome in.</p>}
        {finishing && <BrowserRising />}
      </Scene>
      <div className="welcome-stage">
        {step === 0 ? (
          <div className="welcome-hello-screen">{body}</div>
        ) : (
          <>
            <div className="welcome-dots" aria-hidden>
              {STEPS.map((s, i) => (
                <span key={s} className={i === step ? 'is-on' : ''} />
              ))}
            </div>
            <div className="welcome-card">
              <div className="welcome-body" key={step}>
                {body}
              </div>
              <footer className="welcome-footer">
                <button className="welcome-quiet" onClick={back}>
                  Back
                </button>
                <button
                  className="welcome-next"
                  data-testid="welcome-next"
                  onClick={next}
                  autoFocus
                >
                  {step === STEPS.length - 1 ? 'Start browsing' : 'Continue'}
                </button>
              </footer>
            </div>
          </>
        )}
      </div>
      <button className="welcome-skip" onClick={finish}>
        Skip setup
      </button>
    </div>
  );
}

// The browser, drawn simply (frame, address, Basecamp, page), rising
// into place from behind the snow as the welcome ends. The real browser
// is underneath; the scene fades away to it.
function BrowserRising() {
  return (
    <div className="welcome-browser">
      <div className="welcome-browser-side">
        <i className="is-address" />
        <span>
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="welcome-browser-page" />
    </div>
  );
}

// A small drawing of Firn's window: the address bar in the sidebar, or in
// a bar along the top.
function LookPicture({ top }: { top: boolean }) {
  return (
    <svg className="look-picture" viewBox="0 0 200 120" aria-hidden>
      <rect
        className="look-frame"
        x="0"
        y="0"
        width="200"
        height="120"
        rx="10"
      />
      {top ? (
        <>
          <rect
            className="look-pill is-address"
            x="92"
            y="7"
            width="64"
            height="11"
            rx="5.5"
          />
          <rect
            className="look-page"
            x="54"
            y="25"
            width="140"
            height="89"
            rx="6"
          />
          <rect
            className="look-pill"
            x="8"
            y="30"
            width="38"
            height="7"
            rx="3.5"
          />
          <rect
            className="look-pill"
            x="8"
            y="42"
            width="30"
            height="7"
            rx="3.5"
          />
          <rect
            className="look-pill"
            x="8"
            y="54"
            width="34"
            height="7"
            rx="3.5"
          />
        </>
      ) : (
        <>
          <rect
            className="look-pill is-address"
            x="8"
            y="10"
            width="40"
            height="11"
            rx="5.5"
          />
          <rect
            className="look-page"
            x="54"
            y="6"
            width="140"
            height="108"
            rx="6"
          />
          <rect
            className="look-pill"
            x="8"
            y="30"
            width="38"
            height="7"
            rx="3.5"
          />
          <rect
            className="look-pill"
            x="8"
            y="42"
            width="30"
            height="7"
            rx="3.5"
          />
          <rect
            className="look-pill"
            x="8"
            y="54"
            width="34"
            height="7"
            rx="3.5"
          />
        </>
      )}
    </svg>
  );
}
