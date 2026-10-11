import { useEffect, useMemo, useRef, useState } from 'react';
import { isSearch, SEARCH_ENGINES, toNavigableUrl } from '../url';
import type {
  ArchivedTab,
  CarryTab,
  CommandAction,
  FindResult,
  SplitHandleState,
  HistoryEntry,
  OverlayState,
  Rect,
  Space,
  SavedLogin,
  Settings,
  SettingsState,
  SpacesState,
  TabView,
} from '../types';
import { TabIcon, tabTitle } from './TabList';
import { Welcome } from './Welcome';
import {
  ActionIcon,
  AppIcon,
  ArrowIcon,
  BellIcon,
  ChevronIcon,
  CameraIcon,
  ClipboardIcon,
  CopyIcon,
  EyeIcon,
  GripIcon,
  KeyIcon,
  CloseIcon,
  DownIcon,
  ExpandIcon,
  GlobeIcon,
  HistoryIcon,
  MicIcon,
  PinIcon,
  SearchIcon,
  ShieldIcon,
  UpIcon,
} from './icons';
import { ShortcutsPanel } from './Shortcuts';
import { WhatsNewPanel } from './WhatsNew';

// The layer that floats above the web page: the command bar (new tab), the
// Ctrl+Tab switcher and Lookout's backdrop and buttons. It's transparent
// unless one of them is open.
export function Floating() {
  const [overlay, setOverlay] = useState<OverlayState>({ mode: 'hidden' });
  const [tabs, setTabs] = useState<TabView[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<SpacesState>({
    spaces: [],
    activeSpaceId: '',
  });
  const [settings, setSettings] = useState<SettingsState | null>(null);

  useEffect(() => {
    const offs = [
      window.firn.onOverlayState(setOverlay),
      window.firn.onTabsState((state) => {
        setTabs(state.tabs);
        setActiveTabId(state.activeTabId);
      }),
      window.firn.onSpacesState(setSpaces),
      window.firn.onSettingsState(setSettings),
    ];
    window.firn.ready();
    return () => offs.forEach((off) => off());
  }, []);

  if (overlay.mode === 'permission') {
    return <PermissionPrompt key={overlay.openId} {...overlay} />;
  }
  if (overlay.mode === 'password') {
    return <SavePasswordPrompt key={overlay.openId} {...overlay} />;
  }
  if (overlay.mode === 'welcome') {
    return (
      <Welcome
        key={overlay.openId}
        settings={settings?.settings ?? null}
        defaultBrowser={settings?.defaultBrowser ?? 'unavailable'}
        spaces={spaces}
      />
    );
  }
  if (overlay.mode === 'danger') {
    return <DangerWarning key={overlay.openId} {...overlay} />;
  }
  if (overlay.mode === 'passwords') {
    return <PasswordsPanel key={overlay.openId} />;
  }
  if (overlay.mode === 'settings') {
    return <SettingsPanel key={overlay.openId} state={settings} />;
  }
  if (overlay.mode === 'history') {
    return <HistoryPanel key={overlay.openId} />;
  }
  if (overlay.mode === 'whats-new') {
    return (
      <WhatsNewPanel
        key={overlay.openId}
        version={settings?.version ?? ''}
        since={overlay.since}
      />
    );
  }
  if (overlay.mode === 'shortcuts') {
    return <ShortcutsPanel key={overlay.openId} />;
  }
  if (overlay.mode === 'archive') {
    return <ArchivePanel key={overlay.openId} spaces={spaces} />;
  }
  if (overlay.mode === 'find') {
    return <FindBar key={overlay.openId} initialText={overlay.text} />;
  }
  if (overlay.mode === 'lookout') {
    return <Lookout key={overlay.openId} {...overlay} />;
  }
  if (overlay.mode === 'command') {
    return (
      <CommandBar
        key={overlay.openId}
        tabs={tabs}
        activeTabId={activeTabId}
        spaces={spaces}
        beside={overlay.beside}
      />
    );
  }
  if (overlay.mode === 'switcher' && overlay.revealed) {
    return (
      <Switcher tabIds={overlay.tabIds} index={overlay.index} tabs={tabs} />
    );
  }
  return (
    <>
      <CarriedTab tabs={tabs} />
      <SplitHandle spaces={spaces} />
    </>
  );
}

// --- A split view's handle ------------------------------------------------------
// A soft pill at the top middle of one side of a split view, while the
// mouse is near (src/main.ts decides where, and when). Its grip drags that
// side over the other to swap them; its × takes that side out of the split
// (the tab stays, as an ordinary tab). The layer is just the pill's size.

function SplitHandle({ spaces }: { spaces: SpacesState }) {
  const [state, setState] = useState<SplitHandleState>({ kind: 'hide' });
  // The last side it showed for, kept while it fades.
  const [tabId, setTabId] = useState<string | null>(null);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useEffect(
    () =>
      window.firn.onSplitHandleState((next) => {
        setState(next);
        if (next.kind === 'show') setTabId(next.tabId);
      }),
    [],
  );
  // In the space's color, like the sidebar.
  const color = spaces.spaces.find((s) => s.id === spaces.activeSpaceId)?.color;
  useEffect(() => {
    const rgb = color && /^#?([0-9a-f]{6})$/i.exec(color)?.[1];
    if (!rgb) return;
    const n = parseInt(rgb, 16);
    document.documentElement.style.setProperty(
      '--space-rgb',
      `${n >> 16} ${(n >> 8) & 255} ${n & 255}`,
    );
  }, [color]);
  if (!tabId) return null;
  return (
    <div
      className={`split-handle ${state.kind === 'hide' ? '' : 'is-shown'} ${state.kind === 'drag' ? 'is-dragging' : ''}`}
      data-testid="split-handle"
    >
      <button
        className="split-handle-grip"
        aria-label="Drag to swap sides"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          press.current = { x: e.screenX, y: e.screenY, moved: false };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p) return;
          if (!p.moved && Math.hypot(e.screenX - p.x, e.screenY - p.y) < 3)
            return;
          p.moved = true;
          window.firn.dragSplitHandle(e.screenX, e.screenY);
        }}
        onPointerUp={() => {
          if (press.current?.moved) window.firn.dropSplitHandle();
          press.current = null;
        }}
        onPointerCancel={() => {
          if (press.current?.moved) window.firn.dropSplitHandle();
          press.current = null;
        }}
      >
        <GripIcon />
      </button>
      <span className="split-handle-line" />
      <button
        className="split-handle-close"
        aria-label="Take out of split view"
        onClick={() => window.firn.takeOutOfSplit(tabId)}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// --- A carried tab ------------------------------------------------------------
