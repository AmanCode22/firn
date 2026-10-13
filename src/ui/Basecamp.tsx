import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TabView } from '../types';
import { useIconColor } from './iconColor';
import { useFollowPointer } from './followPointer';
import { carry, dragOverPage } from './splitDrag';
import { layerShown } from './quietWhenHidden';
import { setBasecampTarget, tabsTarget, type TabsDrop } from './sidebarDrop';
import {
  sameRowProps,
  TabIcon,
  TabSound,
  tabTitle,
  useSteady,
} from './TabList';

// Basecamp: a grid of favorite sites at the top of the sidebar, the same in
// every space (at most 12). Closing one (middle-click) unloads it rather
// than removing it; right-click for "Go back to home" and "Remove from
// Basecamp".
//
// The tiles share each row evenly: one pin fills the row, two split it, and
// so on, until the tiles would get too narrow and a new row starts (so a
// wider sidebar fits more per row).
//
// Drag a tile to reorder Basecamp, like the sidebar's tabs: it lifts and
// follows the pointer, the others glide aside to make room, and it settles
// into its new place. Dragged out onto the page instead, a copy of it
// opens there in split view (src/ui/splitDrag.ts); the tile stays put.
// Dragged down into the space's tabs, it leaves Basecamp and becomes a
// pinned or everyday tab there; a tab dragged up from the tabs joins
// Basecamp, which opens a spot for it (src/ui/sidebarDrop.ts).

