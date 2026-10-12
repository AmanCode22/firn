import {
  app,
  clipboard,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  safeStorage,
  session,
  shell,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Input,
  type WebContents,
} from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSession, SaveScheduler, saveSession, sessionPath } from './store';
import type { Page, PageContextMenu } from './engine/engine';
import { ElectronEngine } from './engine/electron';
import { Downloads } from './downloads';
import { PasswordStore } from './passwords';
import { AdBlocker } from './adblock';
import {
  askToBeDefault,
  defaultBrowserState,
  isWebFile,
  linksFromArguments,
  registerWindowsBrowser,
  unregisterWindowsBrowser,
  type DefaultBrowserState,
} from './defaultBrowser';
import { SafeBrowsing, type Threat } from './safebrowsing';
import { BASECAMP_SUGGESTIONS, SPACE_COLOR_CHOICES } from './welcome';
import { iconLinksFromHtml, pickIcon } from './favicon';
import type { PermissionKind, PermissionRequest } from './engine/engine';
import { parseKey, PERMISSION_WORDING, SitePermissions } from './permissions';
import { History } from './history';
import { searchUrl, setSearchEngine } from './url';
import { isLiquidGlass, pageRadius } from './frame';
import { cleanSettings, loadSettings, saveSettings } from './settings';
import { isSpaceIcon, SPACE_ICON_NAMES, toSpaceIcon } from './spaceIcons';
import { BASECAMP_MAX, TabManager } from './tabs';
import {
  checkForUpdates,
  installUpdate,
  onUpdateState,
  startUpdates,
  updateState,
} from './updates';
import { DEMO, demoBounds, installDemoHooks, applyDemoProfile } from './demo';
import { macMenuTemplate } from './menu';
import { matchShortcut, menuAccelerator } from './shortcuts';
import { ARCHIVE_CHOICES, isOld, noteDayUsed } from './archive';
import { handleInstallerEvent } from './installer';
import type {
  CarryTab,
  CommandAction,
  FrameState,
  NavCommand,
  OverlayState,
  SavedWindow,
  Space,
  WindowState,
} from './types';

// Windows: started by the installer (install, update, or uninstall), Firn
// makes or removes its Start menu entry and its place among the browsers,
// and quits (src/installer.ts).
const started = handleInstallerEvent({
  register: registerWindowsBrowser,
  unregister: unregisterWindowsBrowser,
});
if (started) {
  app.quit();
}

// Links from other apps (Firn as the default browser, see
// src/defaultBrowser.ts): opened as new tabs once the window is there.
const pendingLinks: string[] = started ? [] : linksFromArguments(process.argv);
let openLinks: ((urls: string[]) => void) | null = null;
const receiveLinks = (urls: string[]) => {
  if (!urls.length) return;
  if (openLinks) return openLinks(urls);
  pendingLinks.push(...urls);
  // macOS keeps Firn running with its window closed: open it again.
  if (app.isReady() && !BrowserWindow.getAllWindows().length) createWindow();
};

// Windows: Firn's taskbar button and pins belong with the Start menu
// entry the installer makes (the installer's own name for Firn). And Windows' list of installed apps shows Firn's own icon: the
// installer fetches it from the web while installing (see
// forge.config.mts), and in case that failed, Firn also points the list
// at its own app file.
if (process.platform === 'win32' && !started) {
  app.setAppUserModelId('com.squirrel.firn.Firn');
  const installRoot = path.dirname(path.dirname(process.execPath));
  const launcher = path.join(installRoot, 'Firn.exe');
  if (
    app.isPackaged &&
    fs.existsSync(path.join(installRoot, 'Update.exe')) &&
    fs.existsSync(launcher)
  )
    execFile(
      'reg',
      [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\firn',
        '/v',
        'DisplayIcon',
        '/d',
        `${launcher},0`,
        '/f',
      ],
      () => {},
    );
}

const HOME_URL = 'https://duckduckgo.com';
// History: Ctrl+H on Windows and Linux; Cmd+Y on a Mac, like Safari and
// Chrome there (Cmd+H hides the app on a Mac).

// Start with FIRN_DEBUG=1 to log what the window's layers are doing.
const DEBUG = Boolean(process.env.FIRN_DEBUG);
const debug = (message: string) => {
  if (DEBUG) console.log(`[Firn debug] ${message}`);
};

// Layout of the window frame (keep in sync with the CSS in src/ui/styles.css).
const SIDEBAR_WIDTH = 260;
// On macOS the sidebar's top row also holds the window's traffic lights, so
// it can't get quite as narrow.
const SIDEBAR_MIN = process.platform === 'darwin' ? 224 : 200;
const SIDEBAR_MAX = 360;
const GLIDE_MS = 200; // matches --motion in styles.css
// Archiving old tabs (src/archive.ts): the first look a little after Firn
// opens (out of the way of the start), then every hour.
const TIDY_FIRST_MS = 8000;
const TIDY_EVERY_MS = 60 * 60 * 1000;
// Archived tabs are forgotten after this many days of use (still in History).
const ARCHIVE_KEEP_DAYS = 30;
// Sleeping tabs (Tabs.sleepOld): a tab not on screen for an hour is put to
// sleep, looked for every few minutes. FIRN_SLEEP_TEST=1 shortens both
// for the end-to-end check (3 seconds, looked for every second).
const SLEEP_TEST = process.env.FIRN_SLEEP_TEST === '1';
const SLEEP_AFTER_MS = SLEEP_TEST ? 3000 : 60 * 60 * 1000;
const SLEEP_CHECK_MS = SLEEP_TEST ? 1000 : 5 * 60 * 1000;
// The peeking sidebar is forgiving to the left and quick to the right:
// anywhere to its left (even off the window, onto another screen) counts as
// "on it", but once the mouse is this far past its right edge, back over the
// page, it tucks away after this short pause.
const PEEK_RIGHT_SLACK = 8;
const PEEK_LINGER_MS = 120;
// ...and to the left, past the window's edge, it stays out for this far
// (and a little longer once the mouse goes beyond it).
const PEEK_LEFT_SLACK = 200;
const PEEK_LEFT_LINGER_MS = 400;
// A UI panel that hasn't reported it started within this long is reloaded.
const UI_START_TIMEOUT_MS = 5000;

// How often the cursor's position is checked for the edge reveals.
const EDGE_CHECK_MS = 30;
// ...less often while Firn isn't the window in front (its edges still
// answer the mouse, a moment slower), and rarely while it's minimized or
// hidden, so a Firn left open in the background stays idle.
const EDGE_CHECK_BACKGROUND_MS = 250;
const EDGE_CHECK_AWAY_MS = 1000;
// The session is saved this long after a change (never later).
const SESSION_SAVE_MS = 2000;
// How generous the left-edge zone that brings out the peeking sidebar is:
// a little past the window's edge, and a little way into the page. (Just
// the thin frame strip proved far too easy to miss.)
const PEEK_ZONE_OUTSIDE = 8;
const PEEK_ZONE_INSIDE = 20;
const PAGE_INSET = 8;
// See src/frame.ts.
const PAGE_RADIUS = pageRadius(process.platform, process.getSystemVersion());

// Hovering the top edge lowers the page to make room for a bar with the
// window buttons above it (Windows / Linux).
const TOP_BAR_HEIGHT = 40; // matches --top-bar-height in styles.css
// With the address bar at the top, the bar is always there and a little
// taller, so the address bar has room around it.
const TOP_ADDRESS_HEIGHT = 48;

// macOS: where the window's traffic lights sit (their top-left corner),
// relative to the sidebar's top row (8pt in; 36pt tall, so 10pt down puts
// their middle on the row's). Liquid Glass draws them 1pt higher, so there
// they go 1pt lower.
const LIGHTS_DOWN = isLiquidGlass(process.platform, process.getSystemVersion())
  ? 1
  : 0;
const LIGHTS_IN_ROW = { x: 8, y: 10 + LIGHTS_DOWN };
const LIGHTS_IN_SIDEBAR = { x: 8 + LIGHTS_IN_ROW.x, y: 8 + LIGHTS_IN_ROW.y };
// With the address bar at the top, the sidebar's top row moves up into the
// bar exactly where it was, and the lights stay where they were with it.
const LIGHTS_IN_TOP_BAR = LIGHTS_IN_SIDEBAR;
// The three lights are about 60pt wide: further left than this, they're
// past the window's edge altogether.
const LIGHTS_GONE_X = -60;
// Once the mouse leaves the bar, wait this long before sliding it away, so
// brushing past the edge doesn't make it flicker.
const TOP_BAR_LINGER_MS = 250;
// The mouse rests at the top edge this long before the bar comes down, so
// flicking up to a site's own search box or menu doesn't bring it (and move
// the page out from under the mouse).
const TOP_BAR_DWELL_MS = 250;

// The window's name (the Dock's menu, the Window menu, the taskbar): the
// page's title, cut short like the sidebar's tabs (some sites put a whole
// description in it), then "— Firn".
const WINDOW_TITLE_MAX = 60;
const windowTitle = (pageTitle: string) => {
  const title = pageTitle.replace(/\s+/g, ' ').trim();
  if (!title) return 'Firn';
  const short =
    title.length > WINDOW_TITLE_MAX
      ? `${title.slice(0, WINDOW_TITLE_MAX - 1).trimEnd()}…`
      : title;
  return `${short} — Firn`;
};

// Ctrl+Tab: a quick tap just flips tabs; holding Ctrl this long shows the list.
const SWITCHER_DELAY_MS = 180;

// Warm neutral frame colors, used before the UI has painted.
// Frosted glass behind the window: acrylic on Windows 11 (version 22H2,
// build 22621, and later) and vibrancy on macOS. Elsewhere the frame stays
// solid. FIRN_NO_GLASS=1 turns it off.
const GLASS = (() => {
  if (process.env.FIRN_NO_GLASS) return false;
  if (process.platform === 'darwin') return true;
  if (process.platform === 'win32')
    return Number(os.release().split('.')[2]) >= 22621;
  return false;
})();

const FRAME = { light: '#e9e3da', dark: '#3a3734' };

const frameColor = () =>
  nativeTheme.shouldUseDarkColors ? FRAME.dark : FRAME.light;

// The space a first run starts with.
const DEFAULT_SPACE_ID = 'space-default';

const NAV_COMMANDS: NavCommand[] = ['back', 'forward', 'reload', 'stop'];

// Same safe settings as web pages, plus the narrow preload bridge.
const UI_WEB_PREFERENCES = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

// Loads Firn's UI. `view` picks which part: the sidebar (default), the
// floating layer (command bar, tab switcher), the top bar, or the sidebar
// peeking over the page while collapsed.
type LayerView = 'floating' | 'topbar' | 'peek';

function loadUi(web: WebContents, view?: LayerView) {
  const query: Record<string, string> = view ? { view } : {};
  // (The checks see a Mac's own hover labels elsewhere: src/ui/tooltips.ts.)
  if (process.env.FIRN_NATIVE_TIPS_TEST === '1') query.tips = 'native';
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, value);
    web.loadURL(url.toString());
  } else {
    web.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      Object.keys(query).length ? { query } : undefined,
    );
  }
}

// Firn's own UI must never navigate away from itself.
function lockUi(web: WebContents) {
  web.on('will-navigate', (event) => event.preventDefault());
  web.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// Firn's app icon (assets/icon.*), if it's there.
function appIcon() {
  const file = path.join(
    app.getAppPath(),
    'assets',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );
  return fs.existsSync(file) ? file : undefined;
}

// Downloads a favicon and returns it as a data: URL (or null). Small images
// only; anything else is ignored.
const ICON_MAX_BYTES = 512 * 1024;
async function iconAsDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await session.defaultSession.fetch(url);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > ICON_MAX_BYTES) return null;
    const type = (response.headers.get('content-type') ?? '').split(';')[0];
    // Some sites send .ico files without an image type; Chromium sniffs it.
    const mime = type.startsWith('image/') ? type : 'image/x-icon';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

// A site's icon for the welcome: a known-current one if listed, else the
// one Basecamp would pick once the site is open (src/favicon.ts), from its
// front page (read without cookies; nothing on it runs), else the
// fallbacks listed with the site (see src/welcome.ts).
const PAGE_MAX_CHARS = 2 * 1024 * 1024;
const welcomeIcons = new Map<string, Promise<string | null>>();
function welcomeIcon(siteUrl: string): Promise<string | null> {
  const site = BASECAMP_SUGGESTIONS.find((s) => s.url === siteUrl);
  if (!site) return Promise.resolve(null);
  const dark = nativeTheme.shouldUseDarkColors;
  const key = `${siteUrl} ${dark ? 'dark' : 'light'}`;
  let icon = welcomeIcons.get(key);
  if (!icon) {
    icon = (async () => {
      for (const url of site.prefer ?? []) {
        const data = await iconAsDataUrl(url);
        if (data) return data;
      }
      try {
        const response = await session.defaultSession.fetch(site.url, {
          credentials: 'omit',
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const html = (await response.text()).slice(0, PAGE_MAX_CHARS);
          const base = response.url || site.url;
          const best = pickIcon(
            iconLinksFromHtml(html, base, dark),
            new URL('/favicon.ico', base).href,
          );
          const data = await iconAsDataUrl(best);
          if (data) return data;
        }
      } catch {
        // Couldn't read the page: try the fallbacks.
      }
      for (const url of site.icons) {
        const data = await iconAsDataUrl(url);
        if (data) return data;
      }
      return null;
    })();
    welcomeIcons.set(key, icon);
  }
  return icon;
}

// --- Spaces ---------------------------------------------------------------

// Icons to choose from for a space (a new space takes the next unused one).
const SPACE_ICONS = SPACE_ICON_NAMES;
// Each space's theme color (src/welcome.ts).
const SPACE_COLORS = SPACE_COLOR_CHOICES.map((c) => c.hex);

// A small round swatch of a color, for the "Change color" menu.
function colorSwatch(hex: string) {
  const size = 32; // drawn at 2x, shown at 16px
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const radius = size / 2 - 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      // Soft edge: fully opaque inside, fading over the last pixel.
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - distance));
      const i = (y * size + x) * 4;
      // BGRA, with the color premultiplied by its opacity.
      pixels[i] = Math.round(b * alpha);
      pixels[i + 1] = Math.round(g * alpha);
      pixels[i + 2] = Math.round(r * alpha);
      pixels[i + 3] = Math.round(255 * alpha);
    }
  }
  return nativeImage.createFromBitmap(pixels, {
    width: size,
    height: size,
    scaleFactor: 2,
  });
}

const defaultSpaces = (): Space[] => [
  {
    id: DEFAULT_SPACE_ID,
    name: 'Personal',
    icon: SPACE_ICONS[0],
    color: SPACE_COLORS[0],
    order: 0,
  },
];

// The saved spaces, if they look right; otherwise the default one. Older
// sessions saved a space with no icon or color; those get one.
function usableSpaces(saved: Space[] | undefined): Space[] {
  const valid = (saved ?? []).filter(
    (s) => s && typeof s.id === 'string' && typeof s.name === 'string',
  );
  if (!valid.length) return defaultSpaces();
  return valid
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      ...s,
      // Older sessions saved an emoji (or nothing): use the matching icon.
      icon: toSpaceIcon(s.icon) ?? SPACE_ICONS[i % SPACE_ICONS.length],
      color: s.color || SPACE_COLORS[i % SPACE_COLORS.length],
      order: i,
    }));
}

// The saved window position, if it's still (mostly) on a connected screen;
// otherwise Firn opens at its default size, centered.
function usableBounds(saved: SavedWindow['bounds']) {
  if (!saved) return undefined;
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX =
      Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x);
    const overlapY =
      Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y);
    return overlapX >= 200 && overlapY >= 100;
  });
  return visible ? saved : undefined;
}

