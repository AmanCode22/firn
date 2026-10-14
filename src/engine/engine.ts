// The browser engine, as the rest of Firn sees it: what a web page can do
// and what it tells us. Nothing here depends on Electron, so the tab model
// (src/tabs.ts) works the same on any engine. Today the only engine is
// Electron (src/engine/electron.ts); a Chromium fork would provide its own.

import type { FindResult, SavedHistory } from '../types';

export interface PageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// What was right-clicked on a page, and what can be done with it there.
export interface PageContextMenu {
  // A link that was clicked on (and its text), or ''.
  linkUrl: string;
  // An image that was clicked on, or ''.
  imageUrl: string;
  // Selected text, or ''.
  selectionText: string;
  // Clicked inside a text box.
  isEditable: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  // A misspelled word under the click, and suggested corrections.
  misspelledWord: string;
  suggestions: string[];
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
  copyImage(): void;
  saveImage(): void;
  replaceMisspelling(word: string): void;
}

// What a page reports back as it loads and changes.
export interface PageEvents {
  // The address, title, loading state or sound may have changed.
  onUpdate(): void;
  onFavicon(url: string): void;
  // The page started going to another document (not just a jump within the
  // same page).
  onNavigationStart(url: string): void;
  // A link asked to open in a new tab (`background`: without switching to
  // it). Real popup windows, such as sign-in flows, are handled by the
  // engine and never come here.
  onOpenTab(url: string, background: boolean): void;
  // A link was Shift+clicked: preview it in Lookout.
  onLookout(url: string): void;
  // The page went into or out of fullscreen (e.g. a video).
  onFullscreen(on: boolean): void;
  // The mouse was pressed inside the page (the person is working in it).
  onFocus(): void;
  // You signed in on the page: the username and password typed, and the
  // site (its real address, checked by the engine). See src/passwords.ts.
  onLogin(origin: string, username: string, password: string): void;
  // The page was right-clicked.
  onContextMenu(menu: PageContextMenu): void;
  // How a find in page (see Page.find) went.
  onFindResult(result: FindResult): void;
  // The person asked to zoom with the mouse (Ctrl+wheel or a pinch).
  onZoomRequest(direction: 'in' | 'out'): void;
}

// One web page: the content of a tab.
export interface Page {
  readonly url: string;
  readonly title: string;
  readonly isLoading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  // The page is making sound right now (even if muted), and whether it's
  // muted.
  readonly audible: boolean;
  readonly muted: boolean;
  setMuted(on: boolean): void;
  // Pauses the videos and sounds playing on the page (also in players
  // embedded in it), and how many it paused (0: nothing it could pause,
  // e.g. sound made by the page's own code). playMedia plays just those
  // again.
  pauseMedia(): Promise<number>;
  playMedia(): Promise<void>;
  // Whether a person has typed into the page and the text is still there
  // (false if the page doesn't answer quickly).
  hasTypedText(): Promise<boolean>;

  load(url: string): void;
  // Brings back saved back/forward history (with scroll positions); fails
  // if the engine can't.
  restoreHistory(history: SavedHistory): Promise<void>;
  // The back/forward history to save, keeping at most `max` entries (the
  // most recent ones).
  history(max: number): SavedHistory;

  back(): void;
  forward(): void;
  reload(ignoreCache?: boolean): void;
  // Draws the page again (after the window comes back from being
  // minimized, when a page can otherwise stay blank), nudging its size if
  // the engine needs that.
  repaint(): void;
  stop(): void;
  focus(): void;
  toggleDevTools(): void;

  // Highlights `text` on the page: a new search, or the next (or previous)
  // match of the current one. Results come back through onFindResult.
  find(text: string, options: { forward: boolean; newSearch: boolean }): void;
  // Ends the search; the current match stays selected.
  stopFind(): void;
  // The page's zoom (1 = 100%).
  readonly zoom: number;
  setZoom(factor: number): void;