// How far the pointer must move before a press becomes a drag (so ordinary
// clicks never turn into accidental drags).
const DRAG_THRESHOLD = 4;
// How far above Basecamp's bottom edge a dragged tile starts leaving it.
const LEAVE_EARLY = 6;
const BASECAMP_MAX = 12; // as in src/tabs.ts
const GLIDE = { duration: 200, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' };

interface Spot {
  x: number;
  y: number;
}

interface Drag {
  id: string;
  // Out over the page (to open it in split view), not reordering.
  overPage: boolean;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  active: boolean;
  // Pulled out past Basecamp's right edge: carried under the pointer on
  // the floating layer, in front of the page (as a tab), until it's let
  // go; the tile waits in its place, faded.
  carried: boolean;
  // The tile's box when it was picked up, and Basecamp's right edge.
  box: { left: number; top: number };
  gridRight: number;
  // Down over the space's tabs: where it would land there (null: not).
  tabsDrop: TabsDrop | null;
  // Measured once the drag starts: each tile's spot within the grid, and
  // the grid's size.
  spots: Map<string, Spot>;
  size: {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
  };
}

export function Basecamp({
  tabs,
  activeTabId,
}: {
  tabs: TabView[];
  activeTabId: string | null;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  // The grid's width, for spreading the tiles evenly over the rows.
  const [gridWidth, setGridWidth] = useState(0);
  const hasTiles = tabs.length > 0;
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    setGridWidth(grid.clientWidth);
    const watch = new ResizeObserver(([entry]) =>
      setGridWidth(entry.contentRect.width),
    );
    watch.observe(grid);
    return () => watch.disconnect();
  }, [hasTiles]);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // After a drop, tiles stay where they were dropped until the new order
  // arrives; then they glide from there into place.
  const [pending, setPending] = useState<{
    signature: string;
    offsets: Map<string, Spot>;
  } | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const ids = tabs.map((t) => t.id);
  // A tab dragged up from the space's tabs: where its spot opens.
  const [incoming, setIncoming] = useState<{
    id: string;
    index: number;
  } | null>(null);
  const signature = ids.join(',') + (incoming ? `|+${incoming.index}` : '');

  // --- Gliding into new places ----------------------------------------------
  // When the tiles change (a drop, one added or removed), note where each
  // one was just before the update, then glide it from there.
  const lastSignature = useRef(signature);
  const before = useRef<Map<string, Spot> | null>(null);
  if (lastSignature.current !== signature) {
    lastSignature.current = signature;
    before.current = spotsOf(gridRef.current);
  }
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    const grid = gridRef.current;
    if (!was || !grid || !layerShown()) return;
    const now = spotsOf(grid);
    for (const el of tileElements(grid)) {
      const id = el.dataset.tile!;
      const from = was.get(id);
      const to = now.get(id)!;
      if (!from) el.animate([{ opacity: 0 }, { opacity: 1 }], GLIDE);
      else if (Math.abs(from.x - to.x) > 0.5 || Math.abs(from.y - to.y) > 0.5)
        el.animate(
          [
            { translate: `${from.x - to.x}px ${from.y - to.y}px` },
            { translate: '0 0' },
          ],
          GLIDE,
        );
    }
  });

  // --- Dragging ---------------------------------------------------------------

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // Where the dragged tile would land: the spot nearest its middle.
  const dropIndex = (d: Drag) => {
    const self = d.spots.get(d.id)!;
    const x = self.x + d.dx;
    const y = self.y + d.dy;
    let best = 0;
    let bestDistance = Infinity;
    ids.forEach((id, i) => {
      const spot = d.spots.get(id)!;
      const distance = (spot.x - x) ** 2 + (spot.y - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  };

  // How far each tile moves to make room: the others shift into the spots
  // of the new order; the dragged one stays under the pointer.
  const offsetsFor = (d: Drag) => {
    const offsets = new Map<string, Spot>();
    const order = ids.filter((id) => id !== d.id);
    order.splice(dropIndex(d), 0, d.id);
    order.forEach((id, i) => {
      if (id === d.id) return;
      const from = d.spots.get(id)!;
      const to = d.spots.get(ids[i])!;
      if (from.x !== to.x || from.y !== to.y)
        offsets.set(id, { x: to.x - from.x, y: to.y - from.y });
    });
    offsets.set(d.id, { x: d.dx, y: d.dy });
    return offsets;
  };

  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    // (A click without a real pointer behind it can't be captured; it
    // switches tabs right away, it just can't start a drag.)
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      window.firn.activateTab(id);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    update({
      id,
      overPage: false,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      active: false,
      carried: false,
      box: { left: box.left, top: box.top },
      gridRight: gridRef.current?.getBoundingClientRect().right ?? Infinity,
      tabsDrop: null,
      spots: new Map(),
      size: { width: 0, height: 0, tileWidth: 0, tileHeight: 0 },
    });
    followPointer();
  };

  const onPointerMove = (e: { clientX: number; clientY: number }) => {
    const d = dragRef.current;
    const grid = gridRef.current;
    if (!d || !grid) return;
    const rawX = e.clientX - d.startX;
    const rawY = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(rawX, rawY) <= DRAG_THRESHOLD) return;
      setPending(null);
      setReturning(null);
      d.spots = spotsOf(grid);
      const tile = tileElements(grid)[0];
      d.size = {
        width: grid.clientWidth,
        height: grid.clientHeight,
        tileWidth: tile.offsetWidth,
        tileHeight: tile.offsetHeight,
      };
    }
    // Out over the page: the tile waits in its place while the page shows
    // where a copy of it would open.
    // Down over the space's tabs: it lifts out, and the tabs open a gap
    // where it would land.
    // It lets go of Basecamp as soon as the pointer reaches its bottom edge
    // (a little before it), so pulling a tile out doesn't feel sticky.
    const gridBottom = grid.getBoundingClientRect().bottom - LEAVE_EARLY;
    const tabsDrop =
      e.clientY > gridBottom
        ? (tabsTarget()?.dropAt(e.clientX, e.clientY) ?? null)
        : null;
    if (
      tabsDrop?.slot !== d.tabsDrop?.slot ||
      tabsDrop?.pinned !== d.tabsDrop?.pinned
    )
      tabsTarget()?.show(tabsDrop);
    const carried = e.clientX > d.gridRight || tabsDrop !== null;
    if (carried)
      // Carried as a tab: held near its start, from where the tile is.
      carry(
        e,
        d.id,
        { x: 24, y: 18, width: grid.clientWidth },
        {
          left: d.box.left + (d.carried ? 0 : d.dx),
          top: d.box.top + (d.carried ? 0 : d.dy),
        },
      );
    else if (d.carried) window.firn.carryTab(null);
    const overPage = carried && dragOverPage(e, d.id, gridRef.current);
    if (d.overPage && !overPage) window.firn.endDragToSplit(false);
    if (carried) {
      update({ ...d, dx: 0, dy: 0, active: true, carried, overPage, tabsDrop });
      return;
    }
    // Keep it within Basecamp.
    const self = d.spots.get(d.id)!;
    const dx = Math.max(
      -self.x,
      Math.min(d.size.width - d.size.tileWidth - self.x, rawX),
    );
    const dy = Math.max(
      -self.y,
      Math.min(d.size.height - d.size.tileHeight - self.y, rawY),
    );
    update({
      ...d,
      dx,
      dy,
      active: true,
      carried,
      overPage: false,
      tabsDrop: null,
    });
  };

  const finish = (commit: boolean) => {
    const d = dragRef.current;
    update(null);
    if (!d) return;
    if (d.carried) window.firn.carryTab(null);
    if (d.tabsDrop) tabsTarget()?.show(null);
    // A click (no drag): open the tile's site.
    if (!d.active) {
      if (commit) window.firn.activateTab(d.id);
      return;
    }
    // Let go over the space's tabs: it leaves Basecamp and lands there.
    if (d.tabsDrop && commit) {
      window.firn.moveTabTo(
        d.id,
        d.tabsDrop.pinned ? 'pinned' : 'everyday',
        d.tabsDrop.index,
      );
      return;
    }
    if (d.overPage) window.firn.endDragToSplit(commit);
    const to = commit && !d.overPage ? dropIndex(d) : ids.indexOf(d.id);
    if (to === ids.indexOf(d.id)) {
      // Glide back to where it was.
      setReturning(d.id);
      setTimeout(() => setReturning(null), GLIDE.duration + 50);
      return;
    }
    setPending({ signature, offsets: offsetsFor(d) });
    window.firn.moveTab(d.id, to);
    // In case the move doesn't happen, don't leave tiles out of place.
    setTimeout(() => setPending(null), 1000);
  };

  const followPointer = useFollowPointer(onPointerMove, finish);
  // (Before the early return below: hooks must run on every render.)
  const tileDown = useSteady(onPointerDown);

  // --- A tab coming in from the space's tabs -------------------------------------
  // Where it would join: the place in reading order (row by row, left to
  // right) nearest the pointer. Nowhere once Basecamp is full.
  const live = useRef<{
    ids: string[];
    layout: ReturnType<typeof tileSpots>;
    shown: (TabView | null)[];
  }>({ ids, layout: { columns: 1, spots: [] }, shown: [] });
  useLayoutEffect(() => {
    setBasecampTarget({
      indexAt: (x, y) => {
        const { ids: now } = live.current;
        if (now.length >= BASECAMP_MAX) return null;
        const grid = gridRef.current;
        if (!grid) return 0;
        // Where each tile settles (from its row and column in the grid),
        // not where it is mid-glide, so the spot doesn't flicker while the
        // tiles make room.
        const { layout: placed, shown: order } = live.current;
        const g = grid.getBoundingClientRect();
        const width =
          (g.width - TILE_GAP * (placed.columns - 1)) / placed.columns;
        let index = 0;
        order.forEach((tab, i) => {
          const at = placed.spots[i];
          if (!tab || !at) return;
          const left = g.left + (at.column - 1) * (width + TILE_GAP);
          const top = g.top + (at.row - 1) * (TILE_HEIGHT + TILE_GAP);
          const rowAbove = top + TILE_HEIGHT < y;
          const sameRow = top <= y && y <= top + TILE_HEIGHT;
          if (rowAbove || (sameRow && left + width / 2 < x)) index++;
        });
        return Math.min(index, now.length);
      },
      show: (next) =>
        setIncoming((was) =>
          was?.id === next?.id && was?.index === next?.index ? was : next,
        ),
    });
    return () => setBasecampTarget(null);
  }, []);

  if (!tabs.length && !incoming) return null;
  // The tiles as drawn: an incoming tab's spot opens among them.
  const shown: (TabView | null)[] = [...tabs];
  if (incoming) shown.splice(incoming.index, 0, null);
  const layout = tileSpots(shown.length, gridWidth);
  live.current = { ids, layout, shown };
  const offsets = drag?.active
    ? offsetsFor(drag)
    : pending?.signature === signature
      ? pending.offsets
      : null;
  return (
    <div className="basecamp">
      <div
        ref={gridRef}
        className={`basecamp-grid ${drag?.active || incoming ? 'is-dragging' : ''}`}
        style={{ gridTemplateColumns: `repeat(${layout.columns}, 1fr)` }}
      >
        {shown.map((tab, i) => {
          if (!tab)
            return (
              <span
                key="incoming"
                className="basecamp-tile is-incoming"
                data-tile="incoming"
                style={{
                  gridRow: layout.spots[i]?.row,
                  gridColumn: layout.spots[i]?.column,
                }}
              />
            );
          const offset = offsets?.get(tab.id);
          return (
            <BasecampTile
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              dragged={drag?.active === true && drag.id === tab.id}
              carriedAway={drag?.carried === true && drag.id === tab.id}
              returning={returning === tab.id}
              offset={offset}
              row={layout.spots[i]?.row}
              column={layout.spots[i]?.column}
              onPointerDown={tileDown}
            />
          );
        })}
      </div>
    </div>
  );
}

