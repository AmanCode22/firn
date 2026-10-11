// Owns the tabs of one window: the tab records (the data model) and the web
// page behind each one. Everything that changes tabs goes through here, and
// every change is reported back so the UI can redraw the sidebar.
//
// Pages come from the browser engine (src/engine/engine.ts); nothing here
// depends on Electron.
//
// Tabs from every space live here together; only the active space's tabs
// (plus Basecamp, which every space shares) are shown, switched between and
// counted. Tabs in other spaces stay as they are in the background.
//
// The order always keeps three groups: Basecamp first, then pinned tabs,
// then everyday tabs.

import { randomUUID } from 'node:crypto';
import type {
  Page,
  PageBounds,
  PageContextMenu,
  PageEngine,
  PageEvents,
} from './engine/engine';
import { toNavigableUrl } from './url';
import type {
  ArchivedTab,
  FindResult,
  NavCommand,
  NavState,
  PlayerState,
  SavedHistory,
  SavedTab,
  SplitGroup,
  Tab,
  TabsState,
} from './types';

interface Entry {
  tab: Tab;
  page: Page;
  // Restored tabs wait to load their page until they're first shown.
  loaded: boolean;
  // Saved back/forward history to restore when the tab first loads.
  savedHistory?: SavedHistory;
  // Sound, for the mini player: when the page last started making sound,
  // whether it is (as last reported), and whether it was paused from the
  // player ('muted': nothing could be paused, so it was muted instead).
  audibleSince?: number;
  wasAudible?: boolean;
  paused?: 'media' | 'muted';
}

// How much back/forward history is kept per tab in the saved session.
const MAX_SAVED_HISTORY = 50;

// Basecamp holds at most this many sites.
export const BASECAMP_MAX = 12;

// Which of the three groups a tab is in (the order keeps them in this order).
const BASECAMP = 0;
const PINNED = 1;
const EVERYDAY = 2;
// The Archive keeps this many tabs (older ones are still in History).
const ARCHIVE_MAX = 200;
const groupOf = (tab: Tab) =>
  tab.basecamp ? BASECAMP : tab.pinned ? PINNED : EVERYDAY;

// Split view: the gap between the two sides (the same as the page's inset
// from the window), and how narrow a side can get.
export const SPLIT_GAP = 8;
const SPLIT_MIN = 0.2;

// Where each side of a split view sits within the page's area.
// How long a page takes to glide to a new place (matches --motion in
// src/ui/styles.css).
const GLIDE_MS = 200;

const sameBounds = (a: PageBounds, b: PageBounds) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// Where a gliding page is now (easing out).
function currentBounds(glide: {
  from: PageBounds;
  to: PageBounds;
  start: number;
}): PageBounds {
  const t = Math.min(1, (Date.now() - glide.start) / GLIDE_MS);
  const eased = 1 - Math.pow(1 - t, 3);
  const at = (a: number, b: number) => Math.round(a + (b - a) * eased);
  return {
    x: at(glide.from.x, glide.to.x),
    y: at(glide.from.y, glide.to.y),
    width: at(glide.from.width, glide.to.width),
    height: at(glide.from.height, glide.to.height),
  };
}

export function splitRects(area: PageBounds, sizes: number[]): PageBounds[] {
  const first = Math.round((area.width - SPLIT_GAP) * sizes[0]);
  return [
    { ...area, width: first },
    {
      ...area,
      x: area.x + first + SPLIT_GAP,
      width: area.width - first - SPLIT_GAP,
    },
  ];
}

interface TabManagerOptions {
  // The space shown first.
  spaceId: string;
  // Where the page sits inside the window (changes with window size), or
  // would sit with its top edge at `top`.
  pageBounds: (top?: number) => PageBounds;
  pageRadius: number;
  onTabsChanged: (state: TabsState) => void;
  onNavChanged: (state: NavState) => void;
  // The last tab was closed.
  onEmpty: () => void;
  // A link was Shift+clicked: preview it in Lookout.
  onLookout: (url: string) => void;
  // A tab's page went somewhere (`newVisit`), or its title or icon became
  // known (for the browsing history).
  onVisit: (
    url: string,
    title: string,
    favicon: string,
    newVisit: boolean,
  ) => void;
  // You signed in on a tab's page (see src/passwords.ts), and a tab's page
  // went to another address (a sign-in that worked usually does).
  onLogin: (
    id: string,
    origin: string,
    username: string,
    password: string,
  ) => void;
  onPageNavigated: (id: string) => void;
  // A page went into or out of fullscreen (e.g. a video).
  onFullscreenChange: (on: boolean) => void;
  // A tab's page was right-clicked.
  onContextMenu: (id: string, menu: PageContextMenu) => void;
  // How a find in page on the current tab went.
  onFindResult: (result: FindResult) => void;
  // A site's zoom changed (to save it).
  onSiteZoomChanged: () => void;
}

// Zoom steps, the same as Chrome's.
const ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
];

// Ctrl+wheel zooms at most one step per this many milliseconds.
const ZOOM_STEP_MS = 100;

// The next zoom step up (1) or down (-1) from `zoom`.
export function nextZoom(zoom: number, step: 1 | -1) {
  if (step > 0) return ZOOM_LEVELS.find((z) => z > zoom + 0.001) ?? zoom;
  return ZOOM_LEVELS.findLast((z) => z < zoom - 0.001) ?? zoom;
}

export class TabManager {
  private entries = new Map<string, Entry>();
  private order: string[] = [];
  private activeId: string | null = null;
  private spaceId: string;
  // The tab each space was last on, to return to when switching back.
  private lastInSpace = new Map<string, string>();
  // Split views, and the tabs whose pages are on screen right now (two
  // when the active tab is in a split view).
  private splits = new Map<string, SplitGroup>();
  private onScreen: string[] = [];
  private recentlyClosed: string[] = [];
  private fullscreen = false;
  // Zoom remembered per site (host → zoom; 100% isn't stored), and the tab
  // a find in page is running on.
  private siteZoom = new Map<string, number>();
  private findId: string | null = null;

  constructor(
    private engine: PageEngine,
    private options: TabManagerOptions,
  ) {
    this.spaceId = options.spaceId;
  }

  // --- Reading --------------------------------------------------------------

  get activeTabId() {
    return this.activeId;
  }

  private get active(): Entry | undefined {
    return this.activeId ? this.entries.get(this.activeId) : undefined;
  }

  get activeSpaceId() {
    return this.spaceId;
  }

  // Basecamp and the active space's tabs, in sidebar order.
  private get shown(): string[] {
    return this.order.filter((id) => this.isShown(id));
  }

  private isShown(id: string) {
    const tab = this.entries.get(id)?.tab;
    return !!tab && (tab.basecamp || tab.spaceId === this.spaceId);
  }

  // Which space a tab belongs to (none for Basecamp, which is in every one).
  spaceOfTab(id: string) {
    const tab = this.entries.get(id)?.tab;
    return tab && !tab.basecamp ? tab.spaceId : undefined;
  }

