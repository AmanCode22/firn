import { useEffect, useRef, useState } from 'react';
import type { SplitGroup, TabView } from '../types';
import { Snow } from './FirstLight';
import { Sidebar, useSidebarData } from './Sidebar';
import { tabTitle } from './TabList';

const PAGE_INSET = 8; // matches --page-inset in styles.css
const DEFAULT_WIDTH = 260;

export function App() {
  const { nav, tabs, sidebar, spaces, downloads, barOnTop } = useSidebarData();
  // The top bar is down: the outline of the page slides down with it.
  const [topBarShown, setTopBarShown] = useState(false);
  const [resizing, setResizing] = useState(false);
  const resize = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => window.firn.onTopBarState(setTopBarShown), []);

  // The active space's color, for the empty page.
  const spaceColor =
    spaces.spaces.find((s) => s.id === spaces.activeSpaceId)?.color ?? null;
  const spaceTint = {
    '--tint': spaceColor ?? '#6e98b2',
  } as React.CSSProperties;

  // How far the sidebar has tucked away (0 = fully out, 1 = fully away),
  // following the page's left edge as it glides. Not while the peeking
  // sidebar settles into its place: then it waits underneath, already out.
  const away = sidebar.docking
    ? 0
    : Math.min(
        1,
        Math.max(
          0,
          (sidebar.width - sidebar.pageLeft) / (sidebar.width - PAGE_INSET),
        ),
      );
  // Nothing on screen (e.g. a new, empty space).
  const noTabs = !tabs.activeTabId;
  // The active tab is one side of a split view.
  const activeSplitId = tabs.tabs.find(
    (t) => t.id === tabs.activeTabId,
  )?.splitId;
  const split = tabs.splits.find((s) => s.id === activeSplitId);

  return (
    <div
      className={[
        'app',
        topBarShown && 'top-bar-shown',
        resizing && 'is-resizing',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--sidebar-width': `${sidebar.width}px`,
          '--page-left': `${sidebar.pageLeft}px`,
        } as React.CSSProperties
      }
    >
      <div className="window-grip" />
      <Sidebar
        nav={nav}
        tabs={tabs}
        spaces={spaces}
        downloads={downloads}
        collapsed={sidebar.collapsed}
        barOnTop={barOnTop}
        className={away > 0 ? 'is-tucking' : ''}
        style={
          away > 0
            ? {
                transform: `translateX(${-away * sidebar.width}px)`,
                opacity: 1 - away,
              }
            : undefined
        }
      />

      {/* The gap between sidebar and page: drag it to resize the sidebar,
          double-click to reset. */}
      {!sidebar.collapsed && (
        <div
          className="sidebar-resizer"
          title="Drag to resize · Double-click to reset"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            resize.current = { startX: e.clientX, startWidth: sidebar.width };
            setResizing(true);
          }}
          onPointerMove={(e) => {
            const r = resize.current;
            if (r)
              window.firn.setSidebarWidth(r.startWidth + e.clientX - r.startX);
          }}
          onPointerUp={() => {
            resize.current = null;
            setResizing(false);
          }}
          onDoubleClick={() => window.firn.setSidebarWidth(DEFAULT_WIDTH)}
        />
      )}

      {/* Sits right behind the web page so the page looks lifted off the
          frame. With no tabs open, this calm page shows instead. */}
      <main
        className={[
          'page-area',
          noTabs && 'is-empty',
          (split || tabs.dropPreview) && 'is-split',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {noTabs && (
          // First light: the welcome's glacier sky and sunrise glow (the
          // same for every space), and snow in the space's color, the mark
          // above the words in it too. Static; follows the space.
          <>
            <div className="fl-sky" aria-hidden />
            <div className="fl-sun" aria-hidden />
            <Snow tint={spaceColor} />
          </>
        )}
        {noTabs && (
          <div className="empty-page" style={spaceTint}>
            <span className="empty-mark" aria-hidden />
            <p className="empty-title">No open tabs</p>
            <p className="empty-hint">
              Press {window.firn.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+T to
              open one.
            </p>
          </div>
        )}
        {split && !tabs.dropPreview && (
          <SplitFrame split={split} activeTabId={tabs.activeTabId} />
        )}
        {tabs.dropPreview && (
          <DropCard
            side={tabs.dropPreview.side}
            tab={tabs.tabs.find((t) => t.id === tabs.dropPreview!.tabId)}
          />
        )}
      </main>
    </div>
  );
}

const SPLIT_GAP = 8; // matches SPLIT_GAP in src/tabs.ts

// A tab dragged from the sidebar over the page: where it will open in
// split view, in the half the page made room for. Let go to open it.
function DropCard({
  side,
  tab,
}: {
  side: 'left' | 'right';
  tab: TabView | undefined;
}) {
  const half = `calc((100% - ${SPLIT_GAP}px) / 2)`;
  const left = { left: 0, width: half };
  const right = { right: 0, width: half };
  return (
    <>
      {/* The page's lifted outline, on the half it moved to. */}
      <div className="split-side" style={side === 'left' ? right : left} />
      {/* (The tab itself is carried under the pointer, in front.) */}
      <div
        className="drop-card"
        style={side === 'left' ? left : right}
        aria-label={tab ? `Let go to open ${tabTitle(tab)} here` : undefined}
      >
        <span className="drop-card-hint">Let go to open it here</span>
      </div>
    </>
  );
}

// Behind a split view's two pages: each side's lifted outline (the side you
// last clicked into has a soft ring in the space's color), and the gap
// between them, which can be dragged to resize the sides. Double-click it
// to go back to half and half.
function SplitFrame({
  split,
  activeTabId,
}: {
  split: SplitGroup;
  activeTabId: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const left = split.sizes[0];
  const leftWidth = `calc((100% - ${SPLIT_GAP}px) * ${left})`;
  const ratioAt = (e: React.PointerEvent) => {
    const area = e.currentTarget.parentElement!.getBoundingClientRect();
    return (e.clientX - area.left - SPLIT_GAP / 2) / (area.width - SPLIT_GAP);
  };
  return (
    <>
      <div
        className={`split-side ${split.tabIds[0] === activeTabId ? 'is-active' : ''}`}
        style={{ left: 0, width: leftWidth }}
      />
      <div
        className={`split-side ${split.tabIds[1] === activeTabId ? 'is-active' : ''}`}
        style={{ left: `calc(${leftWidth} + ${SPLIT_GAP}px)`, right: 0 }}
      />
      <div
        className={`split-gap ${dragging ? 'is-dragging' : ''}`}
        data-testid="split-divider"
        style={{ left: leftWidth }}
        title="Drag to resize · Double-click to even out"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (dragging) window.firn.resizeSplit(split.id, ratioAt(e));
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => window.firn.resizeSplit(split.id, 0.5)}
      >
        <span className="split-grip" />
      </div>
    </>
  );
}
