// Shapes shared between the main process, the preload bridge and the UI.

// --- Core data model (see CLAUDE.md) ----------------------------------------
// These are the records that will be saved to disk (Phase 3) and could later
// sync between devices, so they hold plain data only.

export interface Space {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
  // The space's pinned tabs are folded away under its name.
  pinsFolded?: boolean;
}

export interface Tab {
  id: string;
  spaceId: string;
  url: string;
  title: string;
  favicon: string;
  pinned: boolean;
  // In Basecamp: the grid of favorite sites shown in every space (then
  // `spaceId` is just the space it was added from).
  basecamp?: boolean;
  homeUrl?: string;
  order: number;
  lastActiveAt: number;
  splitGroupId?: string;
}

// Two tabs shown side by side (split view). `sizes` are each side's share
// of the width; the sidebar shows the pair as one row.
export interface SplitGroup {
  id: string;
  spaceId: string;
  tabIds: string[];
  layout: 'columns';
  sizes: number[];
}

export interface WindowState {
  id: string;
  activeSpaceId: string;
  activeTabId: string | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

// --- The saved session (src/store.ts) ---------------------------------------

// A tab's back/forward history, including each page's scroll position and
// form contents (Chromium's "page state"), so a restored tab picks up
// exactly where it was.
export interface SavedHistory {
  entries: { url: string; title: string; pageState?: string }[];
  index: number;
}

export interface SavedTab extends Tab {
  history?: SavedHistory;
}

export interface SavedWindow extends WindowState {
  bounds?: { x: number; y: number; width: number; height: number };
  maximized?: boolean;
}

export interface SavedSession {
  version: number;
  spaces: Space[];
  tabs: SavedTab[];
  splits?: SplitGroup[];
  window: SavedWindow;
  recentlyClosed: string[];
  // Zoom remembered per site (host → zoom factor; 1 = 100% isn't stored).
  siteZoom?: Record<string, number>;
  // Tabs tidied away into the Archive (newest first), and the days Firn
  // was used (see src/archive.ts).
  archive?: ArchivedTab[];
  daysUsed?: string[];
}

// A tab tidied away into the Archive: enough to bring it back where it was.
export interface ArchivedTab {
  id: string;
  url: string;
  title: string;
  favicon: string;
  spaceId: string;
  archivedAt: number;
}

// Firn's settings (src/settings.ts). `downloadsFolder` '' means the
// system's Downloads folder.
export interface Settings {
  searchEngine: 'duckduckgo' | 'google' | 'bing' | 'ecosia' | 'startpage';
  theme: 'system' | 'light' | 'dark';
  downloadsFolder: string;
  // Where the address bar sits: in the sidebar (the default) or in a top
  // bar that's always there. See "Opinionated: two looks" in CLAUDE.md.
  addressBar: 'sidebar' | 'top';
  // Warn before opening scam and malware sites (Google Safe Browsing).
  safeBrowsing: boolean;
  // Block ads and trackers (src/adblock.ts), except on these sites (their
  // host names, without "www."), where the person chose to allow them.
  adBlocking: boolean;
  adsAllowedSites: string[];
  // The welcome (shown the first time Firn opens) has been seen.
  onboarded: boolean;
  // The version of Firn that last ran here ('' before Firn kept track), so
  // the first start after an update can show what's new.
  lastVersion: string;
  // Archive everyday tabs not looked at for this many days of use (0:
  // never). See src/archive.ts.
  archiveAfter: 0 | 1 | 7 | 30;
}

// What the settings panel shows: the settings, plus the downloads folder
// actually used and Firn's version.
export interface SettingsState {
  settings: Settings;
  downloadsFolder: string;
  version: string;
  // Whether this copy of Firn can warn about dangerous sites (it needs a
  // key for Google's service, added when Firn is built).
  safeBrowsingAvailable: boolean;
  // Whether Firn is the default browser ('unavailable': this copy can't be,
  // e.g. not installed, or on Linux).
  defaultBrowser: 'yes' | 'no' | 'unavailable';
}

// A saved login, as the passwords panel lists it (never with the password).
export interface SavedLogin {
  id: string;
  origin: string;
  username: string;
  lastUsedAt: number;
}

// A downloaded file (src/downloads.ts). `missing`: it finished, but the
// file has since been moved or deleted.
export interface Download {
  id: string;
  url: string;
  name: string;
  path: string;
  state: 'progress' | 'done' | 'failed' | 'cancelled';
  received: number;
  total: number;
  startedAt: number;
  endedAt?: number;
  missing?: boolean;
}

// A page in the browsing history (src/history.ts).
export interface HistoryEntry {
  url: string;
  title: string;
  favicon: string;
  visits: number;
  lastVisit: number;
}

// Quick actions the command bar can run (see runAction in src/main.ts).
export type CommandAction =
  | 'pin'
  | 'basecamp'
  | 'close'
  | 'reopen'
  | 'separate'
  | 'sidebar'
  | 'new-space'
  | 'clear'
  | 'copy-link'
  | 'switch-space'
  | 'find'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'downloads'
  | 'history'
  | 'settings'
  | 'passwords'
  | 'welcome'
  | 'whats-new'
  | 'shortcuts'
  | 'archive';

// --- What the UI is told ----------------------------------------------------

// A tab as the sidebar shows it: the saved record plus live status.
export interface TabView {
  id: string;
  url: string;
  title: string;
  favicon: string;
  isLoading: boolean;
  lastActiveAt: number;
  pinned: boolean;
  basecamp: boolean;
  // False for a tab whose page hasn't loaded yet (restored, or an unloaded
  // pinned tab).
  loaded: boolean;
  // Set when the tab is one side of a split view.
  splitId?: string;
  // The tab is playing sound, and whether it's muted (a muted tab keeps
  // its speaker, crossed out, so it can be turned back on).
  audible: boolean;
  muted: boolean;
}

export interface TabsState {
  tabs: TabView[]; // in sidebar order, top to bottom
  activeTabId: string | null;
  // Split views among these tabs (both sides are always next to each other
  // in `tabs`).
  splits: SplitGroup[];
  // The mini player at the bottom of the sidebar, if a tab that isn't on
  // screen is playing sound (in any space).
  player: PlayerState | null;
  // A tab dragged from the sidebar over the page: the side it would open
  // on in split view (the page has made room on the other side).
  dropPreview: { tabId: string; side: 'left' | 'right' } | null;
}

// The mini player: the tab it's for, and whether it's playing (false:
// paused from the player).
export interface PlayerState {
  tabId: string;
  title: string;
  url: string;
  favicon: string;
  playing: boolean;
}

// The spaces, in order, and which one is shown.
export interface SpacesState {
  spaces: Space[];
  activeSpaceId: string;
}

// Navigation status of the active tab, for the back/forward/reload buttons.
export interface NavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  // The page's zoom (1 = 100%).
  zoom: number;
  // The site has camera, location... answers saved (shows a button in the
  // address bar to change them).
  sitePermissions: boolean;
}

