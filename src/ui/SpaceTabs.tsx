import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TabView } from '../types';
import {
  ClearDownIcon,
  CloseIcon,
  PlusIcon,
  SeparateIcon,
  UnloadIcon,
} from './icons';
import { useFollowPointer } from './followPointer';
import { carry, CARRY_AFTER, dragOverPage } from './splitDrag';
import { TabIcon, TabSound, tabTitle } from './TabList';

// A space's tabs as one list: its pinned tabs, the divider (with "Clear"),
// "New tab", then its everyday tabs.
//
// Any tab can be dragged up or down, including across the divider: above
// it, the tab is pinned; below it, unpinned. Dragged out onto the page, it
// opens in split view there (src/ui/splitDrag.ts). A tab opens when it's
// clicked (pressed and let go without dragging), so dragging one leaves
// the page on screen as it is. Whenever tabs change places
// (dragging, pinning from the menu, closing, opening), the rows glide to
// their new spots instead of jumping.

// How far the pointer must move before a press becomes a drag (so ordinary
// clicks never turn into accidental drags).
const DRAG_THRESHOLD = 4;
const ROW_GAP = 4; // matches the gap between rows in styles.css
const GLIDE = { duration: 200, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' };

// One thing in the list, as measured when a drag starts.
interface Item {
  key: string; // a tab id, or 'divider' / 'new-tab'
  top: number;
  height: number;
}

interface Drag {
  id: string;
  tabId: string; // the tab to open on a click (a split row's half)
  startX: number;
  startY: number;
  dy: number;
  active: boolean;
  // Pulled sideways out of its place: carried under the pointer on the
  // floating layer, in front of the page (see CARRY_AFTER). A split
  // view's row isn't: it isn't dragged into another split.
  carried: boolean;
  // Where on the row it was grabbed, and the row's box when it was.
  grab: { x: number; y: number; width: number };
  box: { left: number; top: number };
  // Out over the page (to open it in split view), not reordering.
  overPage: boolean;
  items: Item[]; // measured once the drag starts
}

// Where a dragged tab would land.
interface Drop {
  pinned: boolean;
  index: number; // within the pinned or everyday tabs
  slot: number; // position among the other items in the list
}

export function SpaceTabs({
  tabs,
  activeTabId,
  folded,
}: {
  tabs: TabView[]; // the space's own tabs (not Basecamp), in order
  activeTabId: string | null;
  folded: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // After a drop, rows stay where they were dropped until the new order
  // arrives; then they glide from there into place.
  const [pending, setPending] = useState<{
    signature: string;
    offsets: Map<string, number>;
  } | null>(null);
  const [returning, setReturning] = useState<string | null>(null);

  const pins = tabs.filter((t) => t.pinned);
  const everyday = tabs.filter((t) => !t.pinned);
  // Everyday tabs as rows: the two sides of a split view share one row.
  const everydayRows: TabView[][] = [];
  for (const tab of everyday) {
    const last = everydayRows.at(-1);
    if (tab.splitId && last && last[0].splitId === tab.splitId) last.push(tab);
    else everydayRows.push([tab]);
  }
  const activePin = folded && pins.find((t) => t.id === activeTabId);
  const signature = tabs
    .map((t) => `${t.id}:${t.pinned ? 1 : 0}:${t.splitId ?? ''}`)
    .join(',');

  // --- Gliding into new places ----------------------------------------------
  // When the order changes, note where every row was just before the update
  // (still on screen at this point), then glide each one from there.
  const lastSignature = useRef(signature);
  const before = useRef<Map<string, number> | null>(null);
  if (lastSignature.current !== signature) {
    lastSignature.current = signature;
    before.current = measure(listRef.current);
  }
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was || !listRef.current) return;
    for (const el of itemElements(listRef.current)) {
      const key = el.dataset.item!;
      const from = was.get(key);
      const now = topOf(el, listRef.current);
      if (from === undefined) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], GLIDE);
      } else if (Math.abs(from - now) > 0.5) {
        el.animate(
          [{ translate: `0 ${from - now}px` }, { translate: '0 0' }],
          GLIDE,
        );
      }
    }
  });

  // --- Dragging ---------------------------------------------------------------

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const dropFor = (d: Drag): Drop | null => {
    const self = d.items.find((i) => i.key === d.id);
    if (!self) return null;
    const others = d.items.filter((i) => i !== self);
    const center = self.top + self.height / 2 + d.dy;
    // The divider counts as passed only once the tab is fully below it, so
    // anywhere above its bottom edge pins (even with no pins yet).
    let slot = others.filter((o) =>
      o.key === 'divider'
        ? o.top + o.height < center
        : o.top + o.height / 2 < center,
    ).length;
    const divider = others.findIndex((o) => o.key === 'divider');
    const newTab = others.findIndex((o) => o.key === 'new-tab');
    // Between the divider and "New tab" means the top of the everyday tabs.
    if (slot > divider && slot <= newTab) slot = newTab + 1;
    const pinned = slot <= divider;
    return { pinned, index: pinned ? slot : slot - newTab - 1, slot };
  };

  // How far each item is nudged to make room for the dragged tab.
  const offsetsFor = (d: Drag) => {
    const offsets = new Map<string, number>();
    const drop = dropFor(d);
    const selfIndex = d.items.findIndex((i) => i.key === d.id);
    if (!drop || selfIndex < 0) return offsets;
    const pitch = d.items[selfIndex].height + ROW_GAP;
    d.items
      .filter((i) => i.key !== d.id)
      .forEach((item, j) => {
        if (j >= selfIndex && j < drop.slot) offsets.set(item.key, -pitch);
        if (j < selfIndex && j >= drop.slot) offsets.set(item.key, pitch);
      });
    offsets.set(d.id, d.dy);
    return offsets;
  };

  // `rowId` is the row being dragged (a split view's row is its first
  // tab's); `tabId` is the tab to switch to.
  const onPointerDown = (
    e: ReactPointerEvent,
    rowId: string,
    tabId = rowId,
  ) => {
    if (e.button !== 0) return;
    // (A click without a real pointer behind it can't be captured; it
    // switches tabs right away, it just can't start a drag.)
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      window.firn.activateTab(tabId);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    update({
      id: rowId,
      tabId,
      startX: e.clientX,
      startY: e.clientY,
      dy: 0,
      active: false,
      carried: false,
      grab: {
        x: e.clientX - box.left,
        y: e.clientY - box.top,
        width: box.width,
      },
      box: { left: box.left, top: box.top },
      overPage: false,
      items: [],
    });
    followPointer();
  };

  const onPointerMove = (e: { clientX: number; clientY: number }) => {
    const d = dragRef.current;
    const list = listRef.current;
    if (!d || !list) return;
    const raw = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, raw) <= DRAG_THRESHOLD) return;
      setPending(null);
      setReturning(null);
      d.items = itemElements(list).map((el) => ({
        key: el.dataset.item!,
        top: topOf(el, list),
        height: el.offsetHeight,
      }));
    }
    // Keep it within the list (it can reach halfway past the last row, to
    // drop below it).
    const self = d.items.find((i) => i.key === d.id);
    const last = d.items.at(-1);
    if (!self || !last) return;
    // Out over the page: the row waits in its place while the page shows
    // where the tab would open. (A split view's row moves as a whole, so
    // it isn't dragged into another split.)
    const carried = d.id === d.tabId && e.clientX - d.startX > CARRY_AFTER;
    if (carried)
      carry(e, d.tabId, d.grab, {
        left: d.box.left,
        top: d.box.top + (d.carried ? 0 : d.dy),
      });
    else if (d.carried) window.firn.carryTab(null);
    const overPage = carried && dragOverPage(e, d.tabId, listRef.current);
    if (d.overPage && !overPage) window.firn.endDragToSplit(false);
    if (carried) {
      update({ ...d, dy: 0, active: true, carried, overPage });
      return;
    }
    const dy = Math.max(
      -self.top,
      Math.min(last.top + last.height - self.top - self.height / 2, raw),
    );
    update({ ...d, dy, active: true, carried, overPage: false });
  };

  const finish = (commit: boolean) => {
    const d = dragRef.current;
    update(null);
    if (!d) return;
    if (d.carried) window.firn.carryTab(null);
    // A click (no drag): open the tab.
    if (!d.active) {
      if (commit) window.firn.activateTab(d.tabId);
      return;
    }
    if (d.overPage) {
      window.firn.endDragToSplit(commit);
      setReturning(d.id);
      setTimeout(() => setReturning(null), GLIDE.duration + 50);
      return;
    }
    const drop = commit ? dropFor(d) : null;
    const tab = tabs.find((t) => t.id === d.id);
    const rows = tab?.pinned ? pins.map((t) => [t]) : everydayRows;
    const unchanged =
      !drop ||
      !tab ||
      (drop.pinned === tab.pinned &&
        drop.index === rows.findIndex((r) => r.some((t) => t.id === d.id)));
    if (unchanged) {
      // Glide back to where it was.
      setReturning(d.id);
      setTimeout(() => setReturning(null), GLIDE.duration + 50);
      return;
    }
    setPending({ signature, offsets: offsetsFor(d) });
    window.firn.moveTab(d.id, drop.index, drop.pinned);
    // In case the move doesn't happen, don't leave rows out of place.
    setTimeout(() => setPending(null), 1000);
  };

  const followPointer = useFollowPointer(onPointerMove, finish);

  const offsets = drag?.active
    ? offsetsFor(drag)
    : pending?.signature === signature
      ? pending.offsets
      : null;
  const nudge = (key: string) => {
    const y = offsets?.get(key);
    return y ? { transform: `translateY(${y}px)` } : undefined;
  };

  const row = (tab: TabView, kind: 'pinned' | 'everyday', listed = true) => (
    <TabRow
      key={tab.id}
      tab={tab}
      kind={kind}
      active={tab.id === activeTabId}
      dragged={drag?.active === true && drag.id === tab.id}
      carriedAway={drag?.carried === true && drag.id === tab.id}
      returning={returning === tab.id}
      listed={listed}
      style={listed ? nudge(tab.id) : undefined}
      onPointerDown={(e) => onPointerDown(e, tab.id)}
    />
  );

  return (
    <div
      ref={listRef}
      className={`space-tabs ${drag?.active ? 'is-dragging' : ''}`}
    >
      <div className={`space-pins ${folded ? 'is-folded' : ''}`}>
        <div className="space-pins-inner">
          {pins.map((tab) => row(tab, 'pinned', !folded))}
        </div>
      </div>
      {activePin && row(activePin, 'pinned')}

      <div
        className="space-divider"
        data-item="divider"
        style={nudge('divider')}
      >
        <span className="space-divider-line" />
        {everyday.length > 0 && (
          <button
            className="space-clear"
            title="Close the unpinned tabs below"
            onClick={() => window.firn.clearTabs()}
          >
            <ClearDownIcon />
            Clear
          </button>
        )}
      </div>

      <button
        className="new-tab"
        data-testid="new-tab"
        data-item="new-tab"
        style={nudge('new-tab')}
        onClick={() => window.firn.newTab()}
      >
        <span className="tab-icon">
          <PlusIcon />
        </span>
        New tab
      </button>

      {everydayRows.map((tabsInRow) =>
        tabsInRow.length === 2 ? (
          <SplitRow
            key={tabsInRow[0].id}
            tabs={tabsInRow}
            activeTabId={activeTabId}
            dragged={drag?.active === true && drag.id === tabsInRow[0].id}
            returning={returning === tabsInRow[0].id}
            style={nudge(tabsInRow[0].id)}
            onPointerDown={(e, tabId) =>
              onPointerDown(e, tabsInRow[0].id, tabId)
            }
          />
        ) : (
          row(tabsInRow[0], 'everyday')
        ),
      )}
    </div>
  );
}

