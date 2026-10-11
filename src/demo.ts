// Demo mode, for recording Firn's marketing clips (see demo/README.md).
// Only when Firn is started with FIRN_DEMO=1, which the demo recorder
// (npm run demo) does; a normal start never takes any of these paths.
//
// In demo mode Firn:
// - keeps its data in a throwaway folder (FIRN_DEMO_PROFILE, which the
//   recorder wipes before each clip), never the person's real profile;
// - opens at a fixed size (1440×900 inside), centered on the main screen;
// - is always light, never checks for updates, never contacts Safe
//   Browsing, and never asks for site permissions (they're refused);
// - hides Wikipedia's donation banners, and cookie and sign-up pop-ups
//   (the common consent tools' boxes, and MDN's banners), so no clip
//   shows one;
// - lets the recorder pick an item in a right-click menu it opened, the
//   one thing its scripted mouse can't click (menus are the system's own).

import path from 'node:path';
import { app, Menu, screen, type MenuItem } from 'electron';

export const DEMO = process.env.FIRN_DEMO === '1';

// The window's inside size in demo mode.
export const DEMO_SIZE = { width: 1440, height: 900 };

// Must run before anything reads Firn's data folder (and before the
// one-copy-at-a-time check, which goes by that folder).
export function useDemoProfile() {
  if (!DEMO) return;
  const folder = process.env.FIRN_DEMO_PROFILE;
  if (!folder) throw new Error('FIRN_DEMO=1 needs FIRN_DEMO_PROFILE');
  app.setPath('userData', path.resolve(folder));
}

// Where the window goes: centered on the main screen's usable area.
export function demoBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + (area.width - DEMO_SIZE.width) / 2),
    y: Math.round(area.y + (area.height - DEMO_SIZE.height) / 2),
    ...DEMO_SIZE,
  };
}

// The usual cookie and consent boxes (OneTrust, Cookiebot, Didomi,
// Sourcepoint, Funding Choices, Osano, Cookie Consent, Quantcast).
const POPUPS = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '#CybotCookiebotDialog',
  '#didomi-host',
  '[id^="sp_message_container"]',
  '.fc-consent-root',
  '.osano-cm-window',
  '.cc-window',
  '.qc-cmp2-container',
];
const WIKIPEDIA_POPUPS = [
  '#siteNotice',
  '#centralNotice',
  '.cn-fundraising',
  '[class*="frb"]',
  '[id^="frb"]',
];
const MDN_POPUPS = ['.top-banner', '.mdn-cta-container', '.place.top'];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

// Remembers the last right-click menu Firn opened, so the recorder can
// choose one of its items (by the start of its label) after showing it.
export function installDemoHooks() {
  if (!DEMO) return;
  // What made Firn quit, for the recorder's log (demo/out/firn-log.txt).
  const quit = app.quit.bind(app);
  app.quit = () => {
    console.log(`[demo] Firn was asked to quit:\n${new Error().stack}`);
    quit();
  };
  app.on('before-quit', () => console.log('[demo] Firn is quitting'));
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
    process.on(signal, () => {
      console.log(`[demo] Firn got ${signal}`);
      quit();
    });
  // Pop-ups that would sit in a clip: Wikipedia's donation banners, the
  // common cookie-consent tools' boxes, and MDN's banners.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('dom-ready', () => {
      const host = hostOf(contents.getURL());
      const hide = [...POPUPS];
      if (/(^|\.)wikipedia\.org$/.test(host)) hide.push(...WIKIPEDIA_POPUPS);
      if (/(^|\.)mozilla\.org$/.test(host)) hide.push(...MDN_POPUPS);
      void contents.insertCSS(
        `${hide.join(', ')} { display: none !important; }`,
      );
    });
  });
  let lastMenu: Menu | null = null;
  const build = Menu.buildFromTemplate;
  Menu.buildFromTemplate = (template) => {
    const menu = build(template);
    menu.on('menu-will-show', () => (lastMenu = menu));
    return menu;
  };
  const find = (items: MenuItem[], label: string): MenuItem | null => {
    for (const item of items) {
      // (By its start: some labels end in a count, e.g. "(3/12)".)
      if (item.label.startsWith(label)) return item;
      const inner = item.submenu && find(item.submenu.items, label);
      if (inner) return inner;
    }
    return null;
  };
  (globalThis as { __firnDemo?: unknown }).__firnDemo = {
    // Where an item is in the open menu (top level): how many items and
    // lines come before it, so the recorder's cursor can point at it.
    menuItemPosition(label: string) {
      const items = lastMenu?.items.filter((item) => item.visible) ?? [];
      const index = items.findIndex((item) => item.label.startsWith(label));
      if (index < 0) return null;
      const before = items.slice(0, index);
      const separators = before.filter((i) => i.type === 'separator').length;
      return { row: before.length - separators, separators };
    },
    // Closes the open menu and does what the item says. False if there's
    // no such item.
    chooseMenuItem(label: string) {
      const item = lastMenu && find(lastMenu.items, label);
      if (!lastMenu || !item) return false;
      lastMenu.closePopup();
      item.click();
      return true;
    },
  };
}