// The sidebar's size and whether it's tucked away. `pageLeft` is where the
// page currently starts (it glides while collapsing or expanding).
// `docking`: the peeking sidebar was just kept open, and is settling into
// the docked sidebar's place (instead of sliding away). `aside`: a tab
// dragged out of the peeking sidebar is over the page, so the sidebar has
// stepped out of the way (it's still there, to finish the drag).
export interface SidebarState {
  width: number;
  collapsed: boolean;
  pageLeft: number;
  peeking: boolean;
  docking: boolean;
  aside: boolean;
}

// Whether the window shows frosted glass, and whether it's in focus (glass
// turns solid out of focus).
export interface FrameState {
  glass: boolean;
  focused: boolean;
  // Firn's own panels are dark (following the system, or settings).
  dark: boolean;
}

export type NavCommand = 'back' | 'forward' | 'reload' | 'stop';

export type WindowCommand = 'minimize' | 'toggle-maximize' | 'close';

// A tab carried under the pointer (see carryTab): where the pointer is
// (`x`, `y`), where on the tab it holds it (`grabX`, `grabY`), how wide
// the tab is, and where the tab was when it was picked up (`fromX`,
// `fromY`: its top left corner), so it can glide from there to the pointer.
export interface CarryTab {
  tabId: string;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  fromX: number;
  fromY: number;
}

// The handle at the top of one side of a split view (on the floating
// layer): shown for `tabId`'s side, being dragged, or gone.
export type SplitHandleState =
  | { kind: 'show'; tabId: string }
  | { kind: 'drag' }
  | { kind: 'hide' };

// What the floating layer above the page is showing.
export type TipState =
  | { kind: 'measure'; text: string }
  | { kind: 'show' }
  | { kind: 'hide' };