function TabRow({
  tab,
  kind,
  active,
  dragged,
  carriedAway,
  returning,
  listed,
  style,
  ...handlers
}: {
  tab: TabView;
  kind: 'pinned' | 'everyday';
  active: boolean;
  dragged: boolean;
  // Carried out to the page: its place waits, faded.
  carriedAway?: boolean;
  returning: boolean;
  // False for the copies hidden inside folded pins (not part of dragging or
  // gliding).
  listed: boolean;
  style?: React.CSSProperties;
  onPointerDown: (e: ReactPointerEvent) => void;
}) {
  const pinned = kind === 'pinned';
  return (
    <div
      className={[
        'tab',
        active && 'is-active',
        pinned && !tab.loaded && 'is-unloaded',
        dragged && !carriedAway && 'is-dragged',
        carriedAway && 'is-carried-away',
        returning && 'is-returning',
      ]
        .filter(Boolean)
        .join(' ')}
      data-item={listed ? tab.id : undefined}
      data-kind={kind}
      data-testid="tab"
      style={style}
      title={tabTitle(tab)}
      {...handlers}
      // Middle-click closes (or unloads a pinned tab), like other browsers.
      onAuxClick={(e) => {
        if (e.button === 1) window.firn.closeTab(tab.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        window.firn.showTabMenu(tab.id);
      }}
    >
      <span className="tab-icon">
        <TabIcon tab={tab} />
      </span>
      <span className="tab-title">{tabTitle(tab)}</span>
      <TabSound tab={tab} />
      {(!pinned || tab.loaded) && (
        <button
          className="tab-close"
          title={pinned ? 'Unload tab' : 'Close tab'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => window.firn.closeTab(tab.id)}
        >
          {pinned ? <UnloadIcon /> : <CloseIcon />}
        </button>
      )}
    </div>
  );
}

// A split view in the sidebar: one row with both tabs, side by side. Click
// either half to work in that side; drag the row to move both. The button
// on hover separates them again.
function SplitRow({
  tabs,
  activeTabId,
  dragged,
  returning,
  style,
  onPointerDown,
  ...handlers
}: {
  tabs: TabView[];
  activeTabId: string | null;
  dragged: boolean;
  returning: boolean;
  style?: React.CSSProperties;
  onPointerDown: (e: ReactPointerEvent, tabId: string) => void;
}) {
  const active = tabs.some((t) => t.id === activeTabId);
  return (
    <div
      className={[
        'tab',
        'split-row',
        active && 'is-active',
        dragged && 'is-dragged',
        returning && 'is-returning',
      ]
        .filter(Boolean)
        .join(' ')}
      data-item={tabs[0].id}
      data-kind="everyday"
      style={style}
      {...handlers}
    >
      {tabs.map((tab, i) => (
        <span
          key={tab.id}
          className={`split-half ${tab.id === activeTabId ? 'is-current' : ''}`}
          data-testid="tab"
          title={tabTitle(tab)}
          onPointerDown={(e) => onPointerDown(e, tab.id)}
          // Middle-click closes that side; the other carries on alone.
          onAuxClick={(e) => {
            if (e.button === 1) window.firn.closeTab(tab.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            window.firn.showTabMenu(tab.id);
          }}
        >
          {i === 1 && <span className="split-line" />}
          <span className="tab-icon">
            <TabIcon tab={tab} />
          </span>
          <span className="tab-title">{tabTitle(tab)}</span>
          <TabSound tab={tab} />
        </span>
      ))}
      <button
        className="tab-close"
        title="Separate split view"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => window.firn.separateSplit(tabs[0].id)}
      >
        <SeparateIcon />
      </button>
    </div>
  );
}

// The list's draggable and gliding items, top to bottom.
function itemElements(list: HTMLElement) {
  return [...list.querySelectorAll<HTMLElement>('[data-item]')];
}

// An item's top edge within the list's content (so scrolling doesn't count).
function topOf(el: HTMLElement, list: HTMLElement) {
  return (
    el.getBoundingClientRect().top -
    list.getBoundingClientRect().top +
    list.scrollTop
  );
}

function measure(list: HTMLElement | null) {
  const tops = new Map<string, number>();
  if (list)
    for (const el of itemElements(list))
      tops.set(el.dataset.item!, topOf(el, list));
  return tops;
}