const createWindow = () => {
  // Bring back the last session, if there is one.
  const saved = loadSession();
  // Demo mode (src/demo.ts): always the same size and place.
  const bounds = DEMO ? demoBounds() : usableBounds(saved?.window.bounds);

  // The window itself hosts Firn's own UI (the sidebar).
  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 640,
    minHeight: 400,
    // (Demo mode: the size is the inside of the window.)
    useContentSize: DEMO,
    title: 'Firn',
    // The window and taskbar icon while running from source (a packaged
    // Firn gets its icon from forge.config.mts).
    icon: appIcon(),
    // With glass, the window is see-through and the UI paints a tinted,
    // partly transparent frame over the system's blur.
    backgroundColor: GLASS ? '#00000000' : frameColor(),
    ...(GLASS && process.platform === 'win32'
      ? { backgroundMaterial: 'acrylic' as const }
      : {}),
    ...(GLASS && process.platform === 'darwin'
      ? {
          vibrancy: 'under-window' as const,
          visualEffectState: 'followWindow' as const,
        }
      : {}),
    // Hide the OS title bar. macOS keeps its traffic lights; on Windows and
    // Linux Firn draws its own window buttons, hidden in the top-right corner.
    titleBarStyle: 'hidden',
    trafficLightPosition: LIGHTS_IN_SIDEBAR,
    webPreferences: UI_WEB_PREFERENCES,
  });
  // Windows: pinning Firn to the taskbar while it runs would remember this
  // version's own folder (app-0.7.2\Firn.exe), which the next update
  // leaves behind, so the pin kept opening the old version. Pins point to
  // the installer's small launcher instead, which always opens the newest.
  const launcher = path.join(
    path.dirname(path.dirname(process.execPath)),
    'Firn.exe',
  );
  if (process.platform === 'win32' && app.isPackaged && fs.existsSync(launcher))
    win.setAppDetails({
      appId: 'com.squirrel.firn.Firn',
      relaunchCommand: `"${launcher}"`,
      relaunchDisplayName: 'Firn',
      appIconPath: launcher,
    });

  let spaces = usableSpaces(saved?.spaces);
  const windowState: WindowState = {
    id: String(win.id),
    activeSpaceId: spaces.some((s) => s.id === saved?.window.activeSpaceId)
      ? saved!.window.activeSpaceId
      : spaces[0].id,
    activeTabId: null,
    sidebarWidth: Math.round(
      Math.max(
        SIDEBAR_MIN,
        Math.min(SIDEBAR_MAX, saved?.window.sidebarWidth ?? SIDEBAR_WIDTH),
      ),
    ),
    sidebarCollapsed: saved?.window.sidebarCollapsed ?? false,
  };
  if (saved?.window.maximized && !DEMO) win.maximize();

  // --- Layers above the web page ------------------------------------------
  // Web pages are drawn on top of the sidebar's layer, so anything that has
  // to float over a page lives in its own transparent layer above it.

  // --- Starting Firn's UI panels -------------------------------------------
  // Panels are loaded one at a time: the sidebar first, then each layer once
  // the one before it has reported that it started ('ui:ready'). A panel
  // that hasn't started within UI_START_TIMEOUT_MS is reloaded. (Loading
  // them all at once could leave one blank in development mode.)
  const readyUi = new Set<WebContents>();
  const startTimers = new Map<WebContents, ReturnType<typeof setTimeout>>();

  const startUi = (web: WebContents) => {
    if (web.isDestroyed()) return;
    readyUi.delete(web);
    loadUi(web, layerViews.get(web));
    clearTimeout(startTimers.get(web));
    startTimers.set(
      web,
      setTimeout(() => {
        if (web.isDestroyed() || readyUi.has(web)) return;
        console.error(
          `[Firn] The ${uiNames.get(web) ?? 'UI'} panel didn't start; reloading it.`,
        );
        startUi(web);
      }, UI_START_TIMEOUT_MS),
    );
  };

  let layersToStart: WebContents[] = [];
  const onUiReady = (web: WebContents) => {
    readyUi.add(web);
    clearTimeout(startTimers.get(web));
    debug(`${uiNames.get(web)} started`);
    // Start the next layer once the previous one is up.
    if (layersToStart[0] === web) layersToStart.shift();
    // The top bar may need to be there from the start.
    if (web === topBar.webContents) syncTopBar(false);
    if (web === floating.webContents && welcomePending) openWelcome();
    else if (web === floating.webContents && whatsNewSince !== null)
      openWhatsNew(whatsNewSince);
    if (web === win.webContents || !layersToStart.includes(web)) {
      const next = layersToStart[0];
      if (next && !startTimers.has(next)) startUi(next);
    }
  };

  // Every show and hide goes through showLayer / hideLayer. A hidden layer
  // is also shrunk to nothing, so even if the system ever ignored "hidden",
  // an invisible layer could never sit over the window catching clicks.
  const NO_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };
  const shownLayers = new Set<WebContentsView>();
  const layerViews = new Map<WebContents, LayerView>();

  const makeLayer = (view: LayerView) => {
    const layer = new WebContentsView({ webPreferences: UI_WEB_PREFERENCES });
    layer.setBackgroundColor('#00000000');
    layer.setBounds(NO_BOUNDS);
    layer.setVisible(false);
    win.contentView.addChildView(layer);
    layerViews.set(layer.webContents, view);
    // Loading can make a view visible again; put it back if it should be
    // hidden.
    layer.webContents.on('did-finish-load', () => {
      if (!shownLayers.has(layer)) {
        layer.setVisible(false);
        layer.setBounds(NO_BOUNDS);
      }
    });
    return layer;
  };
  const peek = makeLayer('peek');
  const floating = makeLayer('floating');
  // The top bar exists everywhere: window buttons on Windows and Linux (on
  // macOS it's a strip to grab the window by), and the address bar when
  // it's set to sit at the top.
  const topBar = makeLayer('topbar');
  const uiContents = [win.webContents, floating.webContents, peek.webContents];
  if (topBar) uiContents.push(topBar.webContents);

  // If one of Firn's own panels crashes, say so in the terminal and reload
  // it, so the window never stays stuck. Its errors are printed
  // in the terminal too, to help track problems down.
  const uiNames = new Map<WebContents, string>([
    [win.webContents, 'sidebar'],
    [floating.webContents, 'command bar'],
    [peek.webContents, 'peek'],
  ]);
  if (topBar) uiNames.set(topBar.webContents, 'top bar');
  for (const [web, name] of uiNames) {
    web.on('render-process-gone', (_event, details) => {
      console.error(
        `[Firn] The ${name} panel stopped (${details.reason}); reloading it.`,
      );
      if (!win.isDestroyed()) setTimeout(() => startUi(web), 300);
    });
    // While a panel (re)loads it hasn't started: take it off screen.
    web.on('did-start-loading', () => {
      readyUi.delete(web);
      for (const layer of shownLayers)
        if (layer.webContents === web) hideLayer(layer);
    });
    // Only reported: a hidden panel can look "unresponsive" to Windows
    // while it's simply asleep, and reloading it then would break it.
    web.on('unresponsive', () =>
      console.error(`[Firn] The ${name} panel is not responding.`),
    );
    web.on('console-message', (details) => {
      if (details.level === 'error')
        console.error(`[Firn] ${name} error: ${details.message}`);
    });
  }

  // Where the page starts: the sidebar's width, or just the inset when the
  // sidebar is collapsed. It glides between the two.
  let pageLeft = windowState.sidebarCollapsed
    ? PAGE_INSET
    : windowState.sidebarWidth;
  // Where the page's top edge is: lower while the top bar shows. While it
  // glides, only the top edge moves (the bottom stays put), and the site's
  // layout is held at its taller size so it doesn't re-fit on every step,
  // which looks jumpy; it re-fits once, when the glide ends.
  let pageTop = PAGE_INSET;

  // Sends a message to every part of Firn's UI.
  const send = (channel: string, ...args: unknown[]) => {
    for (const web of uiContents)
      if (!web.isDestroyed()) web.send(channel, ...args);
  };

  // A tab pulled out of the sidebar, carried under the pointer: the
  // floating layer draws it across the whole window, in front of the page
  // (the sidebar is drawn behind the page, so it can't).
  let carried: CarryTab | null = null;
  let carryHideTimer: ReturnType<typeof setTimeout> | undefined;

  // The handle at the top of one side of a split view: a small pill with a
  // grip (drag it over the other side to swap them) and a × (take that side
  // out of the split). It shows while the mouse is near the top middle of
  // a side, drawn by the floating layer in a small box of its own (`at`:
  // the pill's middle, in the window); dragged, it follows the pointer.
  let splitHandle: {
    tabId: string;
    at: { x: number; y: number };
    dragging: boolean;
  } | null = null;
  let splitHandleHideTimer: ReturnType<typeof setTimeout> | undefined;
  // It comes out only once the mouse rests near there a moment (sites
  // often keep a logo, a search box, or a menu up there, and a mouse just
  // passing on its way to them shouldn't bring it out).
  let splitHandleWait: { tabId: string; since: number } | null = null;
  const HANDLE_DELAY_MS = 350;
  const HANDLE_WIDTH = 76;
  const HANDLE_HEIGHT = 28;
  const HANDLE_ROOM = 20; // for its soft shadow
  const HANDLE_TOP = 8; // below the page's top edge
  // Where the mouse brings it out: this far either side of the middle, and
  // this far down from the top.
  const HANDLE_ZONE_ACROSS = 130;
  const HANDLE_ZONE_DOWN = 48;

  // The top bar's hover labels. The bar is too short to hold them, so the
  // floating layer draws them: shown as just the label's own small box
  // below the button (so nothing else on the page is covered), and only
  // while the floating layer isn't busy with anything else.
  let barTip: {
    anchor: { left: number; right: number; bottom: number };
    barBottom: number;
    size?: { width: number; height: number };
  } | null = null;
  // Room around the label for its soft shadow (the label sits this far
  // into the box, and TIP_TOP from its top; src/ui/tooltips.ts). The box
  // starts below the bar, never over it, so the pointer on the bar can't
  // slip onto it.
  const TIP_ROOM = 12;
  const TIP_TOP = 2;
  const TIP_GAP = 6;

  const boundsFor = (layer: WebContentsView) => {
    const [width, height] = win.getContentSize();
    if (
      layer === floating &&
      overlay.mode === 'hidden' &&
      !carried &&
      splitHandle
    )
      return {
        x: Math.round(splitHandle.at.x - HANDLE_WIDTH / 2 - HANDLE_ROOM),
        y: Math.round(splitHandle.at.y - HANDLE_HEIGHT / 2 - HANDLE_ROOM),
        width: HANDLE_WIDTH + HANDLE_ROOM * 2,
        height: HANDLE_HEIGHT + HANDLE_ROOM * 2,
      };
    if (layer === floating && overlay.mode === 'hidden' && barTip?.size) {
      const w = barTip.size.width + TIP_ROOM * 2;
      const h = barTip.size.height + TIP_TOP + TIP_ROOM;
      const centre = (barTip.anchor.left + barTip.anchor.right) / 2;
      const labelTop = Math.max(
        barTip.anchor.bottom + TIP_GAP,
        barTip.barBottom + TIP_TOP,
      );
      return {
        x: Math.round(Math.min(Math.max(centre - w / 2, 0), width - w)),
        y: Math.round(labelTop - TIP_TOP),
        width: Math.round(w),
        height: Math.round(h),
      };
    }
    if (layer === topBar) {
      // With the address bar at the top: across the whole window, with the
      // sidebar's top row moved up into it (the sidebar sits below). It's
      // all there at once, even while the page is still gliding down to
      // make room, so the top row's buttons never blink out as they move
      // over from the sidebar (the address bar fades in; styles.css).
      if (addressOnTop())
        return { x: 0, y: 0, width, height: TOP_ADDRESS_HEIGHT };
      // Only as tall as the gap above the page, so the bar's buttons are
      // revealed and covered exactly as the page's top edge glides.
      return {
        x: pageLeft,
        y: 0,
        width: Math.max(0, width - pageLeft),
        height: Math.min(
          pageTop,
          addressOnTop() ? TOP_ADDRESS_HEIGHT : TOP_BAR_HEIGHT,
        ),
      };
    }
    if (layer === floating && overlay.mode === 'find') return findBarBounds();
    if (
      layer === floating &&
      (overlay.mode === 'permission' || overlay.mode === 'password')
    )
      return permissionBounds();
    if (layer === floating && overlay.mode === 'danger' && shownDanger)
      return tabs.boundsOf(shownDanger.tabId);
    if (layer === peek) {
      // A little wider than the sidebar, so its soft shadow has room.
      const peekWidth = Math.min(width, windowState.sidebarWidth + 32);
      // With the address bar at the top, it slides out below the bar, its
      // panel level with the page (the panel sits an inset into the layer).
      const top = addressOnTop() ? TOP_ADDRESS_HEIGHT - PAGE_INSET : 0;
      return { x: 0, y: top, width: peekWidth, height: height - top };
    }
    return { x: 0, y: 0, width, height };
  };

  const layoutLayers = () => {
    for (const layer of shownLayers) layer.setBounds(boundsFor(layer));
  };

  // Stacking order, bottom to top.
  // The peeking sidebar slides in over the top bar, so its top row stays
  // clickable.
  const layerOrder = [topBar, peek, floating];

  // Lookout: a link previewed in a floating panel over the page (see the
  // Lookout section below). Its page floats above every layer.
  let lookout: {
    page: Page;
    favicon: string;
    openId: number;
    shown: boolean;
  } | null = null;

  // New tabs are added on top, so lift any shown layer back above them.
  const raiseLayers = () => {
    for (const layer of layerOrder)
      if (layer && shownLayers.has(layer)) win.contentView.addChildView(layer);
    if (lookout?.shown) lookout.page.raise();
  };

  // Returns false (and shows nothing) if the panel hasn't started yet, so a
  // blank, see-through panel can never sit over the window.
  const showLayer = (layer: WebContentsView) => {
    if (!readyUi.has(layer.webContents)) {
      debug(`not showing ${uiNames.get(layer.webContents)}: not started yet`);
      return false;
    }
    debug(`show ${uiNames.get(layer.webContents)}`);
    shownLayers.add(layer);
    layer.setBounds(boundsFor(layer));
    layer.setVisible(true);
    layer.webContents.send('layer:shown', true);
    raiseLayers();
    return true;
  };

  const hideLayer = (layer: WebContentsView) => {
    debug(`hide ${uiNames.get(layer.webContents)}`);
    shownLayers.delete(layer);
    layer.setVisible(false);
    layer.setBounds(NO_BOUNDS);
    if (!layer.webContents.isDestroyed())
      layer.webContents.send('layer:shown', false);
  };

  let overlay: OverlayState = { mode: 'hidden' };
  let commandOpenId = 0;

  const showOverlay = (state: OverlayState) => {
    if (!readyUi.has(floating.webContents)) return false;
    // Something else (the command bar, the switcher) replaces Lookout.
    if (state.mode !== 'lookout') dropLookout();
    if (overlay.mode === 'find' && state.mode !== 'find') tabs.stopFind();
    // Something else replaces a permission prompt: it waits its turn.
    if (overlay.mode === 'permission' && shownPermission) {
      pendingPermissions.unshift(shownPermission);
      shownPermission = null;
    }
    // A "save password?" card that's replaced is dropped; a warning waits
    // and comes back.
    if (overlay.mode === 'password' && state.mode !== 'password')
      shownLogin = null;
    if (overlay.mode === 'danger' && state.mode !== 'danger')
      shownDanger = null;
    // A panel replaces the top bar's hover label (and a split view's
    // handle).
    if (barTip) {
      barTip = null;
      floating.webContents.send('tip:state', { kind: 'hide' });
    }
    if (splitHandle) {
      splitHandle = null;
      floating.webContents.send('split-handle:state', { kind: 'hide' });
    }
    overlay = state;
    send('overlay:state', state);
    showLayer(floating);
    // A permission prompt doesn't take the keyboard from the page.
    if (
      state.mode !== 'hidden' &&
      state.mode !== 'lookout' &&
      state.mode !== 'permission' &&
      state.mode !== 'password'
    )
      floating.webContents.focus();
    return true;
  };
  const hideOverlay = () => {
    splitBeside = null;
    if (overlay.mode === 'lookout') return closeLookout();
    if (overlay.mode === 'hidden') return;
    if (overlay.mode === 'find') tabs.stopFind();
    // A "save password?" card closed by something else is dropped (it only
    // makes sense right after signing in).
    if (overlay.mode === 'password') shownLogin = null;
    if (overlay.mode === 'danger') shownDanger = null;
    const wasPermission =
      overlay.mode === 'permission' || overlay.mode === 'password';
    if (wasPermission && shownPermission) {
      pendingPermissions.unshift(shownPermission);
      shownPermission = null;
    }
    overlay = { mode: 'hidden' };
    send('overlay:state', overlay);
    hideLayer(floating);
    if (!wasPermission) tabs.focusActive();
    // A site that was waiting to ask can now.
    setImmediate(() => {
      showDanger();
      showNextPermission();
      showLoginPrompt();
    });
  };

  // --- Site permissions ------------------------------------------------------
  // Camera, microphone, location, notifications, clipboard and other apps:
  // a site has to ask, in a small prompt at the top-left of its page, and
  // the answer is remembered for that site (src/permissions.ts). A site
  // that isn't on screen waits until it is; one closed meanwhile is refused.
  const sitePermissions = new SitePermissions(
    path.join(app.getPath('userData'), 'permissions.json'),
  );
  type PendingPermission = {
    request: PermissionRequest;
    tabId: string;
    // The kinds still to ask about (others were allowed before).
    ask: PermissionKind[];
  };
  let pendingPermissions: PendingPermission[] = [];
  let shownPermission: PendingPermission | null = null;
  const PROMPT_WIDTH = 380;
  const PROMPT_HEIGHT = 112;
  const PROMPT_MARGIN = 20; // room for its shadow

  const permissionBounds = () => {
    const tabId =
      overlay.mode === 'password' ? shownLogin?.tabId : shownPermission?.tabId;
    const area = tabId ? tabs.boundsOf(tabId) : tabs.pageBoundsFor(pageTop);
    const width = Math.min(PROMPT_WIDTH, Math.max(0, area.width - 24));
    return {
      x: Math.round(area.x + 12 - PROMPT_MARGIN),
      y: Math.round(area.y + 12 - PROMPT_MARGIN),
      width: width + PROMPT_MARGIN * 2,
      height: PROMPT_HEIGHT + PROMPT_MARGIN * 2,
    };
  };

  const hostOf = (origin: string) => {
    try {
      return new URL(origin).host.replace(/^www\./, '');
    } catch {
      return origin;
    }
  };

  const askPhrase = ({ ask, request }: PendingPermission) => {
    const parts = ask.map((kind) =>
      PERMISSION_WORDING[kind].ask(request.detail),
    );
    // "use your camera and use your microphone" reads better shared.
    if (
      parts.length === 2 &&
      ask.includes('camera') &&
      ask.includes('microphone')
    )
      return 'use your camera and microphone';
    return parts.join(' and ');
  };

  const showNextPermission = () => {
    // Requests from tabs that have closed are refused.
    pendingPermissions = pendingPermissions.filter((p) => {
      const open = tabs.idOfPage(p.request.page!) === p.tabId;
      if (!open) p.request.respond(false);
      return open;
    });
    // The prompt's tab went off screen (another tab, another space): it
    // waits until it's back.
    if (shownPermission && !tabs.isOnScreen(shownPermission.tabId)) {
      hideOverlay();
      return;
    }
    if (shownPermission || overlay.mode !== 'hidden' || lookout) return;
    // A request settled by an answer given since it came (a site often
    // asks twice before you answer): not asked again.
    pendingPermissions = pendingPermissions.filter((p) => {
      const decisions = p.ask.map((kind) =>
        sitePermissions.get(p.request.origin, kind, p.request.detail),
      );
      if (decisions.includes('block')) p.request.respond(false);
      else if (decisions.every((d) => d === 'allow')) p.request.respond(true);
      else return true;
      return false;
    });
    const next = pendingPermissions.find((p) => tabs.isOnScreen(p.tabId));
    if (!next) return;
    pendingPermissions = pendingPermissions.filter((p) => p !== next);
    shownPermission = next;
    showOverlay({
      mode: 'permission',
      openId: ++commandOpenId,
      site: hostOf(next.request.origin),
      ask: askPhrase(next),
      kind: next.ask[0],
    });
  };

  const answerPermission = (answer: 'allow' | 'block' | 'dismiss') => {
    const shown = shownPermission;
    if (!shown || overlay.mode !== 'permission') return;
    shownPermission = null;
    const { request, ask } = shown;
    if (answer !== 'dismiss')
      for (const kind of ask)
        sitePermissions.set(request.origin, kind, request.detail, answer);
    request.respond(answer === 'allow');
    // The same question from the same tab, still waiting, gets the same
    // answer (also "not now", which isn't saved).
    pendingPermissions = pendingPermissions.filter((p) => {
      const same =
        p.tabId === shown.tabId &&
        p.request.origin === request.origin &&
        p.ask.every((kind) => ask.includes(kind));
      if (same) p.request.respond(answer === 'allow');
      return !same;
    });
    hideOverlay();
    sendNav();
  };

  // The address bar's state, plus whether the site has saved answers.
  const navState = () => {
    const state = tabs.navState();
    let origin = '';
    try {
      origin = new URL(state.url).origin;
    } catch {
      // No page (or not a web address).
    }
    return {
      ...state,
      sitePermissions:
        !!origin &&
        (Object.keys(sitePermissions.of(origin)).length > 0 ||
          (settings.adBlocking && adsAllowedOn(state.url))),
    };
  };
  const sendNav = () => send('nav:state', navState());

  // The address bar's site button: change or forget what this site may use.
  const showSiteMenu = () => {
    let origin = '';
    try {
      origin = new URL(tabs.navState().url).origin;
    } catch {
      return;
    }
    const decided = Object.entries(sitePermissions.of(origin));
    const items: Electron.MenuItemConstructorOptions[] = decided.map(
      ([key, decision]) => {
        const { kind, detail } = parseKey(key);
        const choose = (value: 'allow' | 'block') => () => {
          sitePermissions.set(origin, kind, detail, value);
          sendNav();
        };
        return {
          label: PERMISSION_WORDING[kind]?.label(detail) ?? key,
          submenu: [
            {
              label: 'Allow',
              type: 'radio' as const,
              checked: decision === 'allow',
              click: choose('allow'),
            },
            {
              label: 'Block',
              type: 'radio' as const,
              checked: decision === 'block',
              click: choose('block'),
            },
          ],
        };
      },
    );
    // Ads allowed here: shown, and can be blocked again.
    const page = tabs.activeTabId ? tabs.pageOf(tabs.activeTabId) : undefined;
    if (page && settings.adBlocking && adsAllowedOn(page.url))
      items.push({
        label: 'Ads and trackers',
        submenu: [
          {
            label: 'Allow',
            type: 'radio' as const,
            checked: true,
            click: () => {},
          },
          {
            label: 'Block',
            type: 'radio' as const,
            checked: false,
            click: () => setAdsAllowed(page, false),
          },
        ],
      });
    if (!items.length) return;
    items.unshift(
      { label: hostOf(origin), enabled: false },
      { type: 'separator' },
    );
    // (Only for the permissions; ads have their own item.)
    if (decided.length)
      items.push(
        { type: 'separator' },
        {
          label: 'Ask again next time',
          click: () => {
            sitePermissions.forget(origin);
            sendNav();
          },
        },
      );
    Menu.buildFromTemplate(items).popup({ window: win });
  };

  // --- Saved passwords ---------------------------------------------------------
  // After you sign in on a site (and the page moves on, as it does when a
  // sign-in works), a small card offers to save the login, or to update the
  // password; clicking into that site's login form later fills it in (the
  // page helper asks; see src/page-preload.ts). Passwords are encrypted with
  // the system's protection (src/passwords.ts).
  const passwords = new PasswordStore(
    path.join(app.getPath('userData'), 'passwords.json'),
    process.env.FIRN_INSECURE_TEST_PASSWORDS === '1'
      ? // Automated tests only, on machines without a keyring: NOT
        // encrypted. Never set this for real use.
        {
          available: () => true,
          encrypt: (text) => `test:${Buffer.from(text).toString('base64')}`,
          decrypt: (secret) =>
            Buffer.from(secret.replace(/^test:/, ''), 'base64').toString(),
        }
      : {
          // On Linux without a keyring, Chromium's "encryption" is plain
          // obfuscation; that's not good enough, so nothing is saved there.
          available: () =>
            safeStorage.isEncryptionAvailable() &&
            (process.platform !== 'linux' ||
              safeStorage.getSelectedStorageBackend() !== 'basic_text'),
          encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
          decrypt: (secret) =>
            safeStorage.decryptString(Buffer.from(secret, 'base64')),
        },
  );
  type PendingLogin = {
    tabId: string;
    origin: string;
    username: string;
    password: string;
    update: boolean;
    at: number;
    // The page has moved on since (the sign-in worked).
    ready: boolean;
  };
  let pendingLogin: PendingLogin | null = null;
  let shownLogin: PendingLogin | null = null;
  // How long after signing in the page may take to move on.
  const LOGIN_PROMPT_WINDOW_MS = 60 * 1000;

  const onLogin = (
    tabId: string,
    origin: string,
    username: string,
    password: string,
  ) => {
    if (!passwords.canSave) return;
    const status = passwords.compare(origin, username, password);
    if (status === 'same') return;
    pendingLogin = {
      tabId,
      origin,
      username,
      password,
      update: status === 'changed',
      at: Date.now(),
      ready: false,
    };
  };

  const onPageNavigated = (tabId: string) => {
    if (!pendingLogin || pendingLogin.tabId !== tabId) return;
    if (Date.now() - pendingLogin.at > LOGIN_PROMPT_WINDOW_MS) {
      pendingLogin = null;
      return;
    }
    pendingLogin.ready = true;
    showLoginPrompt();
  };

  const showLoginPrompt = () => {
    const login = pendingLogin;
    if (!login?.ready || shownLogin || overlay.mode !== 'hidden' || lookout)
      return;
    if (!tabs.isOnScreen(login.tabId)) return;
    pendingLogin = null;
    shownLogin = login;
    showOverlay({
      mode: 'password',
      openId: ++commandOpenId,
      site: hostOf(login.origin),
      username: login.username,
      update: login.update,
    });
  };

  const answerLogin = (answer: 'save' | 'dismiss') => {
    const login = shownLogin;
    if (!login || overlay.mode !== 'password') return;
    if (answer === 'save')
      passwords.save(login.origin, login.username, login.password);
    shownLogin = null;
    hideOverlay();
    send('passwords:changed');
  };

  const openPasswords = () => {
    showOverlay({ mode: 'passwords', openId: ++commandOpenId });
  };

  // --- Welcome ------------------------------------------------------------------
  // The first time Firn opens (no session yet), a few short steps: where the
  // address bar sits, the first space, Basecamp sites and a few tips. Each
  // choice applies right away (through the usual settings and space
  // messages), so it shows live behind the card. "Welcome" in the command
  // bar brings it back.
  let welcomePending = false;
  const openWelcome = () => {
    welcomePending = false;
    showOverlay({ mode: 'welcome', openId: ++commandOpenId });
  };
  const finishWelcome = (urls: unknown) => {
    if (overlay.mode !== 'welcome') return;
    const chosen = Array.isArray(urls)
      ? BASECAMP_SUGGESTIONS.filter((site) => urls.includes(site.url))
      : [];
    const inBasecamp = tabs
      .allTabs()
      .filter((t) => t.basecamp)
      .map((t) => hostOf(t.url));
    for (const site of chosen) {
      // Already there (the welcome was opened again).
      if (inBasecamp.includes(hostOf(site.url))) continue;
      tabs.addToBasecamp(tabs.create(site.url, { activate: false }));
    }
    changeSettings({ onboarded: true });
    hideOverlay();
  };

  // --- Scam and malware warnings ---------------------------------------------
  // Every page is checked against Google Safe Browsing before it loads, the
  // private way (see src/safebrowsing.ts). A dangerous one is stopped, and a
  // calm warning covers its tab: "Go back", or (small) "Visit anyway", which
  // lets that address through until Firn closes.
  const safeBrowsing = new SafeBrowsing({
    key: process.env.FIRN_SAFE_BROWSING_KEY || __FIRN_SAFE_BROWSING_KEY__,
    folder: path.join(app.getPath('userData'), 'safe-browsing'),
    clientVersion: app.getVersion(),
    // Automated tests only: a stand-in for Google's server.
    api: process.env.FIRN_SAFE_BROWSING_API || undefined,
    log: (message) => debug(`safe browsing: ${message}`),
  });
  const visitAnyway = new Set<string>();

  // --- Ads and trackers -------------------------------------------------------
  // Blocked by default (src/adblock.ts): what a page loads is checked
  // against the public block lists, kept on this computer. A site where the
  // person chose "Allow ads on this site" (its page menu, or the address
  // bar's site button) loads everything.
  const adBlocker = new AdBlocker(
    path.join(app.getPath('userData'), 'ad-block-lists.bin'),
    (message) => debug(message),
    // Automated tests only: a small list instead of downloading any.
    process.env.FIRN_AD_BLOCK_TEST_LIST,
  );
  // The site a page is on, as ads are allowed by ("www." left off).
  const adSiteOf = (url: string) => {
    try {
      const { protocol, hostname } = new URL(url);
      if (protocol !== 'http:' && protocol !== 'https:') return null;
      return hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  };
  const adsAllowedOn = (url: string) => {
    const site = adSiteOf(url);
    return !!site && settings.adsAllowedSites.includes(site);
  };
  // Allows ads on a page's site, or blocks them again, and reloads it so
  // that takes effect.
  const setAdsAllowed = (page: Page, allowed: boolean) => {
    const site = adSiteOf(page.url);
    if (!site) return;
    const others = settings.adsAllowedSites.filter((s) => s !== site);
    changeSettings({
      adsAllowedSites: allowed ? [...others, site] : others,
    });
    sendNav();
    page.reload();
  };
  type Danger = {
    tabId: string;
    url: string;
    threat: Threat;
    // Found in a Lookout preview (which closes): the tab underneath is fine.
    fromLookout: boolean;
  };
  const dangers = new Map<string, Danger>();
  let shownDanger: Danger | null = null;

  const showDanger = () => {
    for (const id of dangers.keys()) if (!tabs.pageOf(id)) dangers.delete(id);
    // Its tab went off screen: the warning waits until it's back.
    if (
      shownDanger &&
      (!tabs.isOnScreen(shownDanger.tabId) ||
        dangers.get(shownDanger.tabId) !== shownDanger)
    ) {
      shownDanger = null;
      if (overlay.mode === 'danger') hideOverlay();
    }
    if (shownDanger) return;
    // A warning comes before a permission card or "save password?".
    if (
      overlay.mode !== 'hidden' &&
      overlay.mode !== 'permission' &&
      overlay.mode !== 'password'
    )
      return;
    if (lookout) return;
    const next = [...dangers.values()].find((d) => tabs.isOnScreen(d.tabId));
    if (!next) return;
    shownDanger = next;
    showOverlay({
      mode: 'danger',
      openId: ++commandOpenId,
      site: hostOf(next.url),
      url: next.url,
      threat: next.threat,
    });
  };

  const onDangerFound = (page: Page | null, url: string, threat: string) => {
    let tabId = page ? tabs.idOfPage(page) : null;
    let fromLookout = false;
    if (!tabId && page && lookout?.page === page) {
      closeLookout();
      tabId = tabs.activeTabId;
      fromLookout = true;
    }
    if (!tabId) return;
    dangers.set(tabId, { tabId, url, threat: threat as Threat, fromLookout });
    if (shownDanger?.tabId === tabId) shownDanger = null;
    setImmediate(showDanger);
  };

  // The tab went somewhere else: its warning no longer applies.
  const dangerNavigated = (tabId: string) => {
    const danger = dangers.get(tabId);
    if (!danger || danger.fromLookout) return;
    if (tabs.pageOf(tabId)?.url !== danger.url) {
      dangers.delete(tabId);
      showDanger();
    }
  };

  const answerDanger = (answer: 'back' | 'visit') => {
    const danger = shownDanger;
    if (!danger || overlay.mode !== 'danger') return;
    dangers.delete(danger.tabId);
    shownDanger = null;
    hideOverlay();
    const page = tabs.pageOf(danger.tabId);
    if (answer === 'visit') {
      visitAnyway.add(danger.url);
      if (danger.fromLookout) openLookout(danger.url);
      else page?.load(danger.url);
    } else if (!danger.fromLookout) {
      // Back to the page before, or close the tab if there's none.
      if (page?.canGoBack) page.back();
      else tabs.close(danger.tabId);
    }
  };

  // --- Find in page ---------------------------------------------------------
  // A small bar in the top-right corner of the page (its side, in split
  // view). The floating layer shrinks to just the bar, so the page stays
  // usable around it.
  let findTabId: string | null = null;
  let lastFindText = '';
  const FIND_BAR_WIDTH = 340;
  const FIND_BAR_HEIGHT = 48;
  const FIND_BAR_MARGIN = 20; // room for its soft shadow

  const findBarBounds = () => {
    const area = findTabId
      ? tabs.boundsOf(findTabId)
      : tabs.pageBoundsFor(pageTop);
    const width = Math.min(FIND_BAR_WIDTH, Math.max(0, area.width - 24));
    return {
      x: Math.round(area.x + area.width - 12 - width - FIND_BAR_MARGIN),
      y: Math.round(area.y + 12 - FIND_BAR_MARGIN),
      width: width + FIND_BAR_MARGIN * 2,
      height: FIND_BAR_HEIGHT + FIND_BAR_MARGIN * 2,
    };
  };

  // The history panel: a calm floating sheet over the page.
  const openHistory = () => {
    showOverlay({ mode: 'history', openId: ++commandOpenId });
  };

  const openSettings = () => {
    showOverlay({ mode: 'settings', openId: ++commandOpenId });
  };

  const openFind = () => {
    if (lookout || !tabs.activeTabId) return;
    findTabId = tabs.activeTabId;
    showOverlay({ mode: 'find', openId: ++commandOpenId, text: lastFindText });
  };

  // --- The top bar with the window buttons -------------------------------
  // Reaching the frame edge above the page glides the page down a little and
  // shows the window buttons in the space above it. The bar has no
  // background of its own: the frame (frosted glass, where available) shows
  // through it, just like around the rest of the page.
  //
  // The bar's empty space moves the window like a title bar. Windows takes
  // over the mouse there, so the bar itself can't tell when the mouse
  // leaves; instead we check where the cursor is a few times a second.
  let topBarShown = false;
  let topBarHideTimer: ReturnType<typeof setTimeout> | undefined;
  let topBarWatch: ReturnType<typeof setInterval> | undefined;
  let mouseLastOverBar = 0;
  let topGlide: ReturnType<typeof setInterval> | undefined;

  // Slides the page's top edge, in step with the sidebar layer's outline of
  // the page (.page-area in styles.css).
  const glidePageTop = (to: number) => {
    const from = pageTop;
    const start = Date.now();
    clearInterval(topGlide);
    // Hold the site's layout at the taller of the two sizes for the glide;
    // the part that doesn't fit is simply hidden under the bottom edge.
    const { width, height } = tabs.pageBoundsFor(Math.min(from, to));
    tabs.holdLayout({ width, height });
    topGlide = setInterval(() => {
      if (win.isDestroyed()) return clearInterval(topGlide);
      const t = Math.min(1, (Date.now() - start) / GLIDE_MS);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      pageTop = Math.round(from + (to - from) * eased);
      tabs.layout();
      if (t === 1) {
        clearInterval(topGlide);
        tabs.holdLayout(null);
      }
      // The top bar's height follows the page edge (and the find bar, if
      // open, moves with the page).
      layoutLayers();
    }, 8);
  };

  // The cursor's position relative to the window's content area.
  const cursorInWindow = () => {
    const cursor = screen.getCursorScreenPoint();
    const content = win.getContentBounds();
    return {
      x: cursor.x - content.x,
      y: cursor.y - content.y,
      width: content.width,
      height: content.height,
    };
  };

  const mouseIsOverBar = () => {
    const { x, y, width } = cursorInWindow();
    return (
      x >= pageLeft &&
      x <= width &&
      y <= TOP_BAR_HEIGHT &&
      // A little slack above, for a maximized window's very top edge.
      y >= -4
    );
  };

  // With the address bar at the top, the bar stays (except in fullscreen).
  // Fullscreen, as the window's own events say (they can arrive before
  // isFullScreen() catches up), or a video filling the window.
  let windowFullscreen = false;
  const isFullscreen = () =>
    windowFullscreen || win.isFullScreen() || tabs.isFullscreen;
  const addressOnTop = () => settings.addressBar === 'top' && !isFullscreen();

  // Shows the top bar for good, or takes it away, to match the address bar
  // setting and fullscreen.
  const syncTopBar = (animate = true) => {
    syncTrafficLights();
    if (!readyUi.has(topBar.webContents)) return;
    // (Timers are cancelled only by a branch that takes over: cancelling a
    // bar's pending hide while it slides away would leave it on screen,
    // unseen, and on Windows its drag band would keep catching clicks at
    // the top of the page.)
    if (addressOnTop()) {
      clearInterval(topBarWatch);
      clearTimeout(topBarHideTimer);
      topBarShown = true;
      showLayer(topBar);
      send('top-bar:state', true);
      if (pageTop === TOP_ADDRESS_HEIGHT) return;
      if (animate) glidePageTop(TOP_ADDRESS_HEIGHT);
      else {
        pageTop = TOP_ADDRESS_HEIGHT;
        relayout();
      }
    } else if (topBarShown) {
      clearInterval(topBarWatch);
      clearTimeout(topBarHideTimer);
      topBarShown = false;
      send('top-bar:state', false);
      if (isFullscreen()) {
        // A fullscreen video fills the window right away.
        pageTop = PAGE_INSET;
        hideLayer(topBar);
        relayout();
        return;
      }
      glidePageTop(PAGE_INSET);
      topBarHideTimer = setTimeout(() => hideLayer(topBar), 260);
    }
  };

  // On macOS the window's top edge moves it by itself (.window-grip in
  // styles.css), and its window buttons stay in the sidebar, so no bar.
  const revealTopBar = (reveal: boolean) => {
    if (addressOnTop() || process.platform === 'darwin') return;
    if (reveal && !isFullscreen()) {
      if (topBarShown || !readyUi.has(topBar.webContents)) return;
      topBarShown = true;
      clearTimeout(topBarHideTimer);
      showLayer(topBar);
      send('top-bar:state', true);
      glidePageTop(TOP_BAR_HEIGHT);
      mouseLastOverBar = Date.now();
      topBarWatch = setInterval(() => {
        if (win.isDestroyed()) return;
        if (mouseIsOverBar()) mouseLastOverBar = Date.now();
        else if (Date.now() - mouseLastOverBar > TOP_BAR_LINGER_MS)
          revealTopBar(false);
      }, 50);
    } else if (topBarShown) {
      topBarShown = false;
      clearInterval(topBarWatch);
      send('top-bar:state', false);
      glidePageTop(PAGE_INSET);
      // Let the slide back up finish before the bar's layer goes away.
      topBarHideTimer = setTimeout(() => hideLayer(topBar), 260);
    }
  };

  // --- Tabs ---------------------------------------------------------------

  // Pages visited, for the command bar (history.json next to the session).
  const history = new History(
    path.join(app.getPath('userData'), 'history.json'),
  );

  // Web pages come from the Electron engine; the tab model itself doesn't
  // depend on Electron (see src/engine/engine.ts).
  const engine = new ElectronEngine(win, (web) => {
    watchShortcuts(web);
    raiseLayers();
  });

  // --- Settings ---------------------------------------------------------------
  // The few things a person can change (src/settings.ts), applied right
  // away and saved in settings.json.
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  let settings = loadSettings(settingsFile);
  // The welcome shows on a first run; someone who used Firn before it
  // existed has set things up already.
  if (!settings.onboarded) {
    if (saved) {
      settings = { ...settings, onboarded: true };
      saveSettings(settingsFile, settings);
    } else welcomePending = true;
  }
  // What's new: the first start after an update shows the release notes
  // since the version that ran before (src/ui/WhatsNew.tsx), once. A fresh
  // install gets the welcome instead; its version is noted right away.
  const version = app.getVersion();
  let whatsNewSince: string | null =
    settings.onboarded && settings.lastVersion !== version
      ? settings.lastVersion
      : null;
  if (settings.lastVersion !== version) {
    settings = { ...settings, lastVersion: version };
    saveSettings(settingsFile, settings);
  }
  // `since`: '' for just this version's notes (from a menu).
  const openWhatsNew = (since: string) => {
    whatsNewSince = null;
    showOverlay({ mode: 'whats-new', openId: ++commandOpenId, since });
  };
  const applySettings = () => {
    setSearchEngine(settings.searchEngine);
    // Demo mode: always light, and no calls to Safe Browsing.
    nativeTheme.themeSource = DEMO ? 'light' : settings.theme;
    if (settings.safeBrowsing && !DEMO) safeBrowsing.start();
    else safeBrowsing.stop();
    if (settings.adBlocking) adBlocker.start();
  };
  applySettings();
  // The folder downloads go to (the system's Downloads folder unless one
  // was chosen, and it still exists).
  const downloadsFolder = () =>
    settings.downloadsFolder && fs.existsSync(settings.downloadsFolder)
      ? settings.downloadsFolder
      : app.getPath('downloads');
  // Whether Firn is the default browser (src/defaultBrowser.ts), looked
  // up when the window opens and each time it comes back into focus (say,
  // from Windows' Default apps settings).
  let defaultBrowser: DefaultBrowserState = 'unavailable';
  const refreshDefaultBrowser = () =>
    void defaultBrowserState().then((state) => {
      if (state === defaultBrowser || win.isDestroyed()) return;
      defaultBrowser = state;
      send('settings:state', settingsState());
    });
  refreshDefaultBrowser();
  win.on('focus', refreshDefaultBrowser);
  const settingsState = () => ({
    settings,
    downloadsFolder: downloadsFolder(),
    version: app.getVersion(),
    updates: updateState(),
    safeBrowsingAvailable: safeBrowsing.available,
    defaultBrowser,
  });
  const changeSettings = (changes: unknown) => {
    settings = cleanSettings(changes, settings);
    applySettings();
    saveSettings(settingsFile, settings);
    send('settings:state', settingsState());
    syncTopBar();
    // (A shorter time may make some tabs old right away.)
    tidyOldTabs();
  };

  // Downloads go straight to the Downloads folder; the sidebar shows them.
  const downloads = new Downloads(
    path.join(app.getPath('userData'), 'downloads.json'),
    downloadsFolder,
    (list) => send('downloads:state', list),
  );
  engine.onDownload((item) => downloads.add(item));
  engine.setSavedLoginProvider((origin) => passwords.loginFor(origin));
  engine.setNavigationGuard(
    (url) => (visitAnyway.has(url) ? null : safeBrowsing.check(url)),
    onDangerFound,
  );
  engine.setRequestBlocker(
    (url, type, pageUrl) =>
      settings.adBlocking &&
      !adsAllowedOn(pageUrl) &&
      adBlocker.shouldBlock(url, type, pageUrl),
  );
  // A site asking for the camera and so on: answered from what was decided
  // before, or asked (see "Site permissions" above).
  engine.onPermissionRequest(
    (request) => {
      const decisions = request.kinds.map((kind) =>
        sitePermissions.get(request.origin, kind, request.detail),
      );
      if (decisions.includes('block')) return request.respond(false);
      // Demo mode: nothing asks (a question would end up in a clip).
      if (DEMO) return request.respond(false);
      if (decisions.every((d) => d === 'allow')) return request.respond(true);
      // Only tabs ask (not Lookout previews or popups).
      const tabId = request.page ? tabs.idOfPage(request.page) : null;
      if (!tabId || !request.origin) return request.respond(false);
      pendingPermissions.push({
        request,
        tabId,
        ask: request.kinds.filter((_, i) => decisions[i] !== 'allow'),
      });
      showNextPermission();
    },
    (origin, kind, detail) =>
      sitePermissions.get(origin, kind, detail) === 'allow',
  );
  // Coming back to Firn (perhaps from moving or deleting a downloaded
  // file): check the list again.
  win.on('focus', () => send('downloads:state', downloads.all()));
  const tabs = new TabManager(engine, {
    spaceId: windowState.activeSpaceId,
    pageRadius: PAGE_RADIUS,
    // The page floats to the right of the sidebar, inset from the edges.
    // `top` is where its top edge is (it lowers while the top bar shows).
    pageBounds: (top = pageTop) => {
      const [width, height] = win.getContentSize();
      return {
        x: pageLeft,
        y: top,
        width: Math.max(0, width - pageLeft - PAGE_INSET),
        height: Math.max(0, height - top - PAGE_INSET),
      };
    },
    onTabsChanged: (state) => {
      windowState.activeTabId = state.activeTabId;
      saver.schedule();
      send('tabs:state', state);
      // Find in page belongs to the tab it was opened on.
      if (overlay.mode === 'find' && state.activeTabId !== findTabId)
        hideOverlay();
      showDanger();
      showNextPermission();
      showLoginPrompt();
    },
    onNavChanged: (state) => {
      if (!win.isDestroyed()) win.setTitle(windowTitle(state.title));
      sendNav();
    },
    onEmpty: () => openCommandBar(),
    onLookout: (url) => openLookout(url),
    onVisit: (url, title, favicon, newVisit) =>
      history.visit(url, title, favicon, newVisit),
    onFindResult: (result) => {
      if (!floating.webContents.isDestroyed())
        floating.webContents.send('find:result', result);
    },
    onSiteZoomChanged: () => saver.schedule(),
    onFullscreenChange: () => syncTopBar(),
    onLogin: (id, origin, username, password) =>
      onLogin(id, origin, username, password),
    onPageNavigated: (id) => {
      onPageNavigated(id);
      dangerNavigated(id);
    },
    onContextMenu: (id, menu) => {
      const page = tabs.pageOf(id);
      if (page) showPageMenu(menu, page, id);
    },
  });
  tabs.restoreSiteZoom(saved?.siteZoom);

  const relayout = () => {
    tabs.layout();
    layoutLayers();
    layoutLookout();
  };
  win.on('resize', relayout);

  // --- Lookout -----------------------------------------------------------------
  // Shift+clicking a link previews it in a rounded panel floating over the
  // page, with the page dimmed behind it. Esc or a click outside closes it;
  // "Open as tab" grows the panel into the page and keeps it as a tab.
  //
  // The floating layer draws the dimmed backdrop, a stand-in panel that
  // scales in, and the buttons beside it; the real page appears on top of
  // the stand-in once it has scaled in.

  const LOOKOUT_RADIUS = 14; // matches the panel radius in styles.css
  let lookoutTimer: ReturnType<typeof setTimeout> | undefined;
  let lookoutGlide: ReturnType<typeof setInterval> | undefined;

  // The page's area, and the panel centered within it.
  const lookoutArea = () => tabs.pageBoundsFor(pageTop);
  const lookoutPanel = () => {
    const area = lookoutArea();
    const marginX = Math.max(56, Math.round(area.width * 0.08));
    const marginY = 24;
    return {
      x: area.x + marginX,
      y: area.y + marginY,
      width: Math.max(0, area.width - marginX * 2),
      height: Math.max(0, area.height - marginY * 2),
    };
  };

  const sendLookout = (phase: 'open' | 'closing' | 'expanding') => {
    if (!lookout && phase === 'open') return;
    const openId =
      lookout?.openId ?? (overlay.mode === 'lookout' ? overlay.openId : 0);
    showOverlay({
      mode: 'lookout',
      openId,
      phase,
      area: lookoutArea(),
      panel: lookoutPanel(),
    });
  };

  const openLookout = (url: string) => {
    // Already open: show the new link in the same panel.
    if (lookout) {
      lookout.page.load(url);
      return;
    }
    if (overlay.mode !== 'hidden') hideOverlay();
    const page = engine.createPage({
      onUpdate: () => {},
      onFavicon: (icon) => {
        if (lookout?.page === page) lookout.favicon = icon;
      },
      onNavigationStart: () => {},
      // Links in the preview that ask for a new tab open one quietly.
      onOpenTab: (link) => void tabs.create(link, { activate: false }),
      onLookout: (link) => page.load(link),
      onFullscreen: () => {},
      onFocus: () => {},
      onFindResult: () => {},
      onZoomRequest: () => {},
      onContextMenu: (menu) => showPageMenu(menu, page, null),
      // Signing in inside a preview isn't saved (it's not a tab).
      onLogin: () => {},
    });
    lookout = { page, favicon: '', openId: ++commandOpenId, shown: false };
    page.load(url);
    page.place(lookoutPanel(), LOOKOUT_RADIUS);
    sendLookout('open');
    // Show the page once the stand-in panel has scaled in.
    clearTimeout(lookoutTimer);
    lookoutTimer = setTimeout(() => {
      if (lookout?.page !== page) return;
      lookout.shown = true;
      page.show();
      page.raise();
      page.focus();
    }, GLIDE_MS);
  };

  // Closes Lookout at once (something else is taking its place).
  const dropLookout = () => {
    if (!lookout) return;
    clearTimeout(lookoutTimer);
    lookout.page.destroy();
    lookout = null;
  };

  // Closes Lookout gently: the page goes, the stand-in panel and backdrop
  // fade away.
  const closeLookout = () => {
    if (!lookout) return;
    dropLookout();
    sendLookout('closing');
    clearTimeout(lookoutTimer);
    lookoutTimer = setTimeout(() => {
      if (overlay.mode !== 'lookout' || overlay.phase !== 'closing') return;
      overlay = { mode: 'hidden' };
      send('overlay:state', overlay);
      hideLayer(floating);
      // A warning about the previewed site can show now.
      showDanger();
    }, GLIDE_MS);
    tabs.focusActive();
  };

  // "Open as tab": the panel grows into the page, then becomes a tab.
  const expandLookout = () => {
    if (!lookout) return;
    const { page, favicon } = lookout;
    clearTimeout(lookoutTimer);
    lookout = null;
    sendLookout('expanding');
    page.show();
    page.raise();
    const from = lookoutPanel();
    const to = lookoutArea();
    // Lay the page out at its final size right away, so it doesn't re-fit
    // on every step of the glide.
    page.holdLayout({ width: to.width, height: to.height });
    const start = Date.now();
    clearInterval(lookoutGlide);
    lookoutGlide = setInterval(() => {
      if (win.isDestroyed()) return clearInterval(lookoutGlide);
      const t = Math.min(1, (Date.now() - start) / GLIDE_MS);
      const e = 1 - Math.pow(1 - t, 3); // ease-out
      const mix = (a: number, b: number) => Math.round(a + (b - a) * e);
      page.place(
        {
          x: mix(from.x, to.x),
          y: mix(from.y, to.y),
          width: mix(from.width, to.width),
          height: mix(from.height, to.height),
        },
        mix(LOOKOUT_RADIUS, PAGE_RADIUS),
      );
      if (t < 1) return;
      clearInterval(lookoutGlide);
      page.holdLayout(null);
      overlay = { mode: 'hidden' };
      send('overlay:state', overlay);
      hideLayer(floating);
      tabs.adopt(page, favicon);
    }, 8);
  };

  // Keeps the panel centered when the window changes size.
  const layoutLookout = () => {
    if (!lookout || overlay.mode !== 'lookout') return;
    lookout.page.place(lookoutPanel(), LOOKOUT_RADIUS);
    sendLookout('open');
  };

  // --- Sidebar: resize, collapse, peek -------------------------------------

  let peeking = false;
  // The peeking sidebar settling into the docked one's place (see hidePeek).
  let docking = false;
  let peekWatch: ReturnType<typeof setInterval> | undefined;
  let peekHideTimer: ReturnType<typeof setTimeout> | undefined;
  let glide: ReturnType<typeof setInterval> | undefined;

  const sendSidebar = () =>
    send('sidebar:state', {
      width: windowState.sidebarWidth,
      collapsed: windowState.sidebarCollapsed,
      pageLeft,
      peeking,
      docking,
      aside: peekAside,
    });

  // Slides the page's left edge (and the sidebar with it) to a new spot.
  // Each step is sent to the UI too, so the sidebar moves in step with the
  // page. Like glidePageTop, the site's layout is held at the wider of the
  // two sizes for the glide, so it re-fits once at the end instead of on
  // every step.
  const glidePageLeft = (to: number) => {
    const from = pageLeft;
    const start = Date.now();
    clearInterval(glide);
    const [contentWidth] = win.getContentSize();
    tabs.holdLayout({
      width: Math.max(0, contentWidth - Math.min(from, to) - PAGE_INSET),
      height: tabs.pageBoundsFor(pageTop).height,
    });
    glide = setInterval(() => {
      if (win.isDestroyed()) return clearInterval(glide);
      const t = Math.min(1, (Date.now() - start) / GLIDE_MS);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      pageLeft = Math.round(from + (to - from) * eased);
      relayout();
      sendSidebar();
      if (t === 1) {
        clearInterval(glide);
        tabs.holdLayout(null);
      }
    }, 16);
  };

  // macOS: the traffic lights belong to the sidebar's top row, and move
  // with it, like part of the sidebar: out and back with it, along with the
  // peeking sidebar, sliding past the window's edge as it goes. macOS draws
  // them itself, at once, while the sidebar is drawn by its layer a moment
  // later, so they can't simply be slid along on a timer of their own (they
  // ran ahead). Instead each sidebar (the window's and the peeking one)
  // reports where its top row is actually drawn, frame by frame while it
  // moves ('lights:at'), and the lights go there; the one further out wins.
  // With the address bar "At the top", they stay at the left of the top bar
  // instead, whatever the sidebar does (it slides out below the bar).
  const lightsAt = new Map<WebContents, { x: number; y: number }>();
  // They start in the sidebar (trafficLightPosition), until it reports.
  if (!windowState.sidebarCollapsed)
    lightsAt.set(win.webContents, LIGHTS_IN_SIDEBAR);
  let lightsShown: string | null =
    `${LIGHTS_IN_SIDEBAR.x},${LIGHTS_IN_SIDEBAR.y}`;
  const syncTrafficLights = () => {
    if (process.platform !== 'darwin' || win.isDestroyed()) return;
    let place: { x: number; y: number } | null = null;
    if (addressOnTop()) place = LIGHTS_IN_TOP_BAR;
    else
      for (const at of lightsAt.values())
        if (at.x > LIGHTS_GONE_X && (!place || at.x > place.x)) place = at;
    const key = place ? `${place.x},${place.y}` : null;
    if (key === lightsShown) return;
    const wasShown = lightsShown !== null;
    lightsShown = key;
    if (!place) return win.setWindowButtonVisibility(false);
    if (wasShown) return win.setWindowButtonPosition(place);
    // Shown first, then placed: macOS forgets a place given while they're
    // hidden and shows them in its default spot instead. Placed once more
    // a moment later, in case it lays them out again as they appear.
    win.setWindowButtonVisibility(true);
    win.setWindowButtonPosition(place);
    setTimeout(() => {
      if (!win.isDestroyed() && lightsShown === key)
        win.setWindowButtonPosition(place);
    }, 50);
  };

  const setSidebarCollapsed = (collapsed: boolean) => {
    if (windowState.sidebarCollapsed === collapsed) return;
    windowState.sidebarCollapsed = collapsed;
    // Kept open while peeking: the peeking sidebar becomes the docked one.
    hidePeek(!collapsed);
    glidePageLeft(collapsed ? PAGE_INSET : windowState.sidebarWidth);
    saver.schedule();
  };

  const setSidebarWidth = (requested: number) => {
    const width = Math.round(
      Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, requested)),
    );
    if (width === windowState.sidebarWidth) return;
    windowState.sidebarWidth = width;
    if (!windowState.sidebarCollapsed) {
      clearInterval(glide);
      tabs.holdLayout(null);
      pageLeft = width;
    }
    relayout();
    sendSidebar();
    saver.schedule();
  };

  // While collapsed, reaching the left edge slides the sidebar in over the
  // page. It tucks away once the mouse has left it (checked by cursor
  // position, like the top bar, since its top row moves the window).
  const mouseIsOverPeek = () => {
    const { x, y, height } = cursorInWindow();
    return (
      x >= -PEEK_LEFT_SLACK &&
      x <= windowState.sidebarWidth + PEEK_RIGHT_SLACK &&
      y >= -200 &&
      y <= height + 200
    );
  };

  // Typing in the peeking sidebar (it says so; see src/ui/Peek.tsx).
  let peekTyping = false;
  // The mouse button held down in it (a drag, maybe out onto the page).
  let peekHolding = false;
  // A tab dragged out of it is over the page: it steps aside (sliding out
  // of view), but its layer stays to finish the drag.
  let peekAside = false;

  const showPeek = () => {
    if (!windowState.sidebarCollapsed || peeking || isFullscreen()) return;
    if (!readyUi.has(peek.webContents)) return;
    peeking = true;
    docking = false;
    clearTimeout(peekHideTimer);
    showLayer(peek);
    sendSidebar();
    let lastOver = Date.now();
    peekWatch = setInterval(() => {
      if (win.isDestroyed()) return;
      // Stay while the mouse is over it, or while typing in it (its address
      // bar or a space's name).
      if (mouseIsOverPeek() || peekTyping || peekHolding) lastOver = Date.now();
      else {
        // Gone far off to the left: a little more patience than when
        // coming back over the page.
        const linger =
          cursorInWindow().x < 0 ? PEEK_LEFT_LINGER_MS : PEEK_LINGER_MS;
        if (Date.now() - lastOver > linger) hidePeek();
      }
    }, 50);
  };

  // Slides the peeking sidebar away; or, when it's kept open (`dock`), lets
  // it settle into the docked sidebar's place while the page makes room
  // (src/ui/styles.css, ".peek.is-docking"), like Arc: the docked sidebar
  // waits underneath, already in place, and takes over when it's done.
  const hidePeek = (dock = false) => {
    if (!peeking) {
      // Hidden again while still settling: no need to wait.
      if (docking && !dock) {
        clearTimeout(peekHideTimer);
        docking = false;
        hideLayer(peek);
        lightsAt.delete(peek.webContents);
        sendSidebar();
        syncTrafficLights();
      }
      return;
    }
    peeking = false;
    docking = dock;
    peekTyping = false;
    peekHolding = false;
    peekAside = false;
    clearInterval(peekWatch);
    sendSidebar();
    // Let it slide away (or settle, then fade: see styles.css) before the
    // layer goes.
    peekHideTimer = setTimeout(
      () => {
        if (peeking) return;
        hideLayer(peek);
        lightsAt.delete(peek.webContents);
        if (docking) {
          docking = false;
          sendSidebar();
        }
        syncTrafficLights();
      },
      dock ? GLIDE_MS + 140 : GLIDE_MS + 60,
    );
  };

  // --- A split view's handles -------------------------------------------------

  const hideSplitHandle = () => {
    if (!splitHandle) return;
    splitHandle = null;
    clearTimeout(splitHandleHideTimer);
    splitHandleHideTimer = undefined;
    // It fades, then the layer goes (unless something else is on it).
    floating.webContents.send('split-handle:state', { kind: 'hide' });
    setTimeout(() => {
      if (!splitHandle && !carried && !barTip && overlay.mode === 'hidden')
        hideLayer(floating);
    }, 180);
  };

  // Brings out (or keeps, or moves along) the handle of the side the mouse
  // is near the top middle of (`x`, `y`: the mouse, in the window).
  const watchSplitHandle = (x: number, y: number) => {
    if (splitHandle?.dragging) return;
    const split =
      overlay.mode === 'hidden' && !carried && readyUi.has(floating.webContents)
        ? tabs.splitOnScreen()
        : null;
    if (!split) return hideSplitHandle();
    const near = split.tabIds.find((id) => {
      const r = split.rects[id];
      return (
        Math.abs(x - (r.x + r.width / 2)) <= HANDLE_ZONE_ACROSS &&
        y >= r.y - 4 &&
        y <= r.y + HANDLE_ZONE_DOWN
      );
    });
    if (!near) splitHandleWait = null;
    if (!near) {
      // A moment's grace, so it doesn't flicker at the zone's edge.
      if (splitHandle && !splitHandleHideTimer)
        splitHandleHideTimer = setTimeout(hideSplitHandle, 250);
      return;
    }
    clearTimeout(splitHandleHideTimer);
    splitHandleHideTimer = undefined;
    if (!splitHandle) {
      if (splitHandleWait?.tabId !== near)
        splitHandleWait = { tabId: near, since: Date.now() };
      if (Date.now() - splitHandleWait.since < HANDLE_DELAY_MS) return;
    }
    const r = split.rects[near];
    const at = {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + HANDLE_TOP + HANDLE_HEIGHT / 2),
    };
    if (
      splitHandle?.tabId === near &&
      splitHandle.at.x === at.x &&
      splitHandle.at.y === at.y
    )
      return;
    const fresh = splitHandle?.tabId !== near;
    if (barTip) {
      barTip = null;
      floating.webContents.send('tip:state', { kind: 'hide' });
    }
    splitHandle = { tabId: near, at, dragging: false };
    if (shownLayers.has(floating)) floating.setBounds(boundsFor(floating));
    else showLayer(floating);
    if (fresh)
      floating.webContents.send('split-handle:state', {
        kind: 'show',
        tabId: near,
      });
  };

  // Reaching the window's edges reveals things: the left edge brings the
  // collapsed sidebar out to peek, the top edge above the page brings down
  // the window buttons. This checks the cursor's position directly rather
  // than waiting for hover events, which never fire again while the pointer
  // stays pressed against the screen's edge (e.g. a maximized window).
  let edgeWatch: ReturnType<typeof setTimeout> | undefined;
  let topEdgeSince = 0;
  const watchEdges = () => {
    if (win.isDestroyed()) return;
    const away = !win.isVisible() || win.isMinimized() || isFullscreen();
    edgeWatch = setTimeout(
      watchEdges,
      away
        ? EDGE_CHECK_AWAY_MS
        : win.isFocused()
          ? EDGE_CHECK_MS
          : EDGE_CHECK_BACKGROUND_MS,
    );
    if (!away) checkEdges();
  };
  // Back in front: straight to the quick checks.
  win.on('focus', () => {
    clearTimeout(edgeWatch);
    watchEdges();
  });
  const checkEdges = () => {
    const cursor = screen.getCursorScreenPoint();
    const content = win.getContentBounds();
    // Measure from the part of the window that's actually on screen: a
    // maximized window on Windows reaches a few pixels past the screen's
    // edges, where the mouse can't go.
    const display = screen.getDisplayMatching(content).bounds;
    const left = Math.max(content.x, display.x);
    const top = Math.max(content.y, display.y);
    const right = content.x + content.width;
    const bottom = content.y + content.height;
    // (Below the bar, when the address bar is at the top: up there, the
    // mouse is on its way to the traffic lights or the buttons.)
    const alongLeftEdge =
      cursor.x >= left - PEEK_ZONE_OUTSIDE &&
      cursor.x < left + PEEK_ZONE_INSIDE &&
      cursor.y >= Math.max(top, content.y + (addressOnTop() ? pageTop : 0)) &&
      cursor.y <= bottom;
    // The strip of frame above the page; where the page itself reaches the
    // screen's top (a maximized window), only the screen's very top edge,
    // so a site's own search box or menu up there stays the site's.
    const alongTopEdge =
      cursor.y >= top - 2 &&
      cursor.y < Math.max(content.y + PAGE_INSET, top + 2) &&
      cursor.x >= content.x + pageLeft &&
      cursor.x <= right + 2;
    if (alongLeftEdge && windowState.sidebarCollapsed && !peeking) {
      debug('left edge reached: peek');
      showPeek();
    }
    if (!alongTopEdge || topBarShown) topEdgeSince = 0;
    else if (!topEdgeSince) topEdgeSince = Date.now();
    else if (Date.now() - topEdgeSince >= TOP_BAR_DWELL_MS) {
      debug('top edge reached: top bar');
      revealTopBar(true);
    }
    watchSplitHandle(cursor.x - content.x, cursor.y - content.y);
  };
  watchEdges();

  // Right-click menu for a web page: only the few things that fit what was
  // clicked (a link, an image, selected text, a text box), in plain words.
  // `tabId` is null for a page previewed in Lookout.
  const showPageMenu = (
    menu: PageContextMenu,
    page: Page,
    tabId: string | null,
  ) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    const section = (more: Electron.MenuItemConstructorOptions[]) => {
      if (!more.length) return;
      if (items.length) items.push({ type: 'separator' });
      items.push(...more);
    };
    // New tabs from here open right below the tab, in the background.
    const openTab = (url: string, activate = false) =>
      tabs.create(url, {
        after: tabId ?? undefined,
        activate: activate && !!tabId,
      });

    if (menu.isEditable && menu.misspelledWord)
      section(
        menu.suggestions.length
          ? menu.suggestions.slice(0, 3).map((word) => ({
              label: word,
              click: () => menu.replaceMisspelling(word),
            }))
          : [{ label: 'No spelling suggestions', enabled: false }],
      );

    if (/^https?:/i.test(menu.linkUrl))
      section([
        { label: 'Open link in new tab', click: () => openTab(menu.linkUrl) },
        {
          label: 'Open link in Lookout',
          click: () =>
            tabId ? openLookout(menu.linkUrl) : page.load(menu.linkUrl),
        },
        {
          label: 'Copy link',
          click: () => clipboard.writeText(menu.linkUrl),
        },
      ]);
    else if (menu.linkUrl)
      section([
        {
          label: /^mailto:/i.test(menu.linkUrl)
            ? 'Copy email address'
            : 'Copy link',
          click: () =>
            clipboard.writeText(menu.linkUrl.replace(/^mailto:/i, '')),
        },
      ]);

    if (menu.imageUrl)
      section([
        { label: 'Save image', click: () => menu.saveImage() },
        { label: 'Copy image', click: () => menu.copyImage() },
      ]);

    const selection = menu.selectionText.trim().replace(/\s+/g, ' ');
    if (menu.isEditable) {
      section([
        { label: 'Cut', enabled: menu.canCut, click: () => menu.cut() },
        { label: 'Copy', enabled: menu.canCopy, click: () => menu.copy() },
        { label: 'Paste', enabled: menu.canPaste, click: () => menu.paste() },
        { label: 'Select all', click: () => menu.selectAll() },
      ]);
    } else if (selection) {
      const shown =
        selection.length > 28 ? `${selection.slice(0, 26)}…` : selection;
      section([
        { label: 'Copy', click: () => menu.copy() },
        {
          label: `Search for “${shown}”`,
          click: () => openTab(searchUrl(selection), true),
        },
      ]);
    }

    // Nothing in particular under the mouse: the page itself.
    if (!items.length) {
      section([
        { label: 'Back', enabled: page.canGoBack, click: () => page.back() },
        {
          label: 'Forward',
          enabled: page.canGoForward,
          click: () => page.forward(),
        },
        { label: 'Reload', click: () => page.reload() },
      ]);
      // The way out when blocking ads breaks a site.
      if (settings.adBlocking && adSiteOf(page.url)) {
        const allowed = adsAllowedOn(page.url);
        section([
          {
            label: allowed
              ? 'Block ads on this site'
              : 'Allow ads on this site',
            click: () => setAdsAllowed(page, !allowed),
          },
        ]);
      }
    }

    Menu.buildFromTemplate(items).popup({ window: win });
  };

  // Right-click menu for a tab.
  const showTabMenu = (id: string) => {
    const tab = tabs.state().tabs.find((t) => t.id === id);
    if (!tab) return;
    const count = tabs.basecampCount;
    const addToBasecamp: Electron.MenuItemConstructorOptions = {
      label: `Add to Basecamp  (${count}/${BASECAMP_MAX})`,
      enabled: count < BASECAMP_MAX,
      click: () => tabs.addToBasecamp(id),
    };
    const others = spaces.filter((s) => s.id !== tabs.activeSpaceId);
    const moveToSpace: Electron.MenuItemConstructorOptions[] = others.length
      ? [
          {
            label: 'Move to space',
            submenu: others.map((space) => ({
              label: space.name,
              icon: colorSwatch(space.color),
              click: () => tabs.moveToSpace(id, space.id),
            })),
          },
        ]
      : [];
    // Split view: show this tab beside the current one, or end the split.
    const shortTitle = (title: string) =>
      title.length > 42 ? `${title.slice(0, 40)}…` : title;
    const splitItems: Electron.MenuItemConstructorOptions[] = tab.splitId
      ? [
          { label: 'Separate split view', click: () => tabs.unsplit(id) },
          { type: 'separator' },
        ]
      : id === tabs.activeTabId
        ? [
            // The current tab: pick what goes beside it.
            {
              label: 'Split view with',
              submenu: [
                ...tabs.splitCandidates().map((other) => ({
                  label: shortTitle(other.title || other.url),
                  click: () => tabs.splitWith(other.id),
                })),
                ...(tabs.splitCandidates().length
                  ? [{ type: 'separator' as const }]
                  : []),
                { label: 'New tab…', click: () => openCommandBar(id) },
              ],
            },
            { type: 'separator' },
          ]
        : tabs.canSplitWith(id)
          ? [
              {
                label: 'Split view with current tab',
                click: () => tabs.splitWith(id),
              },
              { type: 'separator' },
            ]
          : [];
    const items: Electron.MenuItemConstructorOptions[] = tab.basecamp
      ? [
          { label: 'Go back to home', click: () => tabs.goHome(id) },
          {
            label: 'Remove from Basecamp',
            click: () => tabs.removeFromBasecamp(id),
          },
          { type: 'separator' },
          { label: 'Unload tab', click: () => tabs.close(id) },
        ]
      : tab.pinned
        ? [
            { label: 'Go back to home', click: () => tabs.goHome(id) },
            {
              label: 'Unpin tab',
              accelerator: 'CmdOrCtrl+D',
              click: () => tabs.unpin(id),
            },
            addToBasecamp,
            ...moveToSpace,
            { type: 'separator' },
            { label: 'Unload tab', click: () => tabs.close(id) },
          ]
        : [
            ...splitItems,
            {
              label: 'Pin tab',
              accelerator: 'CmdOrCtrl+D',
              click: () => tabs.pin(id),
            },
            addToBasecamp,
            ...moveToSpace,
            { type: 'separator' },
            {
              label: 'Close tab',
              accelerator: 'CmdOrCtrl+W',
              click: () => tabs.close(id),
            },
          ];
    // A tab playing sound (or muted) can be muted or turned back on here
    // too, not only with its speaker.
    const sound: Electron.MenuItemConstructorOptions[] =
      tab.audible || tab.muted
        ? [
            {
              label: tab.muted ? 'Unmute tab' : 'Mute tab',
              click: () => tabs.toggleMute(id),
            },
            { type: 'separator' },
          ]
        : [];
    Menu.buildFromTemplate([...sound, ...items]).popup({ window: win });
  };

  // --- Spaces ---------------------------------------------------------------

  const sendSpaces = () =>
    send('spaces:state', { spaces, activeSpaceId: windowState.activeSpaceId });

  const switchSpace = (id: string) => {
    if (id === windowState.activeSpaceId) return;
    if (!spaces.some((s) => s.id === id)) return;
    windowState.activeSpaceId = id;
    hideOverlay();
    tabs.setSpace(id);
    sendSpaces();
    saver.schedule();
  };

  // Asks the visible sidebar to show the space's name as a text field.
  const startRenameSpace = (id: string) => {
    const sidebar = peeking ? peek.webContents : win.webContents;
    sidebar.focus();
    sidebar.send('spaces:rename', id);
  };

  const newSpace = () => {
    const used = new Set(spaces.map((s) => s.icon));
    const space: Space = {
      id: randomUUID(),
      name: 'New space',
      icon: SPACE_ICONS.find((icon) => !used.has(icon)) ?? SPACE_ICONS[0],
      // The first color no other space has yet.
      color:
        SPACE_COLORS.find((c) => !spaces.some((s) => s.color === c)) ??
        SPACE_COLORS[spaces.length % SPACE_COLORS.length],
      order: spaces.length,
    };
    spaces = [...spaces, space];
    switchSpace(space.id);
    startRenameSpace(space.id);
  };

  const updateSpace = (
    id: string,
    changes: {
      name?: string;
      icon?: string;
      color?: string;
      pinsFolded?: boolean;
    },
  ) => {
    spaces = spaces.map((s) =>
      s.id === id
        ? {
            ...s,
            name: changes.name?.trim().slice(0, 40) || s.name,
            icon: changes.icon ?? s.icon,
            color: changes.color ?? s.color,
            pinsFolded: changes.pinsFolded ?? s.pinsFolded,
          }
        : s,
    );
    sendSpaces();
    saver.schedule();
  };

  const deleteSpace = async (id: string) => {
    const space = spaces.find((s) => s.id === id);
    if (!space || spaces.length < 2) return;
    const count = tabs.countIn(id);
    if (count) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Delete space', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Delete “${space.name}”?`,
        detail: `Its ${count} tab${count === 1 ? '' : 's'} will be closed.`,
      });
      if (response !== 0) return;
    }
    const index = spaces.indexOf(space);
    if (windowState.activeSpaceId === id)
      switchSpace(spaces[index === 0 ? 1 : index - 1].id);
    tabs.closeSpace(id);
    spaces = spaces
      .filter((s) => s.id !== id)
      .map((s, i) => ({ ...s, order: i }));
    sendSpaces();
    saver.schedule();
  };

  // Right-click menu for a space's icon.
  // The space's own menu items, shared by its menu and the sidebar's.
  const spaceItems = (
    space: Space,
    target: WebContents,
  ): Electron.MenuItemConstructorOptions[] => [
    {
      label: 'Change color',
      submenu: SPACE_COLOR_CHOICES.map(({ name, hex }) => ({
        label: name,
        icon: colorSwatch(hex),
        type: 'checkbox' as const,
        checked: hex === space.color,
        click: () => updateSpace(space.id, { color: hex }),
      })),
    },
    // A grid of icons in the sidebar (where the menu was opened); a
    // system menu can't show Firn's own icons.
    {
      label: 'Change icon…',
      click: () => {
        switchSpace(space.id);
        if (!target.isDestroyed()) target.send('spaces:pick-icon', space.id);
      },
    },
    {
      label: 'Rename space',
      click: () => {
        switchSpace(space.id);
        startRenameSpace(space.id);
      },
    },
  ];

  // Right-click on empty space in the sidebar: the active space's options,
  // plus a new tab or space.
  const showSidebarMenu = (target: WebContents) => {
    const space = spaces.find((s) => s.id === windowState.activeSpaceId);
    if (!space) return;
    Menu.buildFromTemplate([
      ...spaceItems(space, target),
      { type: 'separator' },
      {
        label: 'New tab',
        accelerator: 'CmdOrCtrl+T',
        click: () => openCommandBar(),
      },
      { label: 'New space', click: () => newSpace() },
    ]).popup({ window: win });
  };

  const showSpaceMenu = (id: string, target: WebContents) => {
    const space = spaces.find((s) => s.id === id);
    if (!space) return;
    Menu.buildFromTemplate([
      ...spaceItems(space, target),
      { type: 'separator' },
      {
        label: 'Delete space…',
        enabled: spaces.length > 1,
        click: () => void deleteSpace(id),
      },
    ]).popup({ window: win });
  };

  // New tab: a floating bar to search or type an address. Nothing is added
  // to the tab list until something is picked.
  // Quick actions from the command bar, on the tab you're on.
  const runAction = (action: CommandAction, arg: string) => {
    hideOverlay();
    const id = tabs.activeTabId;
    const tab = id ? tabs.state().tabs.find((t) => t.id === id) : undefined;
    switch (action) {
      case 'pin':
        if (id && tab && !tab.basecamp) tabs.togglePin(id);
        break;
      case 'basecamp':
        if (!id || !tab) break;
        if (tab.basecamp) tabs.removeFromBasecamp(id);
        else tabs.addToBasecamp(id);
        break;
      case 'close':
        if (id) tabs.close(id);
        break;
      case 'reopen':
        tabs.reopenClosed();
        break;
      case 'separate':
        if (id) tabs.unsplit(id);
        break;
      case 'sidebar':
        setSidebarCollapsed(!windowState.sidebarCollapsed);
        break;
      case 'new-space':
        newSpace();
        break;
      case 'clear':
        tabs.clearEveryday();
        break;
      case 'copy-link':
        if (tab?.url) clipboard.writeText(tab.url);
        break;
      case 'switch-space':
        switchSpace(arg);
        break;
      case 'find':
        openFind();
        break;
      case 'zoom-in':
        tabs.zoom(1);
        break;
      case 'zoom-out':
        tabs.zoom(-1);
        break;
      case 'zoom-reset':
        tabs.zoom(0);
        break;
      case 'downloads':
        void shell.openPath(downloadsFolder());
        break;
      case 'settings':
        openSettings();
        break;
      case 'history':
        openHistory();
        break;
      case 'passwords':
        openPasswords();
        break;
      case 'welcome':
        openWelcome();
        break;
      case 'whats-new':
        openWhatsNew('');
        break;
      case 'shortcuts':
        showOverlay({ mode: 'shortcuts', openId: ++commandOpenId });
        break;
      case 'archive':
        showOverlay({ mode: 'archive', openId: ++commandOpenId });
        break;
    }
  };

  // With `besideId`, whatever is picked opens in split view beside that tab.
  let splitBeside: string | null = null;
  const openCommandBar = (besideId?: string) => {
    const beside = besideId
      ? tabs.state().tabs.find((t) => t.id === besideId)
      : undefined;
    showOverlay({
      mode: 'command',
      openId: ++commandOpenId,
      beside: beside ? beside.title || beside.url : undefined,
    });
    splitBeside = beside?.id ?? null;
  };

  const focusAddress = () => {
    hideOverlay();
    // The address bar at the top.
    if (addressOnTop()) {
      topBar.webContents.focus();
      topBar.webContents.send('ui:focus-address', tabs.navState().url);
      return;
    }
    // With the sidebar collapsed, its address bar is in the peek layer.
    if (windowState.sidebarCollapsed) showPeek();
    const target = windowState.sidebarCollapsed
      ? peek.webContents
      : win.webContents;
    target.focus();
    // Include the active tab's address, so the bar never shows a stale one.
    target.send('ui:focus-address', tabs.navState().url);
  };

  // --- Ctrl+Tab: switch by most recent use, like Alt+Tab ------------------

  let switcher: {
    tabIds: string[];
    index: number;
    revealed: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  const stepSwitcher = (step: 1 | -1) => {
    if (!switcher) {
      const tabIds = tabs.recentIds();
      if (tabIds.length < 2) return;
      // Without the floating layer (still starting), just flip to the last
      // tab; the switcher needs that layer to hear Ctrl being let go.
      if (!readyUi.has(floating.webContents)) {
        tabs.activate(tabIds[1]);
        return;
      }
      switcher = {
        tabIds,
        index: 0,
        revealed: false,
        timer: setTimeout(() => {
          if (!switcher) return;
          switcher.revealed = true;
          showSwitcher();
        }, SWITCHER_DELAY_MS),
      };
    }
    const count = switcher.tabIds.length;
    switcher.index = (switcher.index + step + count) % count;
    // The layer takes keyboard focus right away (still invisible), because
    // the page that saw Ctrl+Tab won't report Ctrl being let go.
    showSwitcher();
  };
  const showSwitcher = () => {
    if (!switcher) return;
    const { tabIds, index, revealed } = switcher;
    showOverlay({ mode: 'switcher', tabIds, index, revealed });
  };
  // Letting go of Ctrl switches to the picked tab; Esc cancels.
  const endSwitcher = (commit: boolean) => {
    if (!switcher) return;
    clearTimeout(switcher.timer);
    const id = switcher.tabIds[switcher.index];
    switcher = null;
    hideOverlay();
    if (commit) tabs.activate(id);
  };

  // --- Commands from the UI -----------------------------------------------

  const handlers: Record<
    string,
    (sender: WebContents, ...args: unknown[]) => void
  > = {
    'nav:navigate': (_sender, input) => {
      if (typeof input === 'string') tabs.navigate(input);
    },
    'nav:command': (_sender, command) => {
      if (NAV_COMMANDS.includes(command as NavCommand))
        tabs.command(command as NavCommand);
    },
    'tabs:new': () => openCommandBar(),
    'tabs:open-url': (_sender, input) => {
      if (typeof input !== 'string') return;
      const beside = splitBeside;
      hideOverlay();
      const id = tabs.openTyped(input);
      // Opened from "Split view with → New tab…": it goes beside that tab.
      if (beside && id) {
        tabs.activate(beside);
        tabs.splitWith(id);
      }
    },
    'tabs:close': (_sender, id) => {
      if (typeof id === 'string') tabs.close(id);
    },
    'tabs:toggle-mute': (_sender, id) => {
      if (typeof id === 'string') tabs.toggleMute(id);
    },
    'tabs:toggle-playing': (_sender, id) => {
      if (typeof id === 'string') void tabs.togglePlaying(id);
    },
    // Dragging a tab onto the page (split view): the pointer, from the
    // sidebar's layer (the window itself, or the peeking sidebar).
    'tabs:drag-to-split': (sender, id, x) => {
      if (typeof id !== 'string' || typeof x !== 'number') return;
      const fromPeek = sender === peek.webContents;
      const origin = fromPeek ? boundsFor(peek) : { x: 0 };
      tabs.previewDrop(id, x + origin.x);
      // Out of the peeking sidebar: it steps aside, so the page (and the
      // card for the tab) can be seen whole.
      const aside = fromPeek && peeking && tabs.isPreviewingDrop;
      if (aside !== peekAside) {
        peekAside = aside;
        sendSidebar();
      }
    },
    'tabs:carry': (sender, carry) => {
      if (sender !== win.webContents && sender !== peek.webContents) return;
      if (carry === null) {
        if (!carried) return;
        carried = null;
        // It fades as it's let go, then the layer goes (unless something
        // else has opened on it meanwhile).
        floating.webContents.send('carry:state', null);
        clearTimeout(carryHideTimer);
        carryHideTimer = setTimeout(() => {
          if (!carried && overlay.mode === 'hidden' && !barTip)
            hideLayer(floating);
        }, 180);
        return;
      }
      const c = carry as Partial<Record<keyof CarryTab, unknown>>;
      const numbers = [
        c.x,
        c.y,
        c.grabX,
        c.grabY,
        c.width,
        c.fromX,
        c.fromY,
      ] as const;
      if (
        typeof c.tabId !== 'string' ||
        !numbers.every((n) => typeof n === 'number' && Number.isFinite(n))
      )
        return;
      // A panel is open on the floating layer: the tab isn't carried.
      if (overlay.mode !== 'hidden' || !readyUi.has(floating.webContents))
        return;
      const origin =
        sender === peek.webContents ? boundsFor(peek) : { x: 0, y: 0 };
      const first = !carried;
      const at = carry as CarryTab;
      carried = {
        ...at,
        x: at.x + origin.x,
        y: at.y + origin.y,
        fromX: at.fromX + origin.x,
        fromY: at.fromY + origin.y,
      };
      if (first) {
        clearTimeout(carryHideTimer);
        // The top bar's hover label (or a split view's handle) makes way.
        if (barTip) {
          barTip = null;
          floating.webContents.send('tip:state', { kind: 'hide' });
        }
        if (splitHandle) {
          splitHandle = null;
          floating.webContents.send('split-handle:state', { kind: 'hide' });
        }
        showLayer(floating);
      }
      floating.webContents.send('carry:state', carried);
    },
    'tabs:end-drag-to-split': (_sender, drop) => {
      if (drop === true) tabs.dropToSplit();
      else tabs.previewDrop(null);
      // (Dropped: the button was let go, wherever that was.)
      if (drop === true) peekHolding = false;
      if (peekAside) {
        peekAside = false;
        // Dropped on the page: it's done, so it goes (it's already out of
        // sight). Back over it: it comes back.
        if (drop === true) hidePeek();
        else sendSidebar();
      }
    },
    'spaces:switch': (_sender, id) => {
      if (typeof id === 'string') switchSpace(id);
    },
    'spaces:new': () => newSpace(),
    'spaces:update': (_sender, id, changes) => {
      if (typeof id !== 'string' || !changes || typeof changes !== 'object')
        return;
      const { name, icon, color, pinsFolded } = changes as Record<
        string,
        unknown
      >;
      updateSpace(id, {
        name: typeof name === 'string' ? name : undefined,
        icon: isSpaceIcon(icon) ? icon : undefined,
        color:
          typeof color === 'string' && SPACE_COLORS.includes(color)
            ? color
            : undefined,
        pinsFolded: typeof pinsFolded === 'boolean' ? pinsFolded : undefined,
      });
    },
    'tabs:clear': () => tabs.clearEveryday(),
    'sidebar:menu': (sender) => showSidebarMenu(sender),
    'spaces:menu': (sender, id) => {
      if (typeof id === 'string') showSpaceMenu(id, sender);
    },
    'tabs:menu': (_sender, id) => {
      if (typeof id === 'string') showTabMenu(id);
    },
    'tabs:move': (_sender, id, toIndex, pinned) => {
      if (typeof id !== 'string' || !Number.isInteger(toIndex)) return;
      if (typeof pinned === 'boolean')
        tabs.place(id, pinned, toIndex as number);
      else tabs.move(id, toIndex as number);
    },
    'tabs:activate': (_sender, id) => {
      if (typeof id !== 'string') return;
      const beside = overlay.mode === 'command' ? splitBeside : null;
      if (switcher) endSwitcher(false);
      hideOverlay();
      // Picked in the command bar from "Split view with → New tab…".
      if (beside && beside !== id) {
        tabs.activate(beside);
        if (tabs.canSplitWith(id)) return tabs.splitWith(id);
      }
      // A tab in another space (from the command bar): go to that space.
      const spaceId = tabs.spaceOfTab(id);
      if (spaceId && spaceId !== windowState.activeSpaceId)
        switchSpace(spaceId);
      tabs.activate(id);
    },
    'lookout:expand': () => expandLookout(),
    'settings:update': (_sender, changes) => changeSettings(changes),
    'settings:downloads-folder': async () => {
      const result = await dialog.showOpenDialog(win, {
        title: 'Save downloads to',
        defaultPath: downloadsFolder(),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!result.canceled && result.filePaths[0])
        changeSettings({ downloadsFolder: result.filePaths[0] });
    },
    'settings:clear-site-data': async () => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Clear', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Clear cookies and site data?',
        detail:
          "This signs you out of websites and clears what they've saved on this computer. Your tabs, history, and downloads stay.",
      });
      if (response !== 0) return;
      await session.defaultSession.clearStorageData();
      await session.defaultSession.clearCache();
    },
    'settings:reset-permissions': () => {
      sitePermissions.forgetAll();
      sendNav();
    },
    // Settings > Updates: "Check for updates", and "Restart now" once a new
    // version is ready.
    'updates:check': () => checkForUpdates(),
    'updates:install': () => installUpdate(),
    'firn:menu': () =>
      Menu.buildFromTemplate([
        {
          label: 'New tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => openCommandBar(),
        },
        { label: 'New space', click: () => newSpace() },
        { type: 'separator' },
        {
          label: 'History',
          accelerator: menuAccelerator('history', process.platform),
          click: () => openHistory(),
        },
        {
          label: 'Archived tabs',
          click: () => runAction('archive', ''),
        },
        { label: 'Passwords', click: () => openPasswords() },
        {
          label: 'Downloads',
          click: () => void shell.openPath(downloadsFolder()),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettings(),
        },
        { label: "What's new", click: () => openWhatsNew('') },
      ]).popup({ window: win }),
    // The archive box's right-click menu: open it, or choose how long.
    'archive:menu': () =>
      Menu.buildFromTemplate([
        { label: 'Show archived tabs', click: () => runAction('archive', '') },
        { type: 'separator' },
        {
          label: "Archive tabs you haven't used for",
          submenu: ARCHIVE_CHOICES.map((days) => ({
            label: days === 0 ? 'Never' : days === 1 ? '1 day' : `${days} days`,
            type: 'radio' as const,
            checked: settings.archiveAfter === days,
            click: () => changeSettings({ archiveAfter: days }),
          })),
        },
      ]).popup({ window: win }),
    // The Archive: bring a tab back (in its space, if that's still there),
    // or forget it.
    'archive:restore': (_sender, id) => {
      if (typeof id !== 'string') return;
      const tab = tabs.takeArchived(id);
      if (!tab) return;
      hideOverlay();
      if (spaces.some((s) => s.id === tab.spaceId)) switchSpace(tab.spaceId);
      tabs.create(tab.url);
      send('archive:changed');
      saver.schedule();
    },
    'archive:remove': (_sender, id) => {
      if (typeof id !== 'string' || !tabs.takeArchived(id)) return;
      send('archive:changed');
      saver.schedule();
    },
    'history:remove': (_sender, url) => {
      if (typeof url !== 'string') return;
      history.remove(url);
      send('history:changed');
    },
    'history:clear-menu': () => {
      const clear = (since: number) => () => {
        history.clear(since);
        send('history:changed');
      };
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      Menu.buildFromTemplate([
        { label: 'Clear history from…', enabled: false },
        { type: 'separator' },
        { label: 'The last hour', click: clear(Date.now() - 60 * 60 * 1000) },
        { label: 'Today', click: clear(midnight.getTime()) },
        { label: 'All time', click: clear(0) },
      ]).popup({ window: win });
    },
    'welcome:finish': (_sender, urls) => finishWelcome(urls),
    'danger:answer': (_sender, answer) => {
      if (answer === 'back' || answer === 'visit') answerDanger(answer);
    },
    'password:answer': (_sender, answer) => {
      if (answer === 'save' || answer === 'dismiss') answerLogin(answer);
    },
    'passwords:copy': (_sender, id) => {
      const password = typeof id === 'string' ? passwords.reveal(id) : null;
      if (password !== null) void clipboard.writeText(password);
    },
    'passwords:delete': async (_sender, id) => {
      if (typeof id !== 'string') return;
      const login = passwords.list().find((l) => l.id === id);
      if (!login) return;
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Delete this saved password?',
        detail: `${login.username || '(no username)'} on ${hostOf(login.origin)}`,
      });
      if (response !== 0) return;
      passwords.remove(id);
      send('passwords:changed');
    },
    'permission:answer': (_sender, answer) => {
      if (answer === 'allow' || answer === 'block' || answer === 'dismiss')
        answerPermission(answer);
    },
    'site:menu': () => showSiteMenu(),
    'browser:make-default': () => {
      askToBeDefault();
      // macOS answers in its own little window; look again after.
      setTimeout(refreshDefaultBrowser, 1500);
    },
    // A finished download opens with its usual app; "show" points to it in
    // the folder (or opens the folder, if the file is gone).
    'downloads:open': (_sender, id) => {
      const download = typeof id === 'string' ? downloads.get(id) : undefined;
      if (download?.state === 'done' && fs.existsSync(download.path))
        void shell.openPath(download.path);
      // Gone since (moved or deleted): show that instead.
      else send('downloads:state', downloads.all());
    },
    'downloads:show': (_sender, id) => {
      const download = typeof id === 'string' ? downloads.get(id) : undefined;
      if (download && fs.existsSync(download.path))
        shell.showItemInFolder(download.path);
      else void shell.openPath(downloadsFolder());
    },
    'downloads:cancel': (_sender, id) => {
      if (typeof id === 'string') downloads.cancel(id);
    },
    'downloads:remove': (_sender, id) => {
      if (typeof id === 'string') downloads.remove(id);
    },
    'downloads:retry': (_sender, id) => {
      const download = typeof id === 'string' ? downloads.get(id) : undefined;
      if (!download || download.state === 'progress') return;
      downloads.remove(download.id);
      engine.download(download.url);
    },
    'find:search': (_sender, text, forward, newSearch) => {
      if (overlay.mode !== 'find' || typeof text !== 'string') return;
      lastFindText = text.slice(0, 500);
      tabs.find(lastFindText, forward !== false, newSearch === true);
    },
    'find:close': () => {
      if (overlay.mode === 'find') hideOverlay();
    },
    'page:zoom': (_sender, step) => {
      if (step === 1 || step === -1 || step === 0) tabs.zoom(step);
    },
    'command:run': (_sender, action, arg) => {
      if (typeof action === 'string')
        runAction(action as CommandAction, typeof arg === 'string' ? arg : '');
    },
    'split:resize': (_sender, id, ratio) => {
      if (typeof id === 'string' && typeof ratio === 'number') {
        tabs.resizeSplit(id, ratio);
        if (overlay.mode === 'find') layoutLayers();
      }
    },
    'split:separate': (_sender, tabId) => {
      if (typeof tabId === 'string') tabs.unsplit(tabId);
    },
    // A split view side's handle, dragged: it follows the pointer, and
    // over the other side the two swap places (shown until it's let go).
    'split:handle-drag': (sender, screenX, screenY) => {
      if (sender !== floating.webContents || !splitHandle) return;
      if (typeof screenX !== 'number' || typeof screenY !== 'number') return;
      const split = tabs.splitOnScreen();
      if (!split) return;
      const content = win.getContentBounds();
      const x = screenX - content.x;
      const y = screenY - content.y;
      if (!splitHandle.dragging) {
        splitHandle.dragging = true;
        clearTimeout(splitHandleHideTimer);
        splitHandleHideTimer = undefined;
        floating.webContents.send('split-handle:state', { kind: 'drag' });
      }
      splitHandle.at = { x: Math.round(x), y: Math.round(y) };
      floating.setBounds(boundsFor(floating));
      const side = x < split.middle ? 0 : 1;
      tabs.previewSwap(side !== split.tabIds.indexOf(splitHandle.tabId));
    },
    'split:handle-drop': (sender) => {
      if (sender !== floating.webContents || !splitHandle?.dragging) return;
      // Over the other side: swapped. Back on its own: they glide back.
      tabs.swapSides();
      hideSplitHandle();
    },
    'split:take-out': (sender, tabId) => {
      if (sender !== floating.webContents || typeof tabId !== 'string') return;
      hideSplitHandle();
      tabs.takeOutOfSplit(tabId);
    },
    'overlay:close': () => {
      if (switcher) endSwitcher(false);
      hideOverlay();
    },
    'sidebar:toggle': () => setSidebarCollapsed(!windowState.sidebarCollapsed),
    'lights:at': (sender, x, y) => {
      if (sender !== win.webContents && sender !== peek.webContents) return;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Both layers sit at the window's top-left corner.
      lightsAt.set(sender, {
        x: Math.round(x) + LIGHTS_IN_ROW.x,
        y: Math.round(y) + LIGHTS_IN_ROW.y,
      });
      syncTrafficLights();
    },
    // The top bar asks for a hover label below one of its buttons (`anchor`:
    // the button, in the bar's own coordinates). The floating layer measures
    // it ('tip:size'), then it's shown there.
    'tip:show': (sender, text, anchor) => {
      if (!topBar || sender !== topBar.webContents) return;
      if (overlay.mode !== 'hidden' || !readyUi.has(floating.webContents))
        return;
      if (carried) return;
      const a = anchor as { left?: unknown; right?: unknown; bottom?: unknown };
      if (
        typeof text !== 'string' ||
        !text ||
        typeof a?.left !== 'number' ||
        typeof a.right !== 'number' ||
        typeof a.bottom !== 'number'
      )
        return;
      const bar = topBar.getBounds();
      barTip = {
        anchor: {
          left: bar.x + a.left,
          right: bar.x + a.right,
          bottom: bar.y + a.bottom,
        },
        barBottom: bar.y + bar.height,
      };
      floating.webContents.send('tip:state', {
        kind: 'measure',
        text: text.slice(0, 200),
      });
    },
    'tip:size': (sender, width, height) => {
      if (sender !== floating.webContents || !barTip) return;
      if (overlay.mode !== 'hidden') return;
      if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        !(width > 0 && width < 1000 && height > 0 && height < 400)
      )
        return;
      barTip.size = { width, height };
      if (showLayer(floating))
        floating.webContents.send('tip:state', { kind: 'show' });
    },
    'tip:hide': (sender) => {
      if (!topBar || sender !== topBar.webContents || !barTip) return;
      barTip = null;
      floating.webContents.send('tip:state', { kind: 'hide' });
      if (overlay.mode === 'hidden' && !carried) hideLayer(floating);
    },
    'peek:typing': (sender, typing) => {
      if (sender === peek.webContents) peekTyping = typing === true;
    },
    'peek:holding': (sender, holding) => {
      if (sender === peek.webContents) peekHolding = holding === true;
    },
    'sidebar:width': (_sender, width) => {
      if (typeof width === 'number' && Number.isFinite(width))
        setSidebarWidth(width);
    },
    'window:command': (_sender, command) => {
      if (command === 'minimize') win.minimize();
      else if (command === 'toggle-maximize')
        win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (command === 'close') win.close();
    },
    'ui:ready': (sender) => {
      onUiReady(sender);
      sender.send('tabs:state', tabs.state());
      sender.send('nav:state', navState());
      sender.send('window:maximized', win.isMaximized());
      sender.send('window:frame', frameState());
      sender.send('spaces:state', {
        spaces,
        activeSpaceId: windowState.activeSpaceId,
      });
      sender.send('overlay:state', overlay);
      sender.send('downloads:state', downloads.all());
      sender.send('settings:state', settingsState());
      sender.send('sidebar:state', {
        width: windowState.sidebarWidth,
        collapsed: windowState.sidebarCollapsed,
        pageLeft,
        peeking,
      });
    },
  };
  // Only accept messages that come from this window's own UI.
  const listeners = Object.entries(handlers).map(([channel, handler]) => {
    const listener = (event: IpcMainEvent, ...args: unknown[]) => {
      if (uiContents.includes(event.sender)) handler(event.sender, ...args);
    };
    ipcMain.on(channel, listener);
    return [channel, listener] as const;
  });

  // The UI asks for a favicon's bytes so it can pick out the icon's main
  // color (for tinting the active pin). Fetching here, rather than in the
  // UI, sidesteps the browser rule that hides other sites' images' pixels.
  ipcMain.handle('welcome:icon', (event: IpcMainInvokeEvent, url: unknown) =>
    uiContents.includes(event.sender) && typeof url === 'string'
      ? welcomeIcon(url)
      : null,
  );
  ipcMain.handle('icon:data', (event: IpcMainInvokeEvent, url: unknown) =>
    uiContents.includes(event.sender) && typeof url === 'string'
      ? iconAsDataUrl(url)
      : null,
  );

  // The command bar asks for every open tab, and for history matches.
  ipcMain.handle('command:tabs', (event: IpcMainInvokeEvent) =>
    uiContents.includes(event.sender) ? tabs.allTabs() : [],
  );
  ipcMain.handle(
    'history:search',
    (event: IpcMainInvokeEvent, query: unknown) =>
      uiContents.includes(event.sender) && typeof query === 'string'
        ? history.search(query.slice(0, 200), 6)
        : [],
  );
  ipcMain.handle('passwords:list', (event: IpcMainInvokeEvent) =>
    uiContents.includes(event.sender)
      ? { logins: passwords.list(), canSave: passwords.canSave }
      : { logins: [], canSave: false },
  );
  ipcMain.handle('passwords:reveal', (event: IpcMainInvokeEvent, id: unknown) =>
    uiContents.includes(event.sender) && typeof id === 'string'
      ? passwords.reveal(id)
      : null,
  );
  ipcMain.handle('archive:list', (event: IpcMainInvokeEvent) =>
    uiContents.includes(event.sender) ? tabs.archive : [],
  );
  ipcMain.handle('history:list', (event: IpcMainInvokeEvent, query: unknown) =>
    uiContents.includes(event.sender) && typeof query === 'string'
      ? history.list(query.slice(0, 200), 400)
      : [],
  );

  // Glass turns solid while the window is out of focus.
  const frameState = (): FrameState => ({
    glass: GLASS,
    focused: win.isFocused(),
    dark: nativeTheme.shouldUseDarkColors,
  });
  win.on('focus', () => send('window:frame', frameState()));
  win.on('blur', () => send('window:frame', frameState()));

  // Lets the UI swap the maximize icon for a restore icon.
  const sendMaximized = () => send('window:maximized', win.isMaximized());
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // If the window loses focus mid-switch, Ctrl's release never arrives.
  win.on('blur', () => endSwitcher(true));
  win.on('enter-full-screen', () => {
    windowFullscreen = true;
    syncTopBar();
  });
  win.on('leave-full-screen', () => {
    windowFullscreen = false;
    syncTopBar();
  });

  // --- Keyboard shortcuts (work wherever focus is) -------------------------

  const handleShortcut = (
    event: Electron.Event,
    input: Input,
    source: WebContents,
  ) => {
    // Ctrl was let go (or is no longer held): switch to the picked tab.
    const ctrlReleased =
      input.key === 'Control' ? input.type === 'keyUp' : !input.control;
    if (switcher && ctrlReleased) {
      endSwitcher(true);
      return;
    }
    if (input.type !== 'keyDown') return;
    // Which shortcut it is: see src/shortcuts.ts (the same list Settings'
    // Keyboard shortcuts page shows).
    const hit = matchShortcut(input, process.platform);
    let handled = true;
    switch (hit?.id) {
      case 'next-tab':
      case 'previous-tab':
        stepSwitcher(hit.id === 'previous-tab' ? -1 : 1);
        // Blocking a key here also hides the matching key release from
        // that same view, so let the switcher layer keep its own events.
        if (source === floating.webContents) handled = false;
        break;
      case 'escape':
        if (lookout) closeLookout();
        else if (switcher) endSwitcher(false);
        else handled = false;
        break;
      case 'diagnostics':
        printDiagnostics();
        break;
      case 'pin':
        if (tabs.activeTabId) tabs.togglePin(tabs.activeTabId);
        break;
      case 'sidebar':
        setSidebarCollapsed(!windowState.sidebarCollapsed);
        break;
      case 'address':
        focusAddress();
        break;
      case 'find':
        openFind();
        break;
      case 'history':
        openHistory();
        break;
      case 'settings':
        openSettings();
        break;
      case 'find-next':
      case 'find-previous':
        // The next (or previous) match of the last search.
        if (overlay.mode !== 'find') openFind();
        else if (lastFindText)
          tabs.find(lastFindText, hit.id === 'find-next', false);
        break;
      case 'zoom-in':
        tabs.zoom(1);
        break;
      case 'zoom-out':
        tabs.zoom(-1);
        break;
      case 'zoom-reset':
        tabs.zoom(0);
        break;
      case 'reopen-tab':
        tabs.reopenClosed();
        break;
      case 'new-tab':
        openCommandBar();
        break;
      case 'close-tab':
        if (tabs.activeTabId) tabs.close(tabs.activeTabId);
        break;
      case 'space-number': {
        const space = spaces[(hit.number ?? 0) - 1];
        if (space) switchSpace(space.id);
        break;
      }
      case 'tab-number':
        tabs.activateIndex((hit.number ?? 1) - 1);
        break;
      case 'last-tab':
        tabs.activateIndex(-1);
        break;
      case 'back':
        tabs.command('back');
        break;
      case 'forward':
        tabs.command('forward');
        break;
      case 'reload':
        tabs.command('reload');
        break;
      case 'hard-reload':
        tabs.hardReload();
        break;
      case 'dev-tools':
        tabs.toggleDevTools();
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };
  // Ctrl+Shift+D: print what every layer is doing to the terminal, to help
  // track down a stuck or unresponsive window.
  const printDiagnostics = () => {
    const name = (web: WebContents) =>
      uiNames.get(web) ?? `page ${web.getURL().slice(0, 60)}`;
    const focused = win.webContents.isFocused()
      ? 'sidebar'
      : ([
          ...uiNames.keys(),
          ...win.contentView.children.map(
            (v) => (v as WebContentsView).webContents,
          ),
        ]
          .filter((w) => w && !w.isDestroyed() && w.isFocused())
          .map(name)[0] ?? 'nothing');
    console.log('\n[Firn] --- diagnostics ---');
    console.log(
      `[Firn] overlay=${overlay.mode} switcher=${Boolean(switcher)} topBar=${topBarShown} ` +
        `collapsed=${windowState.sidebarCollapsed} peeking=${peeking} pageLeft=${pageLeft} focused=${focused}`,
    );
    const cursor = screen.getCursorScreenPoint();
    const content = win.getContentBounds();
    const display = screen.getDisplayMatching(content).bounds;
    console.log(
      `[Firn] cursor=${cursor.x},${cursor.y} window=${content.x},${content.y} ` +
        `${content.width}x${content.height} screen=${display.x},${display.y} ` +
        `${display.width}x${display.height} maximized=${win.isMaximized()}`,
    );
    for (const child of win.contentView.children) {
      const view = child as WebContentsView;
      const b = view.getBounds();
      console.log(
        `[Firn]   ${view.getVisible() ? 'shown ' : 'hidden'} ${b.x},${b.y} ${b.width}x${b.height}  ${name(view.webContents)}`,
      );
    }
  };

  // --- The Mac menu bar ------------------------------------------------------
  // (FIRN_MAC_MENU=1 shows it on other systems too, for the checks.)

  if (process.platform === 'darwin' || process.env.FIRN_MAC_MENU) {
    // With Firn's window closed (a Mac app keeps running), any menu choice
    // first brings the window back.
    const live = (action: () => void) => () => {
      if (win.isDestroyed()) createWindow();
      else action();
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        macMenuTemplate({
          settings: live(() => openSettings()),
          newTab: live(() => openCommandBar()),
          reopenClosedTab: live(() => tabs.reopenClosed()),
          closeTab: live(() => {
            if (tabs.activeTabId) tabs.close(tabs.activeTabId);
          }),
          find: live(() => openFind()),
          toggleSidebar: live(() =>
            setSidebarCollapsed(!windowState.sidebarCollapsed),
          ),
          back: live(() => tabs.command('back')),
          forward: live(() => tabs.command('forward')),
          reload: live(() => tabs.command('reload')),
          history: live(() => openHistory()),
          zoom: (direction) => live(() => tabs.zoom(direction))(),
          devTools: live(() => tabs.toggleDevTools()),
          website: live(() => void tabs.create('https://firnbrowser.com')),
          whatsNew: live(() => openWhatsNew('')),
        }),
      ),
    );
  }

  const watchShortcuts = (web: WebContents) =>
    web.on('before-input-event', (event, input) =>
      handleShortcut(event, input, web),
    );
  uiContents.forEach(watchShortcuts);

  // --- Follow the OS light/dark setting ------------------------------------

  const onThemeChange = () => {
    if (!GLASS) win.setBackgroundColor(frameColor());
    send('window:frame', frameState());
  };
  nativeTheme.on('updated', onThemeChange);

  // The days Firn was used (for archiving old tabs: src/archive.ts).
  let daysUsed = noteDayUsed(saved?.daysUsed ?? [], Date.now());
  // (Set once the tabs are back, below.)
  let tidyOldTabs = () => {};

  // Save the whole session at once, a moment after anything changes, and
  // right away when the window closes.
  const saver = new SaveScheduler(() => {
    if (win.isDestroyed()) return;
    saveSession({
      spaces,
      tabs: tabs.serialize(),
      window: {
        ...windowState,
        bounds: win.getNormalBounds(),
        maximized: win.isMaximized(),
      },
      recentlyClosed: tabs.closedUrls,
      splits: tabs.splitGroups,
      siteZoom: tabs.siteZooms,
      archive: tabs.archive,
      daysUsed,
    });
    // (At most every 2 seconds, however busy the tabs are.)
  }, SESSION_SAVE_MS);
  // Back from being minimized, a page could stay blank until something on
  // screen changed (a known Electron problem): draw what's on screen again,
  // once right away and once the window has settled.
  const repaintAll = () => {
    if (win.isDestroyed()) return;
    tabs.repaint();
    for (const web of uiContents) if (!web.isDestroyed()) web.invalidate();
  };
  const repaintSoon = () => {
    repaintAll();
    setTimeout(repaintAll, 150);
  };
  win.on('restore', repaintSoon);
  win.on('show', repaintSoon);
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const)
    win.on(event as 'resize', () => saver.schedule());
  win.on('close', () => {
    saver.flush();
    history.flush();
    downloads.flush();
    sitePermissions.flush();
    passwords.flush();
    safeBrowsing.stop();
  });

  win.on('closed', () => {
    saver.cancel();
    for (const [channel, listener] of listeners)
      ipcMain.removeListener(channel, listener);
    ipcMain.removeHandler('icon:data');
    ipcMain.removeHandler('welcome:icon');
    ipcMain.removeHandler('command:tabs');
    ipcMain.removeHandler('history:search');
    ipcMain.removeHandler('history:list');
    ipcMain.removeHandler('archive:list');
    ipcMain.removeHandler('passwords:list');
    ipcMain.removeHandler('passwords:reveal');
    nativeTheme.removeListener('updated', onThemeChange);
    if (switcher) clearTimeout(switcher.timer);
    tabs.destroy();
    clearTimeout(topBarHideTimer);
    clearInterval(topBarWatch);
    clearInterval(topGlide);
    clearTimeout(lookoutTimer);
    clearInterval(lookoutGlide);
    clearInterval(peekWatch);
    clearTimeout(edgeWatch);
    clearTimeout(peekHideTimer);
    clearInterval(glide);
    for (const layer of [floating, topBar, peek])
      if (layer && !layer.webContents.isDestroyed()) layer.webContents.close();
  });

  // --- Load Firn's UI, then the first tab ---------------------------------

  for (const web of uiContents) lockUi(web);
  layersToStart = [peek, floating, topBar]
    .filter((layer) => layer !== null)
    .map((layer) => layer.webContents);
  startUi(win.webContents);

  // Restore the saved tabs; only the active one loads right away, the rest
  // load when first shown. A first run (or an empty session) opens the home
  // page.
  const savedTabs = (saved?.tabs ?? []).filter(
    (tab) => typeof tab.url === 'string' && tab.url,
  );
  tabs.closedUrls = saved?.recentlyClosed ?? [];
  // Tabs whose space is gone go to the first space.
  for (const tab of savedTabs) {
    if (!spaces.some((s) => s.id === tab.spaceId)) tab.spaceId = spaces[0].id;
    tabs.create(tab.url, { restore: tab, activate: false });
  }
  tabs.restoreSplits(saved?.splits);
  tabs.restoreArchive(saved?.archive);
  // Old everyday tabs tidy themselves away into the Archive: a little after
  // Firn opens, then every hour (each check also notes that today Firn was
  // used, for a window left open overnight).
  tidyOldTabs = () => {
    daysUsed = noteDayUsed(daysUsed, Date.now());
    const archived = tabs.archiveOld((lastActiveAt) =>
      isOld(lastActiveAt, daysUsed, settings.archiveAfter),
    );
    const forgotten = tabs.forgetArchived((archivedAt) =>
      isOld(archivedAt, daysUsed, ARCHIVE_KEEP_DAYS),
    );
    if (archived || forgotten) {
      debug(`archived ${archived} old tab(s), forgot ${forgotten}`);
      // (The archive box in the sidebar gives a little pulse.)
      send('archive:changed', archived);
    }
    saver.schedule();
  };
  const tidyTimer = setTimeout(() => {
    if (!win.isDestroyed()) tidyOldTabs();
  }, TIDY_FIRST_MS);
  const tidyEvery = setInterval(() => {
    if (!win.isDestroyed()) tidyOldTabs();
  }, TIDY_EVERY_MS);
  win.on('closed', () => {
    clearTimeout(tidyTimer);
    clearInterval(tidyEvery);
  });
  // Tabs not on screen for an hour go to sleep, to free their memory.
  const sleepEvery = setInterval(() => {
    if (win.isDestroyed()) return;
    void tabs
      .sleepOld((lastSeen) => Date.now() - lastSeen >= SLEEP_AFTER_MS)
      .then((slept) => {
        if (slept) debug(`put ${slept} tab(s) to sleep`);
      });
  }, SLEEP_CHECK_MS);
  win.on('closed', () => clearInterval(sleepEvery));
  // Settings shows where updates are (checking, up to date, ready...).
  const stopUpdateState = onUpdateState(() =>
    send('settings:state', settingsState()),
  );
  win.on('closed', stopUpdateState);
  console.log(
    savedTabs.length
      ? `[Firn] Restored ${savedTabs.length} tab(s) from ${sessionPath()}`
      : `[Firn] No saved tabs found (${sessionPath()}); starting fresh.`,
  );
  if (savedTabs.length) {
    // The saved active tab, or the space's most recent one (a space can also
    // be empty).
    const inSpace = savedTabs.filter(
      (t) => t.basecamp || t.spaceId === windowState.activeSpaceId,
    );
    const activeId = inSpace.some((t) => t.id === saved?.window.activeTabId)
      ? saved!.window.activeTabId!
      : tabs.recentIds()[0];
    if (activeId) tabs.activate(activeId);
  } else if (!pendingLinks.length) {
    tabs.create(HOME_URL);
  }

  // Links from other apps (Firn as the default browser): new tabs in this
  // window, which comes forward.
  openLinks = (urls) => {
    for (const url of urls) tabs.create(url);
    if (win.isMinimized()) win.restore();
    win.focus();
  };
  win.on('closed', () => (openLinks = null));
  if (pendingLinks.length) openLinks(pendingLinks.splice(0));
};

// Only one Firn runs at a time. Opening it again brings the existing window
// forward instead, so two copies can never overwrite each other's session.
// (Demo mode first moves Firn's data to its throwaway folder.)
applyDemoProfile();
installDemoHooks();
// (Not for the installer's own short start: asking for the lock would
// tell a Firn that's already running, which then comes to the front, e.g.
// when an update finishes installing in the background.)
const isFirstInstance = !started && app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

app.on('second-instance', (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  // A link clicked in another app (Windows starts Firn again with it).
  receiveLinks(linksFromArguments(argv));
});

// macOS hands links and web page files to the running Firn instead (also
// the one it starts for them).
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (/^https?:\/\//i.test(url)) receiveLinks([url]);
});
app.on('open-file', (event, file) => {
  if (!isWebFile(file)) return;
  event.preventDefault();
  receiveLinks([pathToFileURL(file).href]);
});

app.whenReady().then(() => {
  if (!isFirstInstance) return;
  createWindow();
  if (!DEMO) startUpdates(debug);

  // On macOS, re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
