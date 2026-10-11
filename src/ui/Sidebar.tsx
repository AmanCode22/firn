import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Download,
  NavState,
  SidebarState,
  SpacesState,
  TabsState,
} from '../types';
import { DownloadsShelf } from './Downloads';
import { MiniPlayer } from './MiniPlayer';
import { AddressBar } from './AddressBar';
import { Basecamp } from './Basecamp';
import { SpaceHeader, SpaceIconPicker, SpaceSwitcher } from './Spaces';
import { SpaceTabs } from './SpaceTabs';
import {
  ArchiveIcon,
  BackIcon,
  FirnMarkIcon,
  ForwardIcon,
  ReloadIcon,
  SidebarIcon,
  StopIcon,
} from './icons';

const EMPTY_NAV: NavState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  zoom: 1,
  sitePermissions: false,
};

export const DEFAULT_SIDEBAR: SidebarState = {
  width: 260,
  collapsed: false,
  pageLeft: 260,
  peeking: false,
  docking: false,
  aside: false,
};

// The live state every sidebar needs, kept in step with the main process.
export function useSidebarData() {
  const [nav, setNav] = useState<NavState>(EMPTY_NAV);
  const [tabs, setTabs] = useState<TabsState>({
    tabs: [],
    activeTabId: null,
    splits: [],
    player: null,
    dropPreview: null,
  });
  const [sidebar, setSidebar] = useState<SidebarState>(DEFAULT_SIDEBAR);
  const [spaces, setSpaces] = useState<SpacesState>({
    spaces: [],
    activeSpaceId: '',
  });
  const [downloads, setDownloads] = useState<Download[]>([]);
  const barOnTop = useBarOnTop();

  useEffect(() => {
    const offs = [
      window.firn.onDownloadsState(setDownloads),
      window.firn.onNavState(setNav),
      window.firn.onTabsState(setTabs),
      window.firn.onSidebarState(setSidebar),
      window.firn.onSpacesState(setSpaces),
    ];
    window.firn.ready();
    return () => offs.forEach((off) => off());
  }, []);

  // The active space's color tints the frame (see "Space tint" in
  // styles.css); changing it cross-fades.
  const color = spaces.spaces.find((s) => s.id === spaces.activeSpaceId)?.color;
  useEffect(() => {
    const root = document.documentElement;
    const rgb = color && hexToRgb(color);
    if (rgb) {
      root.style.setProperty('--space-rgb', rgb);
      root.dataset.tinted = '';
    } else {
      delete root.dataset.tinted;
    }
  }, [color]);

  return { nav, tabs, sidebar, spaces, downloads, barOnTop };
}