export type OverlayState =
  | { mode: 'hidden' }
  // `openId` changes each time it opens, so it always starts fresh.
  // `beside`: what's picked opens in split view beside this tab (its
  // title).
  | { mode: 'command'; openId: number; beside?: string }
  // A site asking to use something: `site` (e.g. "meet.google.com") wants
  // to `ask` (e.g. "use your camera and microphone"); `kind` picks the icon.
  | {
      mode: 'permission';
      openId: number;
      site: string;
      ask: string;
      kind: string;
    }
  // "Save password for site?" after signing in (`update`: a new password
  // for a login saved before), and the saved passwords panel.
  | {
      mode: 'password';
      openId: number;
      site: string;
      username: string;
      update: boolean;
    }
  | { mode: 'passwords'; openId: number }
  // The welcome, the first time Firn opens: a few short setup steps.
  | { mode: 'welcome'; openId: number }
  // A dangerous site was stopped before it loaded: a warning covers its tab.
  | {
      mode: 'danger';
      openId: number;
      site: string;
      url: string;
      threat: 'SOCIAL_ENGINEERING' | 'MALWARE' | 'UNWANTED_SOFTWARE';
    }
  // The history panel (Ctrl+H, Cmd+Y on a Mac) and the settings panel (Ctrl+,).
  | { mode: 'history'; openId: number }
  | { mode: 'settings'; openId: number }
  // What's new: the release notes of every version after `since` (just
  // updated), or of this version alone (since: '', or opened from a menu).
  | { mode: 'whats-new'; openId: number; since: string }
  | { mode: 'shortcuts'; openId: number }
  | { mode: 'archive'; openId: number }
  // Find in page (Ctrl+F): `text` is the last search, to start from.
  | { mode: 'find'; openId: number; text: string }
  // Ctrl+Tab: tabs by most recent use, and which one is picked.
  // `revealed` turns false-to-true once Ctrl has been held a moment.
  | { mode: 'switcher'; tabIds: string[]; index: number; revealed: boolean }
  // Lookout: a link previewed in a panel over the page. `area` is the page's
  // box and `panel` the preview's, both in window coordinates.
  | {
      mode: 'lookout';
      openId: number;
      phase: 'open' | 'closing' | 'expanding';
      area: Rect;
      panel: Rect;
    };