  // Every tab in every space (for the command bar), Basecamp first.
  allTabs() {
    return this.order.map((id) => {
      const { tab, page, loaded } = this.entries.get(id)!;
      return {
        id,
        spaceId: tab.spaceId,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        isLoading: page.isLoading,
        lastActiveAt: tab.lastActiveAt,
        pinned: tab.pinned,
        basecamp: !!tab.basecamp,
        loaded,
        splitId: tab.splitGroupId,
        audible: page.audible,
        muted: page.muted,
      };
    });
  }

  // How many tabs a space has of its own (for "delete this space?").
  countIn(spaceId: string) {
    return this.order.filter((id) => {
      const { tab } = this.entries.get(id)!;
      return !tab.basecamp && tab.spaceId === spaceId;
    }).length;
  }

  get basecampCount() {
    return this.order.filter((id) => this.entries.get(id)!.tab.basecamp).length;
  }

  state(): TabsState {
    return {
      activeTabId: this.activeId,
      tabs: this.shown.map((id) => {
        const { tab, page } = this.entries.get(id)!;
        return {
          id,
          url: tab.url,
          title: tab.title,
          favicon: tab.favicon,
          isLoading: page.isLoading,
          lastActiveAt: tab.lastActiveAt,
          pinned: tab.pinned,
          basecamp: !!tab.basecamp,
          loaded: this.entries.get(id)!.loaded,
          splitId: tab.splitGroupId,
          audible: page.audible,
          muted: page.muted,
        };
      }),
      splits: [...this.splits.values()].filter(
        (split) => split.spaceId === this.spaceId,
      ),
      player: this.player(),
      dropPreview: this.dropPreview,
    };
  }

  // The mini player: the tab playing sound that isn't on screen (the one
  // that started last, in any space), or one paused from the player. Not
  // a tab muted on purpose.
  private player(): PlayerState | null {
    let best: { id: string; entry: Entry } | null = null;
    for (const [id, entry] of this.entries) {
      if (this.onScreen.includes(id)) continue;
      const { page } = entry;
      const playing = page.audible && !page.muted && !entry.paused;
      if (!playing && !entry.paused) continue;
      if (!best || (entry.audibleSince ?? 0) > (best.entry.audibleSince ?? 0))
        best = { id, entry };
    }
    if (!best) return null;
    const { tab, paused } = best.entry;
    return {
      tabId: best.id,
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon,
      playing: !paused,
    };
  }

  // The mini player's button: pauses the tab's videos and sounds (or, if
  // there's nothing it can pause, mutes it), or plays them again.
  async togglePlaying(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const { page } = entry;
    if (entry.paused === 'muted') page.setMuted(false);
    else if (entry.paused === 'media') void page.playMedia();
    if (entry.paused) {
      entry.paused = undefined;
    } else {
      // Shown as paused right away (pausing takes a moment).
      entry.paused = 'media';
      this.emitTabs();
      const count = await page.pauseMedia();
      if (entry.page !== page || entry.paused !== 'media') return;
      if (!count) {
        page.setMuted(true);
        entry.paused = 'muted';
      }
    }
    this.emitTabs();
  }

  navState(): NavState {
    const entry = this.active;
    if (!entry) {
      return {
        url: '',
        title: '',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        zoom: 1,
        sitePermissions: false,
      };
    }
    const { page } = entry;
    return {
      url: entry.tab.url,
      title: entry.tab.title,
      canGoBack: page.canGoBack,
      canGoForward: page.canGoForward,
      isLoading: page.isLoading,
      zoom: this.zoomOf(entry.tab.url),
      // Filled in by the window, which keeps the site permissions.
      sitePermissions: false,
    };
  }

  // --- Changing tabs --------------------------------------------------------

  // Opens a tab. `after` places it right below another tab (e.g. links
  // opened from a page); otherwise it goes to the top of the list.
  // `restore` brings back a saved tab: it goes to the end of the list and
  // waits to load until it's first shown.
  create(
    url: string,
    opts: { activate?: boolean; after?: string; restore?: SavedTab } = {},
  ) {
    const { activate = true, after, restore } = opts;
    const id = restore?.id ?? randomUUID();
    const tab: Tab = {
      id,
      spaceId: restore?.spaceId ?? this.spaceId,
      url,
      title: restore?.title ?? '',
      favicon: restore?.favicon ?? '',
      pinned: restore?.pinned ?? false,
      basecamp: restore?.basecamp || undefined,
      homeUrl: restore?.homeUrl,
      order: 0,
      lastActiveAt: restore?.lastActiveAt ?? Date.now(),
    };

    const page = this.makePage(id);
    const entry: Entry = {
      tab,
      page,
      loaded: false,
      savedHistory: restore?.history,
    };
    this.entries.set(id, entry);
    // New tabs go to the top of the everyday tabs, or right below the
    // everyday tab they were opened from.
    const afterTab = after ? this.entries.get(after)?.tab : undefined;
    if (restore) this.order.push(id);
    else if (afterTab && groupOf(afterTab) === EVERYDAY)
      this.order.splice(this.order.indexOf(after!) + 1, 0, id);
    else this.order.splice(this.groupStart(EVERYDAY), 0, id);
    if (restore) this.keepGroupsInOrder();
    this.renumber();

    if (!restore) this.load(entry);

    if (activate || (!this.activeId && !restore)) this.activate(id);
    else this.emitTabs();
    return id;
  }

  // --- Archiving old tabs ---------------------------------------------------
  // Everyday tabs not looked at for a while tidy themselves away into the
  // Archive (src/archive.ts decides what's old), where they can be brought
  // back. Never archived: pinned and Basecamp tabs, the tab on screen and
  // each space's current tab, a tab playing sound, and a tab in split view.

  private archived: ArchivedTab[] = [];

  // The Archive, newest first.
  get archive(): ArchivedTab[] {
    return this.archived.map((tab) => ({ ...tab }));
  }