// A tab pulled out of the sidebar stays under the pointer, in front of the
// page, until it's let go (src/main.ts, 'tabs:carry'). It glides from where
// it was picked up to the pointer, then follows it exactly; let go, it
// fades.

function CarriedTab({ tabs }: { tabs: TabView[] }) {
  const [carry, setCarry] = useState<CarryTab | null>(null);
  // The last one, kept while it fades.
  const [last, setLast] = useState<CarryTab | null>(null);
  // Just picked up: it's drawn where it was, then glides to the pointer.
  const [phase, setPhase] = useState<'from' | 'gliding' | 'held'>('held');
  const carrying = useRef(false);
  useEffect(
    () =>
      window.firn.onCarryState((next) => {
        if (next && !carrying.current) setPhase('from');
        carrying.current = !!next;
        setCarry(next);
        if (next) setLast(next);
      }),
    [],
  );
  useEffect(() => {
    if (phase === 'from') {
      const frame = requestAnimationFrame(() => setPhase('gliding'));
      return () => cancelAnimationFrame(frame);
    }
    if (phase === 'gliding') {
      const timer = setTimeout(() => setPhase('held'), 140);
      return () => clearTimeout(timer);
    }
  }, [phase]);
  const shown = carry ?? last;
  const tab = shown && tabs.find((t) => t.id === shown.tabId);
  if (!shown || !tab) return null;
  const x = phase === 'from' ? shown.fromX : shown.x - shown.grabX;
  const y = phase === 'from' ? shown.fromY : shown.y - shown.grabY;
  return (
    <div
      className={`carried-tab ${phase === 'gliding' ? 'is-gliding' : ''} ${carry ? '' : 'is-let-go'}`}
      style={{ width: shown.width, transform: `translate(${x}px, ${y}px)` }}
      onTransitionEnd={() => !carry && setLast(null)}
    >
      <span className="tab-icon">
        <TabIcon tab={tab} />
      </span>
      <span className="tab-title">{tabTitle(tab)}</span>
    </div>
  );
}

const byRecent = (a: TabView, b: TabView) => b.lastActiveAt - a.lastActiveAt;

// --- Command bar ------------------------------------------------------------
// Type an address or a search, or find an open tab (in any space), a page
// from the history, or a quick action. Results are kept short and calm:
// a few of each kind, best first.

type AnyTab = TabView & { spaceId: string };

interface Action {
  action: CommandAction;
  label: string;
  words: string; // extra words it answers to
  arg?: string;
}

type Result =
  | { kind: 'go'; input: string; search: boolean }
  | { kind: 'tab'; tab: AnyTab }
  | { kind: 'history'; entry: HistoryEntry }
  | { kind: 'action'; action: Action };

const resultKey = (r: Result) =>
  r.kind === 'tab'
    ? `tab:${r.tab.id}`
    : r.kind === 'history'
      ? `history:${r.entry.url}`
      : r.kind === 'action'
        ? `action:${r.action.action}:${r.action.arg ?? ''}`
        : 'go';