// How a find in page went: the match that's highlighted (1-based; 0 when
// there's none) and how many there are.
export interface FindResult {
  active: number;
  total: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The narrow API the preload script exposes to Firn's UI as `window.firn`.
export interface FirnBridge {
  platform: string;
  // The page's corner radius (rounder windows on newer macOS change it).
  pageRadius: number;
  navigate(input: string): void;
  command(command: NavCommand): void;
  newTab(): void;
  openUrl(input: string): void;
  closeOverlay(): void;
  // The command bar: every open tab (all spaces), history matches, and its
  // quick actions (`arg` is a space id for 'switch-space').
  allTabs(): Promise<(TabView & { spaceId: string })[]>;
  searchHistory(query: string): Promise<HistoryEntry[]>;
  // The history panel: pages visited (newest first), forgetting one, and
  // the "Clear history" menu (last hour, today, all time).
  listHistory(query: string): Promise<HistoryEntry[]>;
  removeHistory(url: string): void;
  showClearHistoryMenu(): void;
  onHistoryChanged(listener: () => void): () => void;
  // The Archive: tabs tidied away (newest first), bringing one back (it
  // opens in its space), or forgetting one.
  listArchive(): Promise<ArchivedTab[]>;
  restoreArchived(id: string): void;
  removeArchived(id: string): void;
  // (With how many tabs were just tidied away, when that's the change.)
  onArchiveChanged(listener: (tidied: number) => void): () => void;
  // The archive box's right-click menu.
  showArchiveMenu(): void;
  // Saved passwords: the answer to "save password?", and the passwords
  // panel (the list never includes passwords; showing one asks for it).
  answerSavePassword(answer: 'save' | 'dismiss'): void;
  // The warning about a dangerous site: go back, or visit it anyway.
  answerDanger(answer: 'back' | 'visit'): void;
  // The welcome is done: start Basecamp with these sites (from
  // BASECAMP_SUGGESTIONS in src/welcome.ts).
  finishWelcome(basecampUrls: string[]): void;
  listPasswords(): Promise<{ logins: SavedLogin[]; canSave: boolean }>;
  revealPassword(id: string): Promise<string | null>;
  copyPassword(id: string): void;
  deletePassword(id: string): void;
  onPasswordsChanged(listener: () => void): () => void;
  // Settings: change some, pick the downloads folder, clear cookies and
  // site data (asks first), forget every site's permission answers.
  updateSettings(changes: Partial<Settings>): void;
  chooseDownloadsFolder(): void;
  clearSiteData(): void;
  resetAllPermissions(): void;
  onSettingsState(listener: (state: SettingsState) => void): () => void;
  // The sidebar's ⋯ menu (new tab, history, downloads, settings).
  showFirnMenu(): void;
  runAction(action: CommandAction, arg?: string): void;
  // Lookout's "Open as tab".
  expandLookout(): void;
  // Find in page: search for `text` (`newSearch` when it changed; otherwise
  // the next or, with `forward` false, the previous match), or close it.
  find(text: string, forward: boolean, newSearch: boolean): void;
  closeFind(): void;
  // Zoom the page in (1), out (-1) or back to 100% (0).
  zoom(step: 1 | -1 | 0): void;
  // Downloads (by id): open the file, show it in its folder, stop it, take
  // it off the list, or try again.
  // The answer to a site's permission prompt ('dismiss': closed without
  // answering, so it asks again next time).
  answerPermission(answer: 'allow' | 'block' | 'dismiss'): void;
  // The address bar's site button: what the current site may use.
  showSitePermissions(): void;
  // "Make Firn default…" (macOS asks; Windows opens its Default apps).
  makeDefaultBrowser(): void;
  openDownload(id: string): void;
  showDownload(id: string): void;
  cancelDownload(id: string): void;
  removeDownload(id: string): void;
  retryDownload(id: string): void;
  // Split view: drag the gap (`ratio` is the left side's share), or end it.
  resizeSplit(id: string, ratio: number): void;
  separateSplit(tabId: string): void;
  toggleSidebar(): void;
  // The peeking sidebar has a text field focused (so it stays open).
  setPeekTyping(typing: boolean): void;
  // The mouse button is held down in the peeking sidebar (a drag may be
  // starting, so it stays open).
  setPeekHolding(holding: boolean): void;
  // macOS: where this layer's sidebar top row is drawn (for the window's
  // traffic lights, which sit in it).
  lightsAt(x: number, y: number): void;
  setSidebarWidth(width: number): void;
  closeTab(id: string): void;
  // The speaker on a tab playing sound: mute it, or turn it back on.
  toggleMute(id: string): void;
  // The mini player's pause / play button.
  togglePlaying(id: string): void;
  // Dragging a tab from the sidebar onto the page, for split view: where
  // the pointer is across (`x`, in this layer), while it's over the page;
  // then drop (true) or not (false: back over the sidebar, or cancelled).
  dragToSplit(id: string, x: number): void;
  endDragToSplit(drop: boolean): void;
  // A tab pulled out of the sidebar is carried under the pointer, drawn on
  // the floating layer (so it stays in front of the page) until it's let
  // go (null). In this layer's coordinates.
  carryTab(carry: CarryTab | null): void;
  // A split view side's handle (on the floating layer): dragged (where the
  // pointer is, on the screen), let go, or its × (take `tabId` out of the
  // split view).
  dragSplitHandle(screenX: number, screenY: number): void;
  dropSplitHandle(): void;
  takeOutOfSplit(tabId: string): void;
  activateTab(id: string): void;
  // Moves a tab within its group, or (with `pinned`) into the pinned or
  // everyday tabs at that spot.
  moveTab(id: string, toIndex: number, pinned?: boolean): void;
  showTabMenu(id: string): void;
  switchSpace(id: string): void;
  newSpace(): void;
  updateSpace(
    id: string,
    changes: {
      name?: string;
      icon?: string;
      color?: string;
      pinsFolded?: boolean;
    },
  ): void;
  // Closes the active space's everyday (unpinned) tabs.
  clearTabs(): void;
  showSpaceMenu(id: string): void;
  // Right-click on empty space in the sidebar.
  showSidebarMenu(): void;
  // A favicon as a data: URL, so the UI can read its colors.
  iconData(url: string): Promise<string | null>;
  // A suggested site's icon for the welcome (see BASECAMP_SUGGESTIONS).
  welcomeIcon(siteUrl: string): Promise<string | null>;
  windowCommand(command: WindowCommand): void;
  // The top bar's hover labels, drawn by the floating layer (the bar is too
  // short to hold them): the bar asks, the floating layer measures and
  // shows (src/ui/tooltips.ts).
  showTip(
    text: string,
    anchor: { left: number; right: number; bottom: number },
  ): void;
  hideTip(): void;
  tipSize(width: number, height: number): void;
  onTipState(listener: (state: TipState) => void): () => void;
  onCarryState(listener: (carry: CarryTab | null) => void): () => void;
  onSplitHandleState(listener: (state: SplitHandleState) => void): () => void;
  ready(): void;
  onNavState(listener: (state: NavState) => void): () => void;
  onTabsState(listener: (state: TabsState) => void): () => void;
  onFocusAddress(listener: (url: string) => void): () => void;
  onMaximizedChange(listener: (maximized: boolean) => void): () => void;
  onOverlayState(listener: (state: OverlayState) => void): () => void;
  onFindResult(listener: (result: FindResult) => void): () => void;
  onDownloadsState(listener: (downloads: Download[]) => void): () => void;
  onTopBarState(listener: (shown: boolean) => void): () => void;
  onSidebarState(listener: (state: SidebarState) => void): () => void;
  onFrameState(listener: (state: FrameState) => void): () => void;
  onSpacesState(listener: (state: SpacesState) => void): () => void;
  // The main process asks the sidebar to start renaming a space.
  onRenameSpace(listener: (id: string) => void): () => void;
  // ...or to show the icon picker for a space.
  onPickSpaceIcon(listener: (id: string) => void): () => void;
}