  restoreArchive(saved: unknown) {
    if (!Array.isArray(saved)) return;
    this.archived = saved
      .filter(
        (t): t is ArchivedTab =>
          !!t &&
          typeof t.id === 'string' &&
          typeof t.url === 'string' &&
          typeof t.spaceId === 'string' &&
          typeof t.archivedAt === 'number',
      )
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: typeof t.title === 'string' ? t.title : '',
        favicon: typeof t.favicon === 'string' ? t.favicon : '',
        spaceId: t.spaceId,
        archivedAt: t.archivedAt,
      }))
      .slice(0, ARCHIVE_MAX);
  }

  // Archives the everyday tabs `isOld` says haven't been looked at for long
  // enough (by when they last were). Returns how many.
  archiveOld(isOld: (lastActiveAt: number) => boolean) {
    const kept = new Set<string | null>([
      this.activeId,
      ...this.onScreen,
      ...this.lastInSpace.values(),
    ]);
    // Each space's most recent tab too (Firn only knows a space's current
    // tab once it has been shown), so no space is left empty.
    const newest = new Map<string, Tab>();
    for (const { tab } of this.entries.values())
      if (
        !tab.basecamp &&
        (newest.get(tab.spaceId)?.lastActiveAt ?? -1) < tab.lastActiveAt
      )
        newest.set(tab.spaceId, tab);
    for (const tab of newest.values()) kept.add(tab.id);
    const old = this.order.filter((id) => {
      const entry = this.entries.get(id);
      return (
        !!entry &&
        groupOf(entry.tab) === EVERYDAY &&
        !kept.has(id) &&
        !entry.tab.splitGroupId &&
        !entry.page.audible &&
        isOld(entry.tab.lastActiveAt)
      );
    });
    if (!old.length) return 0;
    const now = Date.now();
    for (const id of old) {
      const { tab, page } = this.entries.get(id)!;
      this.order.splice(this.order.indexOf(id), 1);
      this.entries.delete(id);
      page.destroy();
      this.archived.unshift({
        id,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        spaceId: tab.spaceId,
        archivedAt: now,
      });
    }
    this.archived = this.archived.slice(0, ARCHIVE_MAX);
    this.renumber();
    this.emitTabs();
    return old.length;
  }

  // Takes a tab out of the Archive (to bring it back, or to forget it).
  // Forgets archived tabs that have rested long enough (they stay in
  // History); returns how many.
  forgetArchived(isOld: (archivedAt: number) => boolean) {
    const before = this.archived.length;
    this.archived = this.archived.filter((tab) => !isOld(tab.archivedAt));
    return before - this.archived.length;
  }

  takeArchived(id: string): ArchivedTab | undefined {
    const index = this.archived.findIndex((tab) => tab.id === id);
    if (index < 0) return undefined;
    return this.archived.splice(index, 1)[0];
  }

  // --- Spaces ---------------------------------------------------------------

  // Shows another space: its most recently used tab comes back (or an empty
  // page, if it has no tabs yet).
  setSpace(spaceId: string) {
    if (spaceId === this.spaceId) return;
    this.hideOnScreen();
    this.spaceId = spaceId;
    this.activeId = null;
    // The tab this space was last on, or its most recent own tab.
    const remembered = this.lastInSpace.get(spaceId);
    const recent = this.recentIds();
    const next =
      remembered && this.isShown(remembered)
        ? remembered
        : (recent.find((id) => !this.entries.get(id)!.tab.basecamp) ??
          recent[0]);
    if (next) {
      this.activate(next);
    } else {
      this.emitTabs();
      this.emitNav();
    }
  }

  // Moves a tab to another space (from its right-click menu). If it was the
  // tab on screen, the space's next most recent tab takes its place.
  moveToSpace(id: string, spaceId: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.tab.basecamp || entry.tab.spaceId === spaceId) return;
    this.separate(id);
    entry.tab.spaceId = spaceId;
    if (this.activeId === id) {
      this.hideOnScreen();
      this.activeId = null;
      const next = this.recentIds()[0];
      if (next) {
        this.activate(next);
        return;
      }
      this.emitNav();
    }
    this.emitTabs();
  }

  // Closes every tab in a space (when the space is deleted).
  closeSpace(spaceId: string) {
    for (const id of this.order.slice()) {
      const entry = this.entries.get(id)!;
      if (entry.tab.basecamp || entry.tab.spaceId !== spaceId) continue;
      this.separate(id);
      this.order.splice(this.order.indexOf(id), 1);
      this.entries.delete(id);
      entry.page.destroy();
    }
    this.renumber();
  }

  // Where a group starts in the order (or would start, if it's empty).
  private groupStart(group: number) {
    const index = this.order.findIndex(
      (id) => groupOf(this.entries.get(id)!.tab) >= group,
    );
    return index < 0 ? this.order.length : index;
  }

  // Where a group ends: the spot right after its last tab.
  private groupEnd(group: number) {
    return this.groupStart(group + 1);
  }

  private keepGroupsInOrder() {
    this.order = [0, 1, 2].flatMap((group) =>
      this.order.filter((id) => groupOf(this.entries.get(id)!.tab) === group),
    );
  }

  // Takes a tab out of the order and puts it back at `index` (worked out
  // after it's been taken out).
  private reinsert(id: string, where: () => number) {
    this.order.splice(this.order.indexOf(id), 1);
    this.order.splice(where(), 0, id);
    this.renumber();
    this.emitTabs();
  }

  // --- Pinned tabs and Basecamp ----------------------------------------------

  // Pins a tab: it moves to the end of the space's pinned tabs and remembers
  // the page it's on as its home.
  pin(id: string) {
    const tab = this.entries.get(id)?.tab;
    if (!tab || groupOf(tab) !== EVERYDAY) return;
    this.separate(id);
    tab.pinned = true;
    tab.homeUrl = tab.url;
    this.reinsert(id, () => this.groupEnd(PINNED));
  }

  // Unpins a tab: it moves to the top of the everyday tabs.
  unpin(id: string) {
    const tab = this.entries.get(id)?.tab;
    if (!tab || groupOf(tab) !== PINNED) return;
    tab.pinned = false;
    tab.homeUrl = undefined;
    this.reinsert(id, () => this.groupStart(EVERYDAY));
  }

  togglePin(id: string) {
    const tab = this.entries.get(id)?.tab;
    if (tab?.pinned) this.unpin(id);
    else this.pin(id);
  }

  // Adds a tab to Basecamp (shown in every space), keeping its home page if
  // it was pinned.
  addToBasecamp(id: string) {
    const tab = this.entries.get(id)?.tab;
    if (!tab || tab.basecamp || this.basecampCount >= BASECAMP_MAX) return;
    this.separate(id);
    tab.basecamp = true;
    tab.pinned = false;
    tab.homeUrl = tab.homeUrl ?? tab.url;
    this.reinsert(id, () => this.groupEnd(BASECAMP));
  }

  // Takes a tab out of Basecamp: it becomes an everyday tab in this space.
  removeFromBasecamp(id: string) {
    const tab = this.entries.get(id)?.tab;
    if (!tab?.basecamp) return;
    tab.basecamp = undefined;
    tab.homeUrl = undefined;
    tab.spaceId = this.spaceId;
    this.reinsert(id, () => this.groupStart(EVERYDAY));
  }

  // Closes the active space's everyday tabs (the divider's "Clear").
  clearEveryday() {
    const everyday = this.shown.filter(
      (id) => groupOf(this.entries.get(id)!.tab) === EVERYDAY,
    );
    if (!everyday.length) return;
    const wasActive = this.activeId && everyday.includes(this.activeId);
    for (const id of everyday) {
      const entry = this.entries.get(id)!;
      this.separate(id);
      this.order.splice(this.order.indexOf(id), 1);
      this.entries.delete(id);
      if (entry.tab.url) this.recentlyClosed.push(entry.tab.url);
      entry.page.destroy();
    }
    this.recentlyClosed = this.recentlyClosed.slice(-20);
    this.renumber();
    if (wasActive) {
      // Back to the most recent page that's still open, if there is one.
      this.activeId = null;
      const next = this.recentIds().find((id) => this.entries.get(id)!.loaded);
      if (next) return this.activate(next);
      this.emitNav();
    }
    this.emitTabs();
  }

  // The speaker on a tab: mutes it, or turns its sound back on.
  toggleMute(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.page.setMuted(!entry.page.muted);
    // Unmuting a tab the mini player had muted plays it again.
    if (entry.paused === 'muted') entry.paused = undefined;
    this.emitTabs();
  }

  // Takes a pinned tab back to its home page.
  goHome(id: string) {
    const entry = this.entries.get(id);
    const home = entry?.tab.homeUrl;
    if (!entry || !home) return;
    entry.tab.url = home;
    entry.savedHistory = undefined;
    if (entry.loaded) entry.page.load(home);
    this.emitTabs();
  }

  // "Closing" a pinned tab keeps the pin: its page is unloaded and it goes
  // back to its home page, to load again when it's next clicked.
  private unloadPinned(entry: Entry) {
    const { tab } = entry;
    const wasActive = this.activeId === tab.id;
    if (wasActive) {
      const others = this.recentIds().filter((other) => other !== tab.id);
      const next =
        others.find((other) => this.entries.get(other)!.loaded) ?? others[0];
      if (next) this.activate(next);
    }
    if (!entry.loaded && !wasActive) return;
    // Swap in a fresh, empty page.
    entry.page.destroy();
    entry.page = this.makePage(tab.id);
    entry.loaded = false;
    entry.savedHistory = undefined;
    entry.paused = undefined;
    entry.wasAudible = false;
    tab.url = tab.homeUrl ?? tab.url;
    if (this.activeId === tab.id) this.activate(tab.id);
    else this.emitTabs();
  }

  // Loads a tab's page: its saved history if it has one (landing back on the
  // same page and scroll position), otherwise its address.
  private load(entry: Entry) {
    if (entry.loaded) return;
    entry.loaded = true;
    const { page } = entry;
    const history = entry.savedHistory;
    entry.savedHistory = undefined;
    if (history?.entries.length) {
      page.restoreHistory(history).catch(() => page.load(entry.tab.url));
    } else {
      page.load(entry.tab.url);
    }
  }

  // Every tab as it should be saved, in sidebar order.
  serialize(): SavedTab[] {
    return this.order.map((id) => {
      const { tab, page, loaded, savedHistory } = this.entries.get(id)!;
      // Keep the most recent part of a long history.
      const history = loaded ? page.history(MAX_SAVED_HISTORY) : savedHistory;
      return { ...tab, history };
    });
  }

  get closedUrls() {
    return [...this.recentlyClosed];
  }

  set closedUrls(urls: string[]) {
    this.recentlyClosed = urls.slice(-20);
  }

  activate(id: string) {
    const entry = this.entries.get(id);
    if (!entry || !this.isShown(id)) return;
    this.activeId = id;
    this.lastInSpace.set(this.spaceId, id);
    entry.tab.lastActiveAt = Date.now();
    // Both sides of a split view are on screen together.
    const next = this.splitOf(id)?.tabIds ?? [id];
    for (const other of this.onScreen)
      if (!next.includes(other)) this.entries.get(other)?.page.hide();
    this.onScreen = next;
    for (const shownId of next) {
      const shown = this.entries.get(shownId)!;
      // On screen, the page's own controls (and the tab's speaker, if the
      // player muted it) take over from the mini player.
      shown.paused = undefined;
      this.load(shown);
    }
    this.layout();
    entry.page.focus();
    this.emitTabs();
    this.emitNav();
  }

  private hideOnScreen() {
    for (const id of this.onScreen) this.entries.get(id)?.page.hide();
    this.onScreen = [];
  }

  // --- Split view -------------------------------------------------------------

  private splitOf(id: string) {
    const splitId = this.entries.get(id)?.tab.splitGroupId;
    return splitId ? this.splits.get(splitId) : undefined;
  }

  // Can `id` be shown beside the active tab? (Two everyday tabs of the same
  // space, neither already in a split view.)
  canSplitWith(id: string) {
    const other = this.entries.get(id)?.tab;
    const active = this.active?.tab;
    return (
      !!other &&
      !!active &&
      other !== active &&
      groupOf(other) === EVERYDAY &&
      groupOf(active) === EVERYDAY &&
      other.spaceId === active.spaceId &&
      !other.splitGroupId &&
      !active.splitGroupId
    );
  }

  // The tabs that could go beside the active one, in sidebar order.
  splitCandidates() {
    return this.shown
      .filter((id) => this.canSplitWith(id))
      .map((id) => this.entries.get(id)!.tab);
  }

  // Shows `id` beside the active tab, half and half. In the sidebar the two
  // become one row, where the active tab was.
  splitWith(id: string) {
    if (!this.canSplitWith(id)) return;
    const activeId = this.activeId!;
    const split: SplitGroup = {
      id: randomUUID(),
      spaceId: this.spaceId,
      tabIds: [activeId, id],
      layout: 'columns',
      sizes: [0.5, 0.5],
    };
    this.splits.set(split.id, split);
    for (const tabId of split.tabIds)
      this.entries.get(tabId)!.tab.splitGroupId = split.id;
    this.order.splice(this.order.indexOf(id), 1);
    this.order.splice(this.order.indexOf(activeId) + 1, 0, id);
    this.renumber();
    this.activate(activeId);
  }

  // Ends a split view: both tabs carry on as ordinary tabs, and the one that
  // was active fills the page again.
  unsplit(id: string) {
    if (!this.splitOf(id)) return;
    this.separate(id);
    if (this.activeId) this.activate(this.activeId);
    else this.emitTabs();
  }

  // Takes a tab's split view apart (without redrawing).
  private separate(id: string) {
    const split = this.splitOf(id);
    if (!split) return;
    this.splits.delete(split.id);
    for (const tabId of split.tabIds) {
      const tab = this.entries.get(tabId)?.tab;
      if (tab) tab.splitGroupId = undefined;
    }
  }

  // --- Dragging a tab into split view ----------------------------------------
  // While a tab from the sidebar is dragged over the page, the page on
  // screen makes room: it moves to one half, and the other half shows where
  // the tab will open (drawn by the sidebar's layer, below the page).
  // Dropping it there opens the two side by side. Any tab can be dragged
  // in: a Basecamp or pinned tab stays where it is, and a copy of it joins
  // the split (in the everyday tabs), so they're never moved by accident.

  private dropPreview: { tabId: string; side: 'left' | 'right' } | null = null;

  // A tab is being dragged over the page, and the page has made room.
  get isPreviewingDrop() {
    return this.dropPreview !== null;
  }

  // Can `id` be dropped beside what's on screen?
  private canDropToSplit(id: string) {
    const entry = this.active;
    if (!entry || this.fullscreen || !this.entries.has(id)) return false;
    if (id === entry.tab.id) return false;
    // Already one side of the split on screen: it's there.
    return !this.splitOf(entry.tab.id)?.tabIds.includes(id);
  }

  // The tab dragged over the page at window position `x` (null: it left the
  // page, or the drag ended).
  previewDrop(id: string | null, x = 0) {
    let next: typeof this.dropPreview = null;
    if (id && this.canDropToSplit(id)) {
      const area = this.options.pageBounds();
      next = {
        tabId: id,
        side: x < area.x + area.width / 2 ? 'left' : 'right',
      };
    }
    const now = this.dropPreview;
    if (now?.tabId === next?.tabId && now?.side === next?.side) return;
    this.dropPreview = next;
    this.glideNext = true;
    this.layout();
    this.emitTabs();
  }

  // Drops the dragged tab where its preview is: a split view of it and
  // what was on screen (on a split view, it takes that side's place, and
  // the tab that was there carries on as an ordinary tab).
  dropToSplit() {
    const drop = this.dropPreview;
    this.dropPreview = null;
    if (!drop || !this.canDropToSplit(drop.tabId)) {
      this.glideNext = true;
      this.layout();
      this.emitTabs();
      return;
    }
    const activeId = this.activeId!;
    const current = this.splitOf(activeId);
    // What stays: the other side of the split on screen, or the tab.
    const stays = current
      ? current.tabIds[drop.side === 'left' ? 1 : 0]
      : activeId;
    if (current) this.separate(activeId);
    this.separate(drop.tabId);
    const stayId = this.everydayCopyOf(stays);
    const dropId = this.everydayCopyOf(drop.tabId, stayId);
    const split: SplitGroup = {
      id: randomUUID(),
      spaceId: this.spaceId,
      tabIds: drop.side === 'left' ? [dropId, stayId] : [stayId, dropId],
      layout: 'columns',
      sizes: [0.5, 0.5],
    };
    this.splits.set(split.id, split);
    for (const tabId of split.tabIds)
      this.entries.get(tabId)!.tab.splitGroupId = split.id;
    // The two sides sit next to each other, where the one that stays was.
    this.order.splice(this.order.indexOf(dropId), 1);
    const at = this.order.indexOf(stayId);
    this.order.splice(drop.side === 'left' ? at : at + 1, 0, dropId);
    this.renumber();
    this.activate(dropId);
  }

  // `id` itself if it's an everyday tab of this space; otherwise (a
  // Basecamp or pinned tab) a copy of it among the everyday tabs, below
  // `after` if given.
  private everydayCopyOf(id: string, after?: string) {
    const { tab } = this.entries.get(id)!;
    if (groupOf(tab) === EVERYDAY && tab.spaceId === this.spaceId) return id;
    const copy = this.create(tab.url, { activate: false, after });
    const copied = this.entries.get(copy)!.tab;
    copied.title = tab.title;
    copied.favicon = tab.favicon;
    return copy;
  }

  // Dragging the gap between the two sides: `ratio` is the left side's
  // share of the width.
  resizeSplit(splitId: string, ratio: number) {
    const split = this.splits.get(splitId);
    if (!split || !Number.isFinite(ratio)) return;
    const left = Math.max(SPLIT_MIN, Math.min(1 - SPLIT_MIN, ratio));
    split.sizes = [left, 1 - left];
    this.layout();
    this.emitTabs();
  }

  // --- Rearranging a split view from its handle ------------------------------
  // Each side of a split view has a small handle at its top (drawn by the
  // floating layer; see src/main.ts). Dragging it over the other side
  // swaps them: while it's over there, the two glide past each other to
  // show it, and letting go keeps it. Its × takes that side out of the
  // split (the tab stays, as an ordinary tab).

  // The split view on screen: its tabs left to right, where each one sits
  // (swapped while a swap is shown), and where the two halves meet.
  splitOnScreen() {
    const entry = this.active;
    if (!entry || this.fullscreen || this.dropPreview) return null;
    const split = this.splitOf(entry.tab.id);
    if (!split) return null;
    const area = this.options.pageBounds();
    const swapped = this.swapPreview === split.id;
    const sizes = swapped ? [split.sizes[1], split.sizes[0]] : split.sizes;
    const rects = splitRects(area, sizes);
    const ids = swapped ? [split.tabIds[1], split.tabIds[0]] : split.tabIds;
    return {
      id: split.id,
      tabIds: [...split.tabIds],
      rects: Object.fromEntries(ids.map((id, i) => [id, rects[i]])),
      middle: area.x + area.width * split.sizes[0],
    };
  }

  private swapPreview: string | null = null;

  // Shows the split view on screen with its sides swapped (or not).
  previewSwap(on: boolean) {
    const split = this.active && this.splitOf(this.active.tab.id);
    const next = on && split ? split.id : null;
    if (next === this.swapPreview) return;
    this.swapPreview = next;
    this.glideNext = true;
    this.layout();
  }

  // Keeps the swap that's shown.
  swapSides() {
    const split = this.swapPreview && this.splits.get(this.swapPreview);
    this.swapPreview = null;
    if (!split) return;
    split.tabIds.reverse();
    split.sizes.reverse();
    // The sidebar row lists them in the same order.
    const [a, b] = split.tabIds;
    const first = Math.min(this.order.indexOf(a), this.order.indexOf(b));
    this.order = this.order.filter((id) => id !== a && id !== b);
    this.order.splice(first, 0, a, b);
    this.renumber();
    this.layout();
    this.emitTabs();
  }

  // Takes one side out of its split view: it carries on as an ordinary
  // tab, and the other side fills the page.
  takeOutOfSplit(id: string) {
    const split = this.splitOf(id);
    if (!split) return;
    const other = split.tabIds.find((t) => t !== id)!;
    this.separate(id);
    this.activate(other);
  }

  // Clicking into one side makes it the current tab (the address bar and
  // buttons follow it), without anything moving.
  private focused(id: string) {
    if (id === this.activeId || !this.onScreen.includes(id)) return;
    this.activeId = id;
    this.lastInSpace.set(this.spaceId, id);
    this.entries.get(id)!.tab.lastActiveAt = Date.now();
    this.emitTabs();
    this.emitNav();
  }

  get splitGroups() {
    return [...this.splits.values()];
  }

  // Brings back saved split views whose tabs are all still here.
  restoreSplits(saved: SplitGroup[] = []) {
    for (const split of saved) {
      const tabs = split.tabIds.map((id) => this.entries.get(id)?.tab);
      if (
        split.tabIds.length !== 2 ||
        tabs.some(
          (tab) => !tab || groupOf(tab) !== EVERYDAY || tab.splitGroupId,
        )
      )
        continue;
      const left = Math.max(SPLIT_MIN, Math.min(1 - SPLIT_MIN, split.sizes[0]));
      this.splits.set(split.id, {
        ...split,
        spaceId: tabs[0]!.spaceId,
        layout: 'columns',
        sizes: [left, 1 - left],
      });
      for (const tab of tabs) tab!.splitGroupId = split.id;
      // Keep the two sides next to each other.
      const [first, second] = split.tabIds;
      this.order.splice(this.order.indexOf(second), 1);
      this.order.splice(this.order.indexOf(first) + 1, 0, second);
    }
    // A tab that says it's in a split view that didn't come back isn't.
    for (const { tab } of this.entries.values())
      if (tab.splitGroupId && !this.splits.has(tab.splitGroupId))
        tab.splitGroupId = undefined;
    this.renumber();
  }

  close(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (groupOf(entry.tab) !== EVERYDAY) {
      this.unloadPinned(entry);
      return;
    }
    // Closing one side of a split view leaves the other on its own.
    const partner = this.splitOf(id)?.tabIds.find((other) => other !== id);
    this.separate(id);
    const index = this.everyday.indexOf(id);
    this.order.splice(this.order.indexOf(id), 1);
    this.entries.delete(id);
    this.onScreen = this.onScreen.filter((other) => other !== id);
    if (entry.tab.url) this.recentlyClosed.push(entry.tab.url);
    this.recentlyClosed = this.recentlyClosed.slice(-20);

    entry.page.destroy();
    this.renumber();

    if (this.activeId !== id) {
      // The split's other side, still on screen, now fills the page.
      if (partner && this.onScreen.includes(partner)) this.layout();
      this.emitTabs();
      return;
    }
    // Move to the split's other side, else the tab that slid into its place
    // or the one above, else the most recent page still open.
    const everyday = this.everyday;
    const next =
      partner ??
      everyday[Math.min(index, everyday.length - 1)] ??
      this.recentIds().find((other) => this.entries.get(other)!.loaded);
    if (next) {
      this.activate(next);
      return;
    }
    this.activeId = null;
    this.emitTabs();
    this.emitNav();
    this.options.onEmpty();
  }

  // The active space's everyday tabs, in order.
  private get everyday() {
    return this.shown.filter(
      (id) => groupOf(this.entries.get(id)!.tab) === EVERYDAY,
    );
  }

  // Opens whatever was typed (an address or a search) in a new tab.
  openTyped(input: string) {
    const url = toNavigableUrl(input);
    return url ? this.create(url) : undefined;
  }

  // Moves a tab to a new position among the tabs of its own group that are
  // on screen (Basecamp, this space's pins, or its everyday tabs), for drag
  // to reorder. Tabs of other spaces keep their places.
  // A split view counts as one row and moves as one.
  move(id: string, toIndex: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const groupId = groupOf(entry.tab);
    const group = this.shown.filter(
      (other) => groupOf(this.entries.get(other)!.tab) === groupId,
    );
    // The group's rows, as the sidebar shows them.
    const rows: string[][] = [];
    for (const tabId of group) {
      const splitId = this.entries.get(tabId)!.tab.splitGroupId;
      const last = rows.at(-1);
      if (
        splitId &&
        last &&
        this.entries.get(last[0])!.tab.splitGroupId === splitId
      )
        last.push(tabId);
      else rows.push([tabId]);
    }
    const from = rows.findIndex((row) => row.includes(id));
    const to = Math.max(0, Math.min(toIndex, rows.length - 1));
    if (from === to) return;
    const slots = group.map((other) => this.order.indexOf(other));
    const [row] = rows.splice(from, 1);
    rows.splice(to, 0, row);
    const flat = rows.flat();
    slots.forEach((slot, i) => (this.order[slot] = flat[i]));
    this.renumber();
    this.emitTabs();
  }

  // Drops a tab into the pinned tabs or the everyday tabs at `toIndex`
  // (dragging it across the divider pins or unpins it).
  place(id: string, pinned: boolean, toIndex: number) {
    const tab = this.entries.get(id)?.tab;
    if (!tab || tab.basecamp) return;
    if (tab.pinned !== pinned) {
      // Only single tabs can be pinned: a split view comes apart.
      if (pinned) this.unsplit(id);
      tab.pinned = pinned;
      tab.homeUrl = pinned ? tab.url : undefined;
      this.order.splice(this.order.indexOf(id), 1);
      this.order.splice(
        pinned ? this.groupEnd(PINNED) : this.groupStart(EVERYDAY),
        0,
        id,
      );
      this.renumber();
    }
    this.move(id, toIndex);
    this.emitTabs();
  }

  reopenClosed() {
    const url = this.recentlyClosed.pop();
    if (url) this.create(url);
  }

  // Moves to the next (1) or previous (-1) tab, wrapping around.
  cycle(step: 1 | -1) {
    const shown = this.shown;
    if (!this.activeId || shown.length < 2) return;
    const index = shown.indexOf(this.activeId);
    const next = (index + step + shown.length) % shown.length;
    this.activate(shown[next]);
  }

  // The active space's tab ids from most to least recently used, for
  // Ctrl+Tab.
  recentIds(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.tab.spaceId === this.spaceId)
      .sort((a, b) => b.tab.lastActiveAt - a.tab.lastActiveAt)
      .map((e) => e.tab.id);
  }

  focusActive() {
    this.active?.page.focus();
  }

  activateIndex(index: number) {
    const shown = this.shown;
    const id = index < 0 ? shown.at(-1) : shown[index];
    if (id) this.activate(id);
  }

  // --- The active tab ------------------------------------------------------

  navigate(input: string) {
    const url = toNavigableUrl(input);
    if (!url) return;
    const entry = this.active;
    if (!entry) {
      this.create(url);
      return;
    }
    entry.tab.url = url;
    entry.loaded = true;
    entry.savedHistory = undefined;
    entry.page.show();
    entry.page.load(url);
    entry.page.focus();
    this.emitTabs();
  }

  // The tab a page belongs to (null if none), and whether it's on screen.
  idOfPage(page: Page): string | null {
    for (const [id, entry] of this.entries) if (entry.page === page) return id;
    return null;
  }

  isOnScreen(id: string) {
    return this.onScreen.includes(id);
  }

  // A tab's page (for its right-click menu's Back, Forward and Reload).
  pageOf(id: string): Page | undefined {
    return this.entries.get(id)?.page;
  }

  command(command: NavCommand) {
    const page = this.active?.page;
    if (!page) return;
    if (command === 'back') page.back();
    if (command === 'forward') page.forward();
    if (command === 'reload') page.reload();
    if (command === 'stop') page.stop();
  }

  hardReload() {
    this.active?.page.reload(true);
  }

  toggleDevTools() {
    this.active?.page.toggleDevTools();
  }

  // --- Find in page -----------------------------------------------------------

  // Searches the current tab (see Page.find).
  find(text: string, forward: boolean, newSearch: boolean) {
    const entry = this.active;
    if (!entry) return;
    if (this.findId && this.findId !== entry.tab.id) this.stopFind();
    this.findId = entry.tab.id;
    entry.page.find(text, { forward, newSearch });
    if (!text) this.options.onFindResult({ active: 0, total: 0 });
  }

  stopFind() {
    if (this.findId) this.entries.get(this.findId)?.page.stopFind();
    this.findId = null;
  }

  // --- Zoom ------------------------------------------------------------------

  // Zooms the current tab's site in (1), out (-1) or back to 100% (0). Every
  // tab on that site follows, and the site keeps its zoom next time.
  zoom(step: 1 | -1 | 0, id = this.activeId) {
    const entry = id ? this.entries.get(id) : undefined;
    const host = entry ? safeHost(entry.tab.url) : '';
    if (!entry || !host) return;
    const zoom = step === 0 ? 1 : nextZoom(this.zoomOf(entry.tab.url), step);
    if (zoom === 1) this.siteZoom.delete(host);
    else this.siteZoom.set(host, zoom);
    for (const other of this.entries.values())
      if (safeHost(other.tab.url) === host) other.page.setZoom(zoom);
    this.options.onSiteZoomChanged();
    this.emitNav();
  }

  private zoomOf(url: string) {
    return this.siteZoom.get(safeHost(url)) ?? 1;
  }

  get siteZooms(): Record<string, number> {
    return Object.fromEntries(this.siteZoom);
  }

  restoreSiteZoom(saved: unknown) {
    if (!saved || typeof saved !== 'object') return;
    for (const [host, zoom] of Object.entries(saved))
      if (typeof zoom === 'number' && zoom >= 0.25 && zoom <= 5 && zoom !== 1)
        this.siteZoom.set(host, zoom);
  }

  // Where a tab's page sits in the window right now (its side, in split
  // view).
  boundsOf(id: string) {
    const area = this.options.pageBounds();
    const split = this.splitOf(id);
    if (!split) return area;
    return splitRects(area, split.sizes)[split.tabIds.indexOf(id)] ?? area;
  }

  // --- Layout ---------------------------------------------------------------

  layout() {
    // (A glide is asked for just before the layout it's for.)
    const glide = this.glideNext;
    this.glideNext = false;
    const entry = this.active;
    if (!entry) return;
    const split = this.splitOf(entry.tab.id);
    if (this.fullscreen) {
      // A fullscreen video fills the window; a split's other side waits.
      const { width, height } = this.engine.windowSize();
      this.stopGlides();
      entry.page.place({ x: 0, y: 0, width, height }, 0);
      for (const id of this.onScreen)
        if (id !== entry.tab.id) this.entries.get(id)?.page.hide();
      entry.page.show();
      return;
    }
    const area = this.options.pageBounds();
    const drop = this.dropPreview;
    if (drop) {
      // A tab is dragged over the page: what stays moves to the other
      // half (on a split view, the side being replaced steps away).
      const half = splitRects(area, [0.5, 0.5]);
      const stays = split
        ? split.tabIds[drop.side === 'left' ? 1 : 0]
        : entry.tab.id;
      for (const id of this.onScreen) {
        const page = this.entries.get(id)?.page;
        if (!page) continue;
        if (id !== stays) page.hide();
        else {
          this.put(id, page, half[drop.side === 'left' ? 1 : 0], glide);
          page.show();
        }
      }
      return;
    }
    const swapped = !!split && this.swapPreview === split.id;
    const ids = split
      ? swapped
        ? [split.tabIds[1], split.tabIds[0]]
        : split.tabIds
      : [entry.tab.id];
    const rects = split
      ? splitRects(
          area,
          swapped ? [split.sizes[1], split.sizes[0]] : split.sizes,
        )
      : [area];
    ids.forEach((id, i) => {
      const page = this.entries.get(id)?.page;
      if (!page) return;
      this.put(id, page, rects[i], glide);
      page.show();
    });
  }

  // --- Gliding pages ---------------------------------------------------------
  // When a tab dragged over the page makes room for itself (or the drag
  // goes back to the sidebar), the page glides to its new place instead of
  // jumping there: 200ms, easing out, like the rest of Firn.

  private glideNext = false;
  // Where each page was last put (what a glide starts from).
  private placed = new Map<string, PageBounds>();
  private glides = new Map<
    string,
    { page: Page; from: PageBounds; to: PageBounds; start: number }
  >();
  private glideTimer: ReturnType<typeof setInterval> | undefined;

  // Puts a page at `to`, gliding there from where it was if `glide`. A
  // page already gliding to `to` carries on; any other layout puts it
  // there at once (so a resize mid-glide isn't fought).
  private put(id: string, page: Page, to: PageBounds, glide: boolean) {
    const moving = this.glides.get(id);
    if (moving && sameBounds(moving.to, to)) return;
    const from = moving ? currentBounds(moving) : this.placed.get(id);
    this.placed.set(id, to);
    if (moving) this.endGlide(id);
    if (!glide || !from || sameBounds(from, to)) {
      page.place(to, this.options.pageRadius);
      return;
    }
    // The site keeps the larger of the two sizes while it glides (what
    // doesn't fit is hidden), rather than re-fitting on every step.
    page.holdLayout({
      width: Math.max(from.width, to.width),
      height: Math.max(from.height, to.height),
    });
    this.glides.set(id, { page, from, to, start: Date.now() });
    page.place(from, this.options.pageRadius);
    this.glideTimer ??= setInterval(() => this.stepGlides(), 8);
  }

  private stepGlides() {
    for (const [id, glide] of this.glides) {
      // (Its tab closed, or its page was replaced, mid-glide.)
      if (this.entries.get(id)?.page !== glide.page) {
        this.glides.delete(id);
        continue;
      }
      glide.page.place(currentBounds(glide), this.options.pageRadius);
      if (Date.now() - glide.start >= GLIDE_MS) this.endGlide(id);
    }
    if (!this.glides.size) {
      clearInterval(this.glideTimer);
      this.glideTimer = undefined;
    }
  }

  private endGlide(id: string) {
    const glide = this.glides.get(id);
    if (!glide) return;
    this.glides.delete(id);
    glide.page.place(glide.to, this.options.pageRadius);
    glide.page.holdLayout(null);
  }

  private stopGlides() {
    for (const id of this.glides.keys()) this.endGlide(id);
  }

  // Where the page would sit with its top edge at `top`.
  pageBoundsFor(top: number) {
    return this.options.pageBounds(top);
  }

  // Holds the layout of the pages on screen at a fixed size while their box
  // changes (null lets them fit their box again). `size` is the whole page
  // area's; each side of a split view gets its share. See glidePageTop in
  // src/main.ts.
  private heldPages: Page[] = [];

  holdLayout(size: { width: number; height: number } | null) {
    for (const page of this.heldPages) page.holdLayout(null);
    this.heldPages = [];
    const entry = this.active;
    if (!size || !entry || this.fullscreen) return;
    const split = this.splitOf(entry.tab.id);
    const area = { x: 0, y: 0, ...size };
    const ids = split ? split.tabIds : [entry.tab.id];
    const rects = split ? splitRects(area, split.sizes) : [area];
    ids.forEach((id, i) => {
      const page = this.entries.get(id)?.page;
      if (!page) return;
      page.holdLayout({ width: rects[i].width, height: rects[i].height });
      this.heldPages.push(page);
    });
  }

  destroy() {
    clearInterval(this.glideTimer);
    this.glides.clear();
    for (const { page } of this.entries.values()) page.destroy();
    this.entries.clear();
    this.order = [];
  }

  // --- Internals ------------------------------------------------------------

  private renumber() {
    this.order.forEach((id, i) => (this.entries.get(id)!.tab.order = i));
  }

  // Pages report many small changes at once while loading (title, icon,
  // address, loading...). They're gathered into one update for the UI.
  private tabsPending = false;

  private emitTabs() {
    if (this.tabsPending) return;
    this.tabsPending = true;
    setImmediate(() => {
      this.tabsPending = false;
      if (!this.engine.closed) this.options.onTabsChanged(this.state());
    });
  }

  private navPending = false;

  private emitNav() {
    if (this.navPending) return;
    this.navPending = true;
    setImmediate(() => {
      this.navPending = false;
      if (!this.engine.closed) this.options.onNavChanged(this.navState());
    });
  }

  // A fresh, empty page for a tab, kept in step with the tab's record.
  private makePage(id: string): Page {
    let page: Page | null = null;
    page = this.engine.createPage(this.eventsFor(id, () => page));
    return page;
  }

  // Keeps a tab's record in step with its page.
  private eventsFor(id: string, pageOf: () => Page | null): PageEvents {
    const entryOf = () => {
      const entry = this.entries.get(id);
      return entry && entry.page === pageOf() ? entry : undefined;
    };
    // The last page recorded in the history for this tab.
    let visited = { url: '', title: '' };
    let lastZoomAt = 0;
    return {
      onUpdate: () => {
        const entry = entryOf();
        if (!entry) return;
        const { url, title } = entry.page;
        if (url && url !== visited.url) this.options.onPageNavigated(id);
        if (url && (url !== visited.url || title !== visited.title)) {
          this.options.onVisit(
            url,
            title,
            entry.tab.favicon,
            url !== visited.url,
          );
          visited = { url, title };
        }
        if (url) entry.tab.url = url;
        entry.tab.title = title;
        // Sound starting (again) ends a pause from the mini player.
        const audible = entry.page.audible;
        if (audible && !entry.wasAudible) {
          entry.audibleSince = Date.now();
          if (entry.paused === 'media') entry.paused = undefined;
        }
        entry.wasAudible = audible;
        // A page arriving on a site takes that site's zoom.
        const zoom = this.zoomOf(entry.tab.url);
        if (url && Math.abs(entry.page.zoom - zoom) > 0.001)
          entry.page.setZoom(zoom);
        this.emitTabs();
        if (id === this.activeId) this.emitNav();
      },
      onFavicon: (url) => {
        const entry = entryOf();
        if (!entry) return;
        entry.tab.favicon = url;
        if (visited.url) this.options.onVisit(visited.url, '', url, false);
        this.emitTabs();
      },
      // A new site gets a fresh favicon instead of keeping the old one.
      onNavigationStart: (url) => {
        const entry = entryOf();
        if (entry && safeHost(url) !== safeHost(entry.tab.url))
          entry.tab.favicon = '';
        // A new page has nothing paused (a muted tab stays muted).
        if (entry?.paused === 'media') entry.paused = undefined;
      },
      // Links that ask for a new tab open one right below this tab. From a
      // Basecamp or pinned tab, a link to another site opens in Lookout
      // instead, so the pinned tab stays put and no stray tabs pile up
      // (middle- or Ctrl+click still opens a background tab).
      onOpenTab: (url, background) => {
        const tab = entryOf()?.tab;
        if (
          tab &&
          !background &&
          (tab.basecamp || tab.pinned) &&
          siteOf(url) !== siteOf(tab.url)
        )
          return this.options.onLookout(url);
        void this.create(url, { after: id, activate: !background });
      },
      onLookout: (url) => this.options.onLookout(url),
      onFocus: () => {
        if (entryOf()) this.focused(id);
      },
      onFullscreen: (on) => this.setFullscreen(on),
      onLogin: (origin, username, password) => {
        if (entryOf()) this.options.onLogin(id, origin, username, password);
      },
      onContextMenu: (menu) => {
        if (entryOf()) this.options.onContextMenu(id, menu);
      },
      onFindResult: (result) => {
        if (entryOf() && id === this.findId) this.options.onFindResult(result);
      },
      // One step at a time: a wheel notch can be reported twice, and a
      // touchpad sends a stream of tiny scrolls.
      onZoomRequest: (direction) => {
        const now = Date.now();
        if (!entryOf() || now - lastZoomAt < ZOOM_STEP_MS) return;
        lastZoomAt = now;
        this.zoom(direction === 'in' ? 1 : -1, id);
      },
    };
  }

  // Turns a page that's already open (one previewed in Lookout) into a new
  // tab at the top of the everyday tabs, keeping everything on it.
  adopt(page: Page, favicon = '') {
    const id = randomUUID();
    const tab: Tab = {
      id,
      spaceId: this.spaceId,
      url: page.url,
      title: page.title,
      favicon,
      pinned: false,
      order: 0,
      lastActiveAt: Date.now(),
    };
    page.listen(this.eventsFor(id, () => page));
    this.entries.set(id, { tab, page, loaded: true });
    this.order.splice(this.groupStart(EVERYDAY), 0, id);
    this.renumber();
    this.activate(id);
    return id;
  }

  // Remember whether the window was already fullscreen before the page asked,
  // so leaving video fullscreen puts things back exactly as they were.
  private wasWindowFullscreen = false;

  // A page (e.g. a video) is filling the window.
  get isFullscreen() {
    return this.fullscreen;
  }

  private setFullscreen(on: boolean) {
    this.fullscreen = on;
    this.options.onFullscreenChange(on);
    if (on) {
      this.wasWindowFullscreen = this.engine.isWindowFullscreen();
      if (!this.wasWindowFullscreen) this.engine.setWindowFullscreen(true);
    } else if (!this.wasWindowFullscreen) {
      this.engine.setWindowFullscreen(false);
    }
    this.layout();
  }
}

// The site a page belongs to: its domain without subdomains (mail.google.com
// and accounts.google.com are both google.com; bbc.co.uk keeps its three
// parts). Good enough to tell "a link to another site" apart.
export function siteOf(url: string) {
  const host = safeHost(url).replace(/:\d+$/, '').toLowerCase();
  if (!host || /^[\d.]+$/.test(host) || host.startsWith('[')) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const [second, top] = labels.slice(-2);
  const keep = top.length === 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