// Every word typed appears somewhere in `text`.
const matches = (text: string, words: string[]) => {
  const haystack = text.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

// Every word typed starts one of the words in `text`.
const startsWords = (text: string, words: string[]) => {
  const own = text.toLowerCase().split(/\s+/);
  return words.every((word) => own.some((w) => w.startsWith(word)));
};

// The quick actions that make sense right now.
function actionsFor(
  active: TabView | undefined,
  spaces: SpacesState,
): Action[] {
  const actions: Action[] = [];
  if (active && !active.basecamp)
    actions.push({
      action: 'pin',
      label: active.pinned ? 'Unpin tab' : 'Pin tab',
      words: 'pin unpin',
    });
  if (active)
    actions.push(
      { action: 'find', label: 'Find in page', words: 'find search page text' },
      { action: 'zoom-in', label: 'Zoom in', words: 'zoom in bigger larger' },
      { action: 'zoom-out', label: 'Zoom out', words: 'zoom out smaller' },
      {
        action: 'zoom-reset',
        label: 'Reset zoom',
        words: 'zoom reset actual size',
      },
      {
        action: 'basecamp',
        label: active.basecamp ? 'Remove from Basecamp' : 'Add to Basecamp',
        words: 'basecamp favorite',
      },
      {
        action: 'copy-link',
        label: 'Copy link',
        words: 'copy link url address',
      },
      { action: 'close', label: 'Close tab', words: 'close tab' },
    );
  if (active?.splitId)
    actions.push({
      action: 'separate',
      label: 'Separate split view',
      words: 'split separate unsplit',
    });
  actions.push(
    {
      action: 'reopen',
      label: 'Reopen closed tab',
      words: 'reopen undo closed',
    },
    {
      action: 'sidebar',
      label: 'Hide or show sidebar',
      words: 'sidebar hide show collapse',
    },
    {
      action: 'clear',
      label: 'Clear unpinned tabs',
      words: 'clear tabs close all',
    },
    { action: 'new-space', label: 'New space', words: 'new space add create' },
    { action: 'history', label: 'History', words: 'history visited pages' },
    {
      action: 'passwords',
      label: 'Saved passwords',
      words: 'passwords saved logins',
    },
    {
      action: 'settings',
      label: 'Settings',
      words: 'settings preferences options search engine theme',
    },
    {
      action: 'downloads',
      label: 'Open downloads folder',
      words: 'downloads folder files',
    },
    {
      action: 'welcome',
      label: 'Welcome to Firn (setup)',
      words: 'welcome setup start tour onboarding',
    },
    {
      action: 'whats-new',
      label: "What's new in Firn",
      words: 'whats new release notes update changes version',
    },
    {
      action: 'shortcuts',
      label: 'Keyboard shortcuts',
      words: 'keyboard shortcuts keys hotkeys',
    },
    {
      action: 'archive',
      label: 'Archived tabs',
      words: 'archive archived old tabs tidied closed',
    },
  );
  for (const space of spaces.spaces)
    if (space.id !== spaces.activeSpaceId)
      actions.push({
        action: 'switch-space',
        label: `Go to ${space.name}`,
        words: `switch space go ${space.name}`,
        arg: space.id,
      });
  return actions;
}

function buildResults({
  query,
  shownTabs,
  allTabs,
  history,
  actions,
}: {
  query: string;
  shownTabs: TabView[];
  allTabs: AnyTab[];
  history: HistoryEntry[];
  actions: Action[];
}): Result[] {
  const q = query.trim();
  if (!q)
    return [...shownTabs]
      .sort(byRecent)
      .slice(0, 6)
      .map((tab) => ({ kind: 'tab', tab: tab as AnyTab }));

  const url = toNavigableUrl(q);
  const go: Result[] = url
    ? [{ kind: 'go', input: q, search: isSearch(url) }]
    : [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const tabs = allTabs
    .filter((t) => matches(`${t.title} ${t.url}`, words))
    .sort(byRecent)
    .slice(0, 4);
  // Pages that are already open show once, as their tab.
  const open = new Set(allTabs.map((t) => t.url));
  const pages = history.filter((h) => !open.has(h.url)).slice(0, 4);
  // Actions answer to the start of a word ("pi" → Pin tab), from two
  // letters on, so a single letter doesn't bring up a list of them.
  const doable =
    q.length < 2
      ? []
      : actions
          .filter((a) => startsWords(`${a.label} ${a.words}`, words))
          .slice(0, 3);
  return [
    ...go,
    ...tabs.map((tab): Result => ({ kind: 'tab', tab })),
    ...doable.map((action): Result => ({ kind: 'action', action })),
    ...pages.map((entry): Result => ({ kind: 'history', entry })),
  ];
}

function runResult(result: Result) {
  if (result.kind === 'go') window.firn.openUrl(result.input);
  else if (result.kind === 'tab') window.firn.activateTab(result.tab.id);
  else if (result.kind === 'history') window.firn.openUrl(result.entry.url);
  else window.firn.runAction(result.action.action, result.action.arg);
}

const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '');

function CommandBar({
  tabs,
  activeTabId,
  spaces,
  beside,
}: {
  tabs: TabView[];
  activeTabId: string | null;
  spaces: SpacesState;
  beside?: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [allTabs, setAllTabs] = useState<AnyTab[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    window.firn.allTabs().then(setAllTabs);
  }, []);

  // History matches arrive a moment after typing; the newest query wins.
  useEffect(() => {
    let current = true;
    const q = query.trim();
    if (!q) setHistory([]);
    else window.firn.searchHistory(q).then((h) => current && setHistory(h));
    return () => {
      current = false;
    };
  }, [query]);

  const active = tabs.find((t) => t.id === activeTabId);
  const results = useMemo(
    () =>
      buildResults({
        query,
        shownTabs: tabs,
        allTabs,
        history,
        // Opening something beside a tab: actions don't apply.
        actions: beside ? [] : actionsFor(active, spaces),
      }),
    [query, tabs, allTabs, history, beside, active, spaces],
  );
  const current = Math.min(selected, results.length - 1);
  const spaceOf = (id: string) => spaces.spaces.find((s) => s.id === id);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.firn.closeOverlay();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const count = results.length;
      if (count) setSelected((current + step + count) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[current]) runResult(results[current]);
    }
  };

  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) window.firn.closeOverlay();
      }}
    >
      <div className="panel command-bar">
        <div className="command-input-row">
          <span className="command-search-icon">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="command-input"
            data-testid="command-input"
            spellCheck={false}
            placeholder={
              beside
                ? `Open beside “${beside.length > 32 ? `${beside.slice(0, 30)}…` : beside}”`
                : 'Search, enter an address, or type a command'
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>

        {results.length > 0 && (
          <ul className="results">
            {results.map((result, i) => (
              <li
                key={resultKey(result)}
                className={`result is-${result.kind} ${i === current ? 'is-selected' : ''}`}
                data-testid="command-result"
                onMouseMove={() => setSelected(i)}
                onClick={() => runResult(result)}
              >
                <ResultRow
                  result={result}
                  spaceOf={spaceOf}
                  activeSpaceId={spaces.activeSpaceId}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResultRow({
  result,
  spaceOf,
  activeSpaceId,
}: {
  result: Result;
  spaceOf: (id: string) => Space | undefined;
  activeSpaceId: string;
}) {
  if (result.kind === 'go')
    return (
      <>
        <span className="tab-icon">
          {result.search ? <SearchIcon /> : <GlobeIcon />}
        </span>
        <span className="result-title">
          {result.input}
          {result.search && <span className="result-detail"> — Search</span>}
        </span>
      </>
    );
  if (result.kind === 'tab') {
    const { tab } = result;
    // Tabs in another space say which.
    const space =
      !tab.basecamp && tab.spaceId !== activeSpaceId
        ? spaceOf(tab.spaceId)
        : undefined;
    return (
      <>
        <span className="tab-icon">
          <TabIcon tab={tab} />
        </span>
        <span className="result-title">
          {tabTitle(tab)}
          <span className="result-detail"> — {shortUrl(tab.url)}</span>
        </span>
        <span className="result-action">
          {space ? `In ${space.name}` : 'Switch to tab'}
          <ArrowIcon />
        </span>
      </>
    );
  }
  if (result.kind === 'history') {
    const { entry } = result;
    return (
      <>
        <span className="tab-icon">
          <HistoryIcon />
        </span>
        <span className="result-title">
          {entry.title || shortUrl(entry.url)}
          <span className="result-detail"> — {shortUrl(entry.url)}</span>
        </span>
        <span className="result-action">
          Visited <ArrowIcon />
        </span>
      </>
    );
  }
  return (
    <>
      <span className="tab-icon">
        <ActionIcon />
      </span>
      <span className="result-title">{result.action.label}</span>
      <span className="result-action">Action</span>
    </>
  );
}

// --- Ctrl+Tab switcher ------------------------------------------------------

function Switcher({
  tabIds,
  index,
  tabs,
}: {
  tabIds: string[];
  index: number;
  tabs: TabView[];
}) {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const list = tabIds.map((id) => byId.get(id)).filter((t) => t !== undefined);

  return (
    <div className="backdrop is-switcher">
      <div className="panel switcher">
        <ul className="results">
          {list.map((tab) => (
            <li
              key={tab.id}
              className={`result ${tab.id === tabIds[index] ? 'is-selected' : ''}`}
              onClick={() => window.firn.activateTab(tab.id)}
            >
              <span className="tab-icon">
                <TabIcon tab={tab} />
              </span>
              <span className="result-title">{tabTitle(tab)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- Lookout -----------------------------------------------------------------

// Around a link previewed in Lookout: the page dimmed behind it, a stand-in
// panel that scales in (the real page appears on top of it once it has),
// and the buttons beside the panel. Clicking anywhere outside closes it.
function Lookout({
  phase,
  area,
  panel,
}: {
  phase: 'open' | 'closing' | 'expanding';
  area: Rect;
  panel: Rect;
}) {
  const box = (r: Rect) => ({
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
  });
  return (
    <div
      className={`lookout is-${phase}`}
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.lookout-actions'))
          window.firn.closeOverlay();
      }}
    >
      <div className="lookout-backdrop" style={box(area)} />
      <div className="lookout-panel" style={box(panel)} />
      <div
        className="lookout-actions"
        style={{ left: panel.x + panel.width + 10, top: panel.y }}
      >
        <button
          className="lookout-button"
          data-testid="lookout-close"
          title="Close (Esc)"
          onClick={() => window.firn.closeOverlay()}
        >
          <CloseIcon />
        </button>
        <button
          className="lookout-button"
          data-testid="lookout-open-tab"
          title="Open as tab"
          onClick={() => window.firn.expandLookout()}
        >
          <ExpandIcon />
        </button>
      </div>
    </div>
  );
}

// Find in page: a small bar in the page's top-right corner. Enter goes to
// the next match, Shift+Enter to the previous one, Esc closes it. The
// layer is only as big as the bar, so the page stays usable around it.
function FindBar({ initialText }: { initialText: string }) {
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<FindResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = window.firn.onFindResult(setResult);
    const input = inputRef.current;
    input?.focus();
    input?.select();
    // Opening again with the last search shows its matches right away.
    if (initialText) window.firn.find(initialText, true, true);
    return off;
  }, [initialText]);

  const search = (value: string) => {
    setText(value);
    if (!value) setResult(null);
    window.firn.find(value, true, true);
  };
  const step = (forward: boolean) => {
    if (text) window.firn.find(text, forward, false);
    inputRef.current?.focus();
  };

  const count =
    !text || !result
      ? ''
      : result.total === 0
        ? 'No matches'
        : `${result.active} of ${result.total}`;

  return (
    <div className="find-layer">
      <div className="panel find-bar">
        <input
          ref={inputRef}
          className="find-input"
          spellCheck={false}
          placeholder="Find in page"
          value={text}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') window.firn.closeFind();
            else if (e.key === 'Enter') {
              e.preventDefault();
              step(!e.shiftKey);
            }
          }}
        />
        <span
          className={`find-count ${result?.total === 0 && text ? 'is-none' : ''}`}
        >
          {count}
        </span>
        <button
          className="icon-button"
          title="Previous match (Shift+Enter)"
          disabled={!result?.total}
          onClick={() => step(false)}
        >
          <UpIcon />
        </button>
        <button
          className="icon-button"
          title="Next match (Enter)"
          disabled={!result?.total}
          onClick={() => step(true)}
        >
          <DownIcon />
        </button>
        <button
          className="icon-button"
          title="Close (Esc)"
          onClick={() => window.firn.closeFind()}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

const PERMISSION_ICONS: Record<string, () => React.JSX.Element> = {
  camera: CameraIcon,
  microphone: MicIcon,
  location: PinIcon,
  notifications: BellIcon,
  clipboard: ClipboardIcon,
  external: AppIcon,
};

// A site asking to use something: a small card at the top-left of its page.
// The answer is remembered for the site; Esc closes it without answering.
function PermissionPrompt({
  site,
  ask,
  kind,
}: {
  site: string;
  ask: string;
  kind: string;
}) {
  const Icon = PERMISSION_ICONS[kind] ?? ActionIcon;
  return (
    <div
      className="permission-layer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') window.firn.answerPermission('dismiss');
      }}
    >
      <div
        className="panel permission-card"
        role="dialog"
        aria-label="Permission"
      >
        <div className="permission-text">
          <span className="permission-icon">
            <Icon />
          </span>
          <p>
            <strong>{site}</strong> wants to {ask}
          </p>
        </div>
        <div className="permission-buttons">
          <button
            className="permission-button"
            onClick={() => window.firn.answerPermission('block')}
          >
            Block
          </button>
          <button
            className="permission-button is-allow"
            onClick={() => window.firn.answerPermission('allow')}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

const DANGER_WORDING = {
  SOCIAL_ENGINEERING: {
    title: 'This site may be a scam',
    text: 'It may try to trick you into giving away passwords, card numbers, or other personal details, often by looking like a site you trust.',
  },
  MALWARE: {
    title: 'This site may harm your computer',
    text: 'It may try to install harmful software that steals your information or damages your files.',
  },
  UNWANTED_SOFTWARE: {
    title: 'This site may install unwanted software',
    text: "Programs from it may change your settings, slow your computer down, or show ads you didn't ask for.",
  },
};

// A dangerous site was stopped before it loaded: this fills its page area.
// "Go back" is the easy choice; "Visit anyway" is there, but quiet.
function DangerWarning({
  site,
  threat,
}: {
  site: string;
  url: string;
  threat: keyof typeof DANGER_WORDING;
}) {
  const wording = DANGER_WORDING[threat] ?? DANGER_WORDING.MALWARE;
  return (
    <div className="danger-layer">
      <div
        className="danger-card"
        role="alertdialog"
        aria-label={wording.title}
      >
        <span className="danger-icon">
          <ShieldIcon />
        </span>
        <h1>{wording.title}</h1>
        <p>
          Firn stopped <strong>{site}</strong> from opening. {wording.text}
        </p>
        <div className="danger-buttons">
          <button
            className="danger-back"
            autoFocus
            onClick={() => window.firn.answerDanger('back')}
          >
            Go back
          </button>
          <button
            className="danger-visit"
            onClick={() => window.firn.answerDanger('visit')}
          >
            Visit anyway
          </button>
        </div>
        <span className="danger-source">Advisory provided by Google</span>
      </div>
    </div>
  );
}

// The history panel (Ctrl+H, Cmd+Y on a Mac): pages visited, newest first, grouped by day.
// Type to search; click a page to open it in a new tab; hover for ✕ to
// forget one. Esc or a click outside closes it.
function HistoryPanel() {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [version, setVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return window.firn.onHistoryChanged(() => setVersion((v) => v + 1));
  }, []);
  useEffect(() => {
    let current = true;
    window.firn
      .listHistory(query.trim())
      .then((list) => current && setEntries(list));
    return () => {
      current = false;
    };
  }, [query, version]);

  const groups = useMemo(() => groupByDay(entries), [entries]);

  return (
    <div
      className="backdrop is-sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) window.firn.closeOverlay();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') window.firn.closeOverlay();
      }}
    >
      <div
        className="panel sheet history-sheet"
        role="dialog"
        aria-label="History"
      >
        <header className="sheet-header">
          <h2>History</h2>
          <button
            className="icon-button"
            title="Close (Esc)"
            onClick={() => window.firn.closeOverlay()}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-search">
          <SearchIcon />
          <input
            ref={inputRef}
            spellCheck={false}
            placeholder="Search history"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="sheet-body">
          {groups.length === 0 && (
            <p className="sheet-empty">
              {query.trim()
                ? 'Nothing in your history matches that.'
                : 'Pages you visit will show up here.'}
            </p>
          )}
          {groups.map(({ label, items }) => (
            <section key={label} className="history-day">
              <h3>{label}</h3>
              {items.map((entry) => (
                <div
                  key={entry.url}
                  className="history-row"
                  title={entry.url}
                  onClick={() => window.firn.openUrl(entry.url)}
                >
                  <span className="tab-icon">
                    <HistoryFavicon url={entry.favicon} />
                  </span>
                  <span className="history-title">
                    {entry.title || shortUrl(entry.url)}
                  </span>
                  <span className="history-site">{siteName(entry.url)}</span>
                  <span className="history-time">
                    {new Date(entry.lastVisit).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    className="icon-button history-remove"
                    title="Remove from history"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.firn.removeHistory(entry.url);
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer className="sheet-footer">
          <span>Kept on this computer only.</span>
          <button
            className="sheet-button"
            onClick={() => window.firn.showClearHistoryMenu()}
          >
            Clear history…
          </button>
        </footer>
      </div>
    </div>
  );
}

// --- Archived tabs ------------------------------------------------------------
// Tabs tidied away for not being used (src/archive.ts), newest first, by
// the space they were in. Click one to bring it back there; × forgets it
// (it's still in History).

function ArchivePanel({ spaces }: { spaces: SpacesState }) {
  const [tabs, setTabs] = useState<ArchivedTab[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(
    () => window.firn.onArchiveChanged(() => setVersion((v) => v + 1)),
    [],
  );
  useEffect(() => {
    let current = true;
    window.firn.listArchive().then((list) => current && setTabs(list));
    return () => {
      current = false;
    };
  }, [version]);
  const close = () => window.firn.closeOverlay();
  // By space, in the sidebar's order (a space that's gone last).
  const groups = useMemo(() => {
    const order = new Map(spaces.spaces.map((s, i) => [s.id, i]));
    const bySpace = new Map<string, ArchivedTab[]>();
    for (const tab of tabs ?? []) {
      const key = order.has(tab.spaceId) ? tab.spaceId : '';
      bySpace.set(key, [...(bySpace.get(key) ?? []), tab]);
    }
    return [...bySpace.entries()]
      .sort(
        ([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
      )
      .map(([id, items]) => ({
        label: spaces.spaces.find((s) => s.id === id)?.name ?? 'Other',
        items,
      }));
  }, [tabs, spaces]);

  return (
    <div
      className="backdrop is-sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div
        className="panel sheet history-sheet"
        role="dialog"
        aria-label="Archived tabs"
        tabIndex={-1}
      >
        <header className="sheet-header">
          <h2>Archived tabs</h2>
          <button className="icon-button" title="Close (Esc)" onClick={close}>
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-body">
          {tabs && tabs.length === 0 && (
            <p className="sheet-empty">
              Tabs you haven't used for a while will be tidied away here.
            </p>
          )}
          {groups.map(({ label, items }) => (
            <section key={label} className="history-day">
              <h3>{label}</h3>
              {items.map((tab) => (
                <div
                  key={tab.id}
                  className="history-row"
                  data-testid="archived-tab"
                  title={tab.url}
                  onClick={() => window.firn.restoreArchived(tab.id)}
                >
                  <span className="tab-icon">
                    <HistoryFavicon url={tab.favicon} />
                  </span>
                  <span className="history-title">
                    {tab.title || shortUrl(tab.url)}
                  </span>
                  <span className="history-site">{siteName(tab.url)}</span>
                  <span className="history-time">
                    {archivedWhen(tab.archivedAt)}
                  </span>
                  <button
                    className="icon-button history-remove"
                    title="Remove from the archive"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.firn.removeArchived(tab.id);
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer className="sheet-footer">
          <span>Archived tabs are also in your history.</span>
          <button className="sheet-button" onClick={close} autoFocus>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

// When a tab was archived, in plain words.
function archivedWhen(time: number) {
  const days = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(time).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function HistoryFavicon({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <GlobeIcon />;
  return (
    <img
      className="tab-favicon"
      src={url}
      alt=""
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

function siteName(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// "Today", "Yesterday", a weekday for the last week, then dates.
function groupByDay(entries: HistoryEntry[]) {
  const startOf = (time: number) => {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOf(Date.now());
  const DAY = 24 * 60 * 60 * 1000;
  const labelFor = (day: number) => {
    const daysAgo = Math.round((today - day) / DAY);
    if (daysAgo === 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    const date = new Date(day);
    if (daysAgo < 7) return date.toLocaleDateString([], { weekday: 'long' });
    return date.toLocaleDateString([], {
      month: 'long',
      day: 'numeric',
      ...(date.getFullYear() !== new Date().getFullYear()
        ? { year: 'numeric' }
        : {}),
    });
  };
  const groups: { label: string; items: HistoryEntry[] }[] = [];
  let lastDay = -1;
  for (const entry of entries) {
    const day = startOf(entry.lastVisit);
    if (day !== lastDay) {
      groups.push({ label: labelFor(day), items: [] });
      lastDay = day;
    }
    groups[groups.length - 1].items.push(entry);
  }
  return groups;
}

// The settings panel (Ctrl+, or the sidebar's ⋯ menu): only the few things
// a person might want to change. Changes apply right away.
function SettingsPanel({ state }: { state: SettingsState | null }) {
  const [permissionsReset, setPermissionsReset] = useState(false);
  // Takes the keyboard once, when it opens (not on every redraw).
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => sheet.current?.focus(), []);
  const change = (changes: Partial<Settings>) =>
    window.firn.updateSettings(changes);

  return (
    <div
      className="backdrop is-sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) window.firn.closeOverlay();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') window.firn.closeOverlay();
      }}
    >
      <div
        className="panel sheet settings-sheet"
        role="dialog"
        aria-label="Settings"
        tabIndex={-1}
        ref={sheet}
      >
        <header className="sheet-header">
          <h2>Settings</h2>
          <button
            className="icon-button"
            title="Close (Esc)"
            onClick={() => window.firn.closeOverlay()}
          >
            <CloseIcon />
          </button>
        </header>
        {state && (
          <div className="sheet-body settings-body">
            {/* Only where this copy can be the default (installed on
                Windows, or in a Mac's Applications folder). */}
            {state.defaultBrowser !== 'unavailable' && (
              <section className="settings-group">
                <h3>Default browser</h3>
                <div className="settings-row">
                  <div className="settings-label">
                    <span>Open links in Firn</span>
                    <small>
                      Links from other apps, like mail and chat, open as new
                      tabs.
                    </small>
                  </div>
                  {state.defaultBrowser === 'yes' ? (
                    <span className="settings-done">
                      Firn is your default browser
                    </span>
                  ) : (
                    <button
                      className="sheet-button"
                      onClick={() => window.firn.makeDefaultBrowser()}
                    >
                      Make Firn default…
                    </button>
                  )}
                </div>
              </section>
            )}
            <section className="settings-group">
              <h3>Search</h3>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Search engine</span>
                  <small>
                    Used when you type something that isn't an address.
                  </small>
                </div>
                <Dropdown
                  label="Search engine"
                  value={state.settings.searchEngine}
                  options={Object.entries(SEARCH_ENGINES).map(([id, e]) => ({
                    value: id,
                    label: e.name,
                  }))}
                  onChange={(value) =>
                    change({ searchEngine: value as Settings['searchEngine'] })
                  }
                />
              </div>
            </section>

            <section className="settings-group">
              <h3>Appearance</h3>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Theme</span>
                </div>
                <div className="segmented" role="radiogroup">
                  {(
                    [
                      ['system', 'Match system'],
                      ['light', 'Light'],
                      ['dark', 'Dark'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={state.settings.theme === value}
                      className={state.settings.theme === value ? 'is-on' : ''}
                      onClick={() => change({ theme: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Address bar</span>
                  <small>Where the address bar sits.</small>
                </div>
                <div className="segmented" role="radiogroup">
                  {(
                    [
                      ['sidebar', 'In the sidebar'],
                      ['top', 'At the top'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={state.settings.addressBar === value}
                      className={
                        state.settings.addressBar === value ? 'is-on' : ''
                      }
                      onClick={() => change({ addressBar: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="settings-group">
              <h3>Tabs</h3>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Archive tabs you haven't used for</span>
                  <small>
                    Everyday tabs only: pinned tabs, Basecamp, and the tab
                    you're on stay. Find them again in Archived tabs.
                  </small>
                </div>
                <Dropdown
                  label="Archive tabs you haven't used for"
                  value={String(state.settings.archiveAfter)}
                  options={[
                    { value: '1', label: '1 day' },
                    { value: '7', label: '7 days' },
                    { value: '30', label: '30 days' },
                    { value: '0', label: 'Never' },
                  ]}
                  onChange={(value) =>
                    change({
                      archiveAfter: Number(value) as Settings['archiveAfter'],
                    })
                  }
                />
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Archived tabs</span>
                  <small>Bring back any tab that was tidied away.</small>
                </div>
                <button
                  className="sheet-button"
                  data-testid="show-archive"
                  onClick={() => window.firn.runAction('archive')}
                >
                  Show…
                </button>
              </div>
            </section>
            <section className="settings-group">
              <h3>Downloads</h3>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Save files to</span>
                  <small title={state.downloadsFolder}>
                    {state.downloadsFolder}
                  </small>
                </div>
                <button
                  className="sheet-button"
                  onClick={() => window.firn.chooseDownloadsFolder()}
                >
                  Change…
                </button>
              </div>
            </section>

            <section className="settings-group">
              <h3>Privacy</h3>
              <div className="settings-row">
                <div className="settings-label">
                  <span>History</span>
                  <small>The pages you've visited.</small>
                </div>
                <button
                  className="sheet-button"
                  onClick={() => window.firn.showClearHistoryMenu()}
                >
                  Clear history…
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Saved passwords</span>
                  <small>Encrypted, on this computer only.</small>
                </div>
                <button
                  className="sheet-button"
                  onClick={() => window.firn.runAction('passwords')}
                >
                  Manage…
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Scam and malware warnings</span>
                  <small>
                    {state.safeBrowsingAvailable
                      ? 'Checked on this computer, with Google Safe Browsing.'
                      : 'Not set up in this copy of Firn.'}
                  </small>
                </div>
                {state.safeBrowsingAvailable && (
                  <div className="segmented" role="radiogroup">
                    {(
                      [
                        [true, 'On'],
                        [false, 'Off'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={label}
                        role="radio"
                        aria-checked={state.settings.safeBrowsing === value}
                        className={
                          state.settings.safeBrowsing === value ? 'is-on' : ''
                        }
                        onClick={() => change({ safeBrowsing: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Block ads and trackers</span>
                  <small>
                    Public block lists, updated daily. Right-click a page to
                    allow ads on that site.
                  </small>
                </div>
                <div className="segmented" role="radiogroup">
                  {(
                    [
                      [true, 'On'],
                      [false, 'Off'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={label}
                      role="radio"
                      aria-checked={state.settings.adBlocking === value}
                      className={
                        state.settings.adBlocking === value ? 'is-on' : ''
                      }
                      onClick={() => change({ adBlocking: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Cookies and site data</span>
                  <small>Clearing signs you out of websites.</small>
                </div>
                <button
                  className="sheet-button"
                  onClick={() => window.firn.clearSiteData()}
                >
                  Clear…
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Site permissions</span>
                  <small>
                    Camera, location, notifications… Sites will ask again.
                  </small>
                </div>
                <button
                  className="sheet-button"
                  disabled={permissionsReset}
                  onClick={() => {
                    window.firn.resetAllPermissions();
                    setPermissionsReset(true);
                  }}
                >
                  {permissionsReset ? 'Reset' : 'Reset all'}
                </button>
              </div>
            </section>
            <section className="settings-group">
              <h3>Keyboard</h3>
              <div className="settings-row">
                <div className="settings-label">
                  <span>Keyboard shortcuts</span>
                  <small>Quicker ways to do what you do most.</small>
                </div>
                <button
                  className="sheet-button"
                  data-testid="show-shortcuts"
                  onClick={() => window.firn.runAction('shortcuts')}
                >
                  Show…
                </button>
              </div>
            </section>
          </div>
        )}
        <footer className="sheet-footer">
          <span>Firn {state?.version}</span>
          <span>Your history, passwords, and data stay on this computer.</span>
        </footer>
      </div>
    </div>
  );
}

// A dropdown in Firn's own colors (the system's dropdown list ignores
// Firn's light/dark setting on Windows). Click to open, pick one; Esc or a
// click elsewhere closes it.
function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Closing the list hands the keyboard back to the button (so Esc then
  // closes the panel, as anywhere else in it).
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    box.current
      ?.querySelector<HTMLButtonElement>('[aria-selected=true]')
      ?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', onPointer, true);
    return () => removeEventListener('pointerdown', onPointer, true);
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div
      ref={box}
      className="dropdown"
      onKeyDown={(e) => {
        // Esc closes the list (not the whole panel).
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <span>{current?.label}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="dropdown-list" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className="dropdown-option"
              onClick={() => {
                onChange(option.value);
                close();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// "Save password for github.com?" after signing in: a small card at the
// top-left of the page, like the permission prompt. Esc or "Not now"
// closes it.
function SavePasswordPrompt({
  site,
  username,
  update,
}: {
  site: string;
  username: string;
  update: boolean;
}) {
  return (
    <div
      className="permission-layer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') window.firn.answerSavePassword('dismiss');
      }}
    >
      <div
        className="panel permission-card"
        role="dialog"
        aria-label="Save password"
      >
        <div className="permission-text">
          <span className="permission-icon">
            <KeyIcon />
          </span>
          <p>
            {update ? 'Update the password for ' : 'Save password for '}
            <strong>{site}</strong>?
            <br />
            <span className="password-user">{username || 'No username'}</span>
          </p>
        </div>
        <div className="permission-buttons">
          <button
            className="permission-button"
            onClick={() => window.firn.answerSavePassword('dismiss')}
          >
            Not now
          </button>
          <button
            className="permission-button is-allow"
            onClick={() => window.firn.answerSavePassword('save')}
          >
            {update ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Saved passwords (Settings, the Firn menu, or the command bar): sites and
// usernames, with the passwords hidden until you choose to see one.
function PasswordsPanel() {
  const [query, setQuery] = useState('');
  const [logins, setLogins] = useState<SavedLogin[]>([]);
  const [canSave, setCanSave] = useState(true);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return window.firn.onPasswordsChanged(() => setVersion((v) => v + 1));
  }, []);
  useEffect(() => {
    let current = true;
    window.firn.listPasswords().then((result) => {
      if (!current) return;
      setLogins(result.logins);
      setCanSave(result.canSave);
    });
    return () => {
      current = false;
    };
  }, [version]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = logins.filter((l) =>
    words.every((w) => `${l.origin} ${l.username}`.toLowerCase().includes(w)),
  );
  const toggle = async (id: string) => {
    if (shown[id] !== undefined) {
      const { [id]: _, ...rest } = shown;
      setShown(rest);
      return;
    }
    const password = await window.firn.revealPassword(id);
    if (password !== null) setShown({ ...shown, [id]: password });
  };

  return (
    <div
      className="backdrop is-sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) window.firn.closeOverlay();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') window.firn.closeOverlay();
      }}
    >
      <div
        className="panel sheet passwords-sheet"
        role="dialog"
        aria-label="Saved passwords"
      >
        <header className="sheet-header">
          <h2>Saved passwords</h2>
          <button
            className="icon-button"
            title="Close (Esc)"
            onClick={() => window.firn.closeOverlay()}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-search">
          <SearchIcon />
          <input
            ref={inputRef}
            spellCheck={false}
            placeholder="Search passwords"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="sheet-body">
          {!canSave && (
            <p className="sheet-empty">
              Firn can't safely protect passwords on this computer, so it
              doesn't save them here.
            </p>
          )}
          {canSave && visible.length === 0 && (
            <p className="sheet-empty">
              {query.trim()
                ? 'No saved passwords match that.'
                : 'When you sign in to a site, Firn offers to save the password here.'}
            </p>
          )}
          {visible.map((login) => (
            <div key={login.id} className="password-row">
              <span className="password-site" title={login.origin}>
                {login.origin.replace(/^https?:\/\/(www\.)?/, '')}
              </span>
              <span className="password-username">
                {login.username || 'No username'}
              </span>
              <span className="password-secret">
                {shown[login.id] ?? '••••••••'}
              </span>
              <button
                className="icon-button"
                title={shown[login.id] !== undefined ? 'Hide' : 'Show'}
                onClick={() => toggle(login.id)}
              >
                <EyeIcon />
              </button>
              <button
                className="icon-button"
                title="Copy password"
                onClick={() => window.firn.copyPassword(login.id)}
              >
                <CopyIcon />
              </button>
              <button
                className="icon-button"
                title="Delete"
                onClick={() => window.firn.deletePassword(login.id)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
        <footer className="sheet-footer">
          <span>Encrypted with your computer's own protection.</span>
          <span>Kept on this computer only.</span>
        </footer>
      </div>
    </div>
  );
}