const BasecampTile = memo(function BasecampTile({
  tab,
  active,
  dragged,
  carriedAway,
  returning,
  offset,
  row,
  column,
  onPointerDown,
}: {
  tab: TabView;
  active: boolean;
  dragged: boolean;
  // Carried out to the page: it waits in its place, faded.
  carriedAway: boolean;
  returning: boolean;
  offset?: Spot;
  // Its place in Basecamp's grid (see tileSpots).
  row?: number;
  column?: number;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
}) {
  // The active tile is tinted with its icon's own color.
  const color = useIconColor(tab.favicon);
  return (
    <button
      className={[
        'basecamp-tile',
        active && 'is-active',
        color && 'is-tinted',
        !tab.loaded && 'is-unloaded',
        dragged && !carriedAway && 'is-dragged',
        carriedAway && 'is-carried-away',
        returning && 'is-returning',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          ...(color && { '--pin-rgb': color }),
          ...(row && column && { gridRow: row, gridColumn: column }),
          ...(offset && {
            transform: `translate(${offset.x}px, ${offset.y}px)`,
          }),
        } as CSSProperties
      }
      data-tile={tab.id}
      data-testid="basecamp-tile"
      title={tabTitle(tab)}
      onPointerDown={(e) => onPointerDown(e, tab.id)}
      onAuxClick={(e) => {
        if (e.button === 1) window.firn.closeTab(tab.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        window.firn.showTabMenu(tab.id);
      }}
    >
      <span className="basecamp-icon">
        <TabIcon tab={tab} />
      </span>
      <TabSound tab={tab} badge />
    </button>
  );
}, sameRowProps);

// The grid's tiles, in order.
function tileElements(grid: HTMLElement) {
  return [...grid.querySelectorAll<HTMLElement>('[data-tile]')];
}

// Where each tile is drawn within the grid (moved tiles included).
function spotsOf(grid: HTMLElement | null) {
  const spots = new Map<string, Spot>();
  if (!grid) return spots;
  const box = grid.getBoundingClientRect();
  for (const el of tileElements(grid)) {
    const r = el.getBoundingClientRect();
    spots.set(el.dataset.tile!, { x: r.left - box.left, y: r.top - box.top });
  }
  return spots;
}

// Basecamp's tiles are spread as evenly as the rows allow: as many rows as
// the width needs, the tiles shared out over them (rows differ by one at
// most, the fuller ones first), never one tile alone on a row (David).
// With room for 4 across: 4 tiles make one row, 5 make 3 + 2, 6 make
// 3 + 3, 7 make 4 + 3, 10 make 4 + 3 + 3; with room for 3, 4 make 2 + 2
// and 7 make 3 + 2 + 2. Each tile is placed in its row and column
// (`tileSpots`); tiles keep one size, left-aligned.
const TILE_MIN = 52; // as narrow as a tile gets (px)
const TILE_GAP = 6; // as in .basecamp-grid
const TILE_HEIGHT = 44; // as in .basecamp-tile
export function rowSizes(count: number, width: number) {
  if (count <= 0) return [];
  const fit = Math.max(
    1,
    Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP)),
  );
  const rows = Math.ceil(count / fit);
  const base = Math.floor(count / rows);
  const fuller = count % rows;
  return Array.from({ length: rows }, (_, row) =>
    row < fuller ? base + 1 : base,
  );
}

// Where each tile goes, in order: its row and column (from 1, for CSS
// grid), and how many columns the grid has.
function tileSpots(count: number, width: number) {
  const sizes = rowSizes(count, width);
  const spots: { row: number; column: number }[] = [];
  sizes.forEach((size, row) => {
    for (let column = 0; column < size; column++)
      spots.push({ row: row + 1, column: column + 1 });
  });
  return { columns: Math.max(1, ...sizes), spots };
}