// Whether the bar at the top holds the window's buttons and the sidebar's
// top row (the address bar "At the top", except in fullscreen, where the
// bar goes away and the sidebar gets its top row back).
export function useBarOnTop() {
  const [addressOnTop, setAddressOnTop] = useState(false);
  const [barShown, setBarShown] = useState(false);
  useEffect(() => {
    const offs = [
      window.firn.onSettingsState(({ settings }) =>
        setAddressOnTop(settings.addressBar === 'top'),
      ),
      window.firn.onTopBarState(setBarShown),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  return addressOnTop && barShown;
}

// "#c9a27e" -> "201 162 126", for use in rgb().
function hexToRgb(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  return [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16)).join(' ');
}

// The sidebar's contents: buttons, address bar and tabs. Used both in its
// usual place and when it peeks over the page while collapsed.
export function Sidebar({
  nav,
  tabs,
  spaces,
  downloads,
  collapsed,
  barOnTop,
  className = '',
  style,
}: {
  nav: NavState;
  tabs: TabsState;
  spaces: SpacesState;
  downloads: Download[];
  collapsed: boolean;
  barOnTop: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const space = spaces.spaces.find((s) => s.id === spaces.activeSpaceId);
  const topRow = useRef<HTMLDivElement>(null);
  useTrafficLights(topRow);
  // Which space's name is being edited (only shown while it's the active
  // space).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  useEffect(() => window.firn.onRenameSpace(setRenamingId), []);
  // The icon picker, shown just below the space's name.
  const asideRef = useRef<HTMLElement>(null);
  const [picking, setPicking] = useState<{ id: string; top: number } | null>(
    null,
  );
  useEffect(
    () =>
      window.firn.onPickSpaceIcon((id) => {
        const aside = asideRef.current;
        const header = aside?.querySelector('.space-header');
        const top =
          aside && header
            ? header.getBoundingClientRect().bottom -
              aside.getBoundingClientRect().top
            : 160;
        setPicking({ id, top: Math.round(top + 6) });
      }),
    [],
  );
  const closePicker = useCallback(() => setPicking(null), []);

  // Switching spaces slides the new space's tabs in from the side it's on.
  const index = spaces.spaces.findIndex((s) => s.id === spaces.activeSpaceId);
  const lastIndex = useRef(index);
  const direction = index < lastIndex.current ? -1 : 1;
  useEffect(() => {
    lastIndex.current = index;
  }, [index]);

  return (
    <aside
      ref={asideRef}
      className={`sidebar ${barOnTop ? 'is-under-bar' : ''} ${className}`}
      style={style}
      // Right-click on empty space: the space's menu (Change color...).
      // Tabs, tiles and the space's name have their own menus, and text
      // fields keep the usual one.
      onContextMenu={(e) => {
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        e.preventDefault();
        window.firn.showSidebarMenu();
      }}
    >
      {/* With the bar at the top, these buttons are up there instead. */}
      {!barOnTop && (
        <div className="sidebar-top" ref={topRow}>
          <div className="button-row">
            <SidebarToggle collapsed={collapsed} />
          </div>
          <NavButtons nav={nav} />
        </div>
      )}

      <AddressBar nav={nav} />

      <Basecamp
        tabs={tabs.tabs.filter((t) => t.basecamp)}
        activeTabId={tabs.activeTabId}
      />

      <div
        key={spaces.activeSpaceId}
        className="space-content"
        style={{ '--space-from': `${direction * 8}px` } as React.CSSProperties}
      >
        <SpaceHeader
          space={space}
          renaming={!!space && renamingId === space.id}
          onDoneRenaming={() => setRenamingId(null)}
        />

        <SpaceTabs
          tabs={tabs.tabs.filter((t) => !t.basecamp)}
          activeTabId={tabs.activeTabId}
          folded={!!space?.pinsFolded}
        />
      </div>

      <DownloadsShelf downloads={downloads} />

      <MiniPlayer player={tabs.player} />

      {/* The Firn menu at the left, the archive box at the right, the
          spaces centered between them. */}
      <div className="sidebar-bottom">
        <button
          className="icon-button firn-menu-button"
          title="Firn menu: history, passwords, downloads, settings"
          onClick={() => window.firn.showFirnMenu()}
        >
          <FirnMarkIcon />
        </button>
        <SpaceSwitcher {...spaces} />
        <ArchiveBox />
      </div>

      {space && picking?.id === space.id && (
        <SpaceIconPicker space={space} top={picking.top} onDone={closePicker} />
      )}
    </aside>
  );
}

// The sidebar's top-row buttons, also used by the bar at the top.
export function SidebarToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <button
      className="icon-button"
      title={collapsed ? 'Keep sidebar open (Ctrl+S)' : 'Hide sidebar (Ctrl+S)'}
      onClick={() => window.firn.toggleSidebar()}
    >
      <SidebarIcon />
    </button>
  );
}

export function NavButtons({ nav }: { nav: NavState }) {
  return (
    <nav className="button-row">
      <button
        className="icon-button"
        title="Back"
        disabled={!nav.canGoBack}
        onClick={() => window.firn.command('back')}
      >
        <BackIcon />
      </button>
      <button
        className="icon-button"
        title="Forward"
        disabled={!nav.canGoForward}
        onClick={() => window.firn.command('forward')}
      >
        <ForwardIcon />
      </button>
      <button
        className="icon-button"
        title={nav.isLoading ? 'Stop' : 'Reload'}
        disabled={!nav.url}
        onClick={() => window.firn.command(nav.isLoading ? 'stop' : 'reload')}
      >
        {nav.isLoading ? <StopIcon /> : <ReloadIcon />}
      </button>
    </nav>
  );
}

// macOS: the window's traffic lights sit in the sidebar's top row, but
// macOS draws them, not this layer. So that they move with the row (when the
// sidebar slides out and back, or peeks), this reports where the row is
// drawn, frame by frame for a little while after anything changes (the
// sidebar re-renders on every step of a slide). Each report goes out a
// frame late: the row reaches the screen about a frame after it's measured,
// while the lights move at once.
const LIGHTS_WATCH_MS = 500;

function useTrafficLights(row: React.RefObject<HTMLDivElement | null>) {
  const watch = useRef({ until: 0, frame: 0, sent: '', next: '' });
  useEffect(() => {
    if (window.firn.platform !== 'darwin') return;
    const w = watch.current;
    w.until = performance.now() + LIGHTS_WATCH_MS;
    if (w.frame) return;
    const send = (at: string) => {
      if (!at || at === w.sent) return;
      w.sent = at;
      const [x, y] = at.split(',').map(Number);
      window.firn.lightsAt(x, y);
    };
    const tick = () => {
      send(w.next);
      const box = row.current?.getBoundingClientRect();
      w.next = box ? `${Math.round(box.left)},${Math.round(box.top)}` : '';
      if (performance.now() < w.until) w.frame = requestAnimationFrame(tick);
      else {
        send(w.next);
        w.frame = 0;
      }
    };
    w.frame = requestAnimationFrame(tick);
  });
  useEffect(() => {
    const w = watch.current;
    return () => {
      cancelAnimationFrame(w.frame);
      w.frame = 0;
    };
  }, []);
}

// The archive box: opens the Archive (right-click: how long until tabs are
// tidied away). When Firn tidies tabs away, it gives a little pulse, so
// people see where they went: its lid lifts and settles, and a soft ring in
// the space's color spreads out and fades.
function ArchiveBox() {
  const [pulse, setPulse] = useState(0);
  useEffect(
    () =>
      window.firn.onArchiveChanged((tidied) => {
        if (tidied > 0) setPulse((n) => n + 1);
      }),
    [],
  );
  return (
    <button
      className="icon-button archive-button"
      title="Archived tabs"
      data-testid="archive-box"
      onClick={() => window.firn.runAction('archive')}
      onContextMenu={(e) => {
        e.preventDefault();
        window.firn.showArchiveMenu();
      }}
    >
      {pulse > 0 && (
        <span key={`ring-${pulse}`} className="archive-ring" aria-hidden />
      )}
      <span
        key={`icon-${pulse}`}
        className={pulse > 0 ? 'archive-icon is-pulsing' : 'archive-icon'}
      >
        <ArchiveIcon />
      </span>
    </button>
  );
}
