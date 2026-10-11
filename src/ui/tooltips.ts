// Firn's own hover labels, in place of Windows' square system tooltips: a
// small rounded label that fades in below what's hovered. On a Mac, the
// system's own tooltips instead (they belong there, and aren't held inside
// the sidebar or the slim top bar), with the same rule: a tab's name only
// when it's cut off.
//
// Buttons keep their plain `title="…"` in the code; this moves each one to
// `data-tip` as it appears (so the system's tooltip never shows) and gives
// it an aria-label if it has none, so screen readers still name it.
//
// A label can't draw outside its own layer: in the sidebar it stays inside
// the sidebar (wrapping a long name) instead of spilling over the page.
// The slim top bar is too short to hold one, so it asks the main process,
// and the floating layer draws it in a small box of its own just below
// the button (src/main.ts, 'tip:show').

const SHOW_AFTER_MS = 500;
// Moving straight from one labelled thing to the next shows its label at
// once, the way system tooltips do.
const QUICK_FOR_MS = 400;
const GAP = 6;
const MARGIN = 8;
// The top bar's labels: the floating layer's box leaves this much room
// around the label for its shadow, and a little above it (TIP_ROOM and
// TIP_TOP in src/main.ts).
const BOX_ROOM = 12;
const BOX_TOP = 2;
const BAR_TIP_WIDTH = 280;

// A row whose name is fully shown needs no label repeating it; one cut
// off ("DatHost User Login & Acc…") does.
const repeatsVisibleText = (el: Element, text: string) => {
  const shown = [el, ...el.querySelectorAll('*')].find(
    (e) => e.childElementCount === 0 && e.textContent?.trim() === text,
  );
  return !!shown && shown.scrollWidth <= shown.clientWidth;
};

export function installTooltips(view: string) {
  // (`?tips=native` lets the checks see the Mac's way elsewhere.)
  const native =
    window.firn.platform === 'darwin' ||
    new URLSearchParams(location.search).get('tips') === 'native';
  const adopt = (el: Element) => {
    const title = el.getAttribute('title');
    if (title === null) return;
    // (On a Mac the title stays, for the system's tooltip.)
    if (!native) el.removeAttribute('title');
    if (!title) return;
    el.setAttribute('data-tip', title);
    if (!el.hasAttribute('aria-label') && !el.textContent?.trim())
      el.setAttribute('aria-label', title);
  };
  const adoptAll = (root: ParentNode) =>
    root.querySelectorAll('[title]').forEach(adopt);
  adoptAll(document);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes') adopt(change.target as Element);
      else
        change.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            adopt(node);
            adoptAll(node);
          }
        });
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });

  // A Mac: the system shows each title. Only a row whose name is fully
  // shown loses its title while hovered, so the system doesn't repeat it.
  let quieted: Element | null = null;
  if (native) {
    const restore = () => {
      const el = quieted;
      quieted = null;
      const text = el?.getAttribute('data-tip');
      if (el && text && !el.hasAttribute('title'))
        el.setAttribute('title', text);
    };
    document.addEventListener('pointerover', (e) => {
      const el = (e.target as Element).closest?.('[data-tip]') ?? null;
      if (el === quieted) return;
      restore();
      if (el && repeatsVisibleText(el, el.getAttribute('data-tip') ?? '')) {
        quieted = el;
        el.removeAttribute('title');
      }
    });
    document.documentElement.addEventListener('pointerleave', restore);
    return;
  }

  const tip = document.createElement('div');
  tip.className = 'firn-tip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('aria-hidden', 'true');
  // The words sit in a box of their own, which stops after two lines (the
  // label's padding is outside it, so no third line peeks through there).
  const words = document.createElement('span');
  words.className = 'firn-tip-text';
  tip.append(words);
  document.body.append(tip);

  let target: Element | null = null;
  let timer = 0;
  let hiddenAt = 0;
  let pressed = false;

  // The area a label may use: the sidebar column in the sidebar's layers
  // (the page covers the rest), the whole layer elsewhere.
  const bounds = (el: Element) => {
    const box = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (view === 'floating') return box;
    const sidebar =
      el.closest('.sidebar') ?? document.querySelector('.sidebar');
    if (!sidebar) return box;
    const r = sidebar.getBoundingClientRect();
    return {
      left: Math.max(0, r.left),
      top: Math.max(0, r.top),
      right: Math.min(innerWidth, r.right),
      bottom: Math.min(innerHeight, r.bottom),
    };
  };

  const place = (el: Element) => {
    const area = bounds(el);
    const r = el.getBoundingClientRect();
    tip.style.maxWidth = `${Math.max(0, area.right - area.left - MARGIN * 2)}px`;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const centre = r.left + r.width / 2;
    const left = Math.min(
      Math.max(centre - w / 2, area.left + MARGIN),
      area.right - MARGIN - w,
    );
    // Below, or above when there's no room below.
    let top = r.bottom + GAP;
    if (top + h > area.bottom - MARGIN) top = r.top - GAP - h;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(area.top + MARGIN, top))}px`;
  };

  let asked = false;
  const show = (el: Element) => {
    const text = el.getAttribute('data-tip');
    if (!text || !el.isConnected) return;
    if (view === 'topbar') {
      const r = el.getBoundingClientRect();
      asked = true;
      window.firn.showTip(text, {
        left: r.left,
        right: r.right,
        bottom: r.bottom,
      });
      return;
    }
    words.textContent = text;
    tip.classList.add('is-placing');
    place(el);
    tip.classList.remove('is-placing');
    tip.classList.add('is-shown');
  };

  const hide = () => {
    clearTimeout(timer);
    if (asked) {
      asked = false;
      hiddenAt = performance.now();
      window.firn.hideTip();
    }
    if (tip.classList.contains('is-shown')) hiddenAt = performance.now();
    tip.classList.remove('is-shown');
    target = null;
  };

  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element).closest?.('[data-tip]') ?? null;
    if (el === target) return;
    hide();
    if (!el || pressed) return;
    if (repeatsVisibleText(el, el.getAttribute('data-tip') ?? '')) return;
    target = el;
    const quick = performance.now() - hiddenAt < QUICK_FOR_MS;
    timer = window.setTimeout(() => show(el), quick ? 0 : SHOW_AFTER_MS);
  });
  document.addEventListener('pointerout', (e) => {
    const to = (e.relatedTarget as Element | null)?.closest?.('[data-tip]');
    if (target && to !== target) hide();
  });
  // Clicking, dragging, typing, or scrolling puts the label away.
  document.addEventListener(
    'pointerdown',
    () => {
      pressed = true;
      hide();
      hiddenAt = 0;
    },
    true,
  );
  document.addEventListener('pointerup', () => (pressed = false), true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  document.documentElement.addEventListener('pointerleave', hide);

  // The floating layer draws the top bar's labels: it measures one, and
  // shows it once its small box is in place.
  if (view === 'floating')
    window.firn.onTipState((state) => {
      if (state.kind === 'measure') {
        hide();
        words.textContent = state.text;
        tip.classList.add('is-placing');
        tip.style.maxWidth = `${BAR_TIP_WIDTH}px`;
        tip.style.left = `${BOX_ROOM}px`;
        tip.style.top = `${BOX_TOP}px`;
        window.firn.tipSize(tip.offsetWidth, tip.offsetHeight);
        tip.classList.remove('is-placing');
      } else if (state.kind === 'show') {
        // A frame later, so it fades in once the box is on screen.
        requestAnimationFrame(() => tip.classList.add('is-shown'));
      } else tip.classList.remove('is-shown');
    });
}