  // Where the page sits in the window, and how round its corners are.
  place(bounds: PageBounds, cornerRadius: number): void;
  // Lays the page out at a fixed size whatever its box (null: fit the box
  // again). While its box changes size for a moment, the site doesn't have
  // to re-fit on every step; whatever doesn't fit is simply hidden.
  holdLayout(size: { width: number; height: number } | null): void;
  show(): void;
  hide(): void;
  // Puts the page above everything else in the window (Lookout floats over
  // Firn's own layers).
  raise(): void;
  // Sends the page's reports somewhere else from now on (a page previewed
  // in Lookout becomes a tab).
  listen(events: PageEvents): void;
  // Closes the page for good.
  destroy(): void;
}

// A file being downloaded, as the engine hands it over. Its save path must
// be set right away (before handing control back), or the engine asks.
export interface EngineDownload {
  readonly url: string;
  // The file name the site suggests.
  readonly suggestedName: string;
  setSavePath(path: string): void;
  // Or: the engine asks the person where (its Save dialog, starting at
  // `defaultPath`). Cancelling it cancels the download.
  askSavePath(defaultPath: string): void;
  // Where it's being saved ('' until known, e.g. while the person chooses).
  readonly savePath: string;
  // Reports progress (bytes so far, and the total, or 0 if unknown).
  onProgress(listener: (received: number, total: number) => void): void;
  onDone(listener: (state: 'completed' | 'cancelled' | 'failed') => void): void;
  cancel(): void;
}

// The things a site has to ask before using (see src/permissions.ts).
export type PermissionKind =
  | 'camera'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'clipboard'
  | 'external';

// A site asking to use something. `page` is the page asking (null if it
// isn't one of Firn's pages), `origin` the site, e.g. "https://meet.google.com".
// For 'external', `detail` is the kind of link, e.g. "zoommtg".
export interface PermissionRequest {
  page: Page | null;
  origin: string;
  kinds: PermissionKind[];
  detail: string;
  respond(allow: boolean): void;
}

// What the engine offers the tab model.
export interface PageEngine {
  createPage(events: PageEvents): Page;
  // The window's inside size (a fullscreen video fills all of it).
  windowSize(): { width: number; height: number };
  isWindowFullscreen(): boolean;
  setWindowFullscreen(on: boolean): void;
  // True once the window is gone (late updates are then dropped).
  readonly closed: boolean;
  // A page's login form was clicked into: the saved login to fill for that
  // site, if any (asked only for secure sites).
  setSavedLoginProvider(
    provider: (origin: string) => { username: string; password: string } | null,
  ): void;
  // Every page about to load (in a tab, Lookout or a popup window) is
  // checked first: `check` says what's dangerous about the address, if
  // anything. A dangerous page is stopped before it loads, and reported to
  // `onBlocked` (`page` is null for a popup window).
  setNavigationGuard(
    check: (url: string) => Promise<string | null> | string | null,
    onBlocked: (page: Page | null, url: string, threat: string) => void,
  ): void;
  // Everything a page loads (scripts, images, frames...; not the page
  // itself) is checked: `shouldBlock` says whether to stop it. `pageUrl` is
  // the address of the page it's for. For blocking ads and trackers.
  setRequestBlocker(
    shouldBlock: (url: string, type: string, pageUrl: string) => boolean,
  ): void;
  // Every download starts here; `download` starts one from a URL.
  onDownload(listener: (download: EngineDownload) => void): void;
  download(url: string): void;
  // Sites asking to use the camera, location and so on. Harmless requests
  // (fullscreen, video DRM...) are allowed without asking, and unusual
  // ones (USB, serial...) refused, before they get here. `isAllowed`
  // answers a site quietly checking whether it already may.
  onPermissionRequest(
    listener: (request: PermissionRequest) => void,
    isAllowed: (
      origin: string,
      kind: PermissionKind,
      detail: string,
    ) => boolean,
  ): void;
}
