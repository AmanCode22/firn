// Dragging between Basecamp and a space's tabs (src/ui/Basecamp.tsx and
// src/ui/SpaceTabs.tsx): a tab dragged up out of the tab list can join
// Basecamp, and a tile dragged down out of Basecamp can become a pinned or
// everyday tab. Each side registers how it answers "where would this land?"
// and shows the gap it would land in; the side the drag started from asks
// the other. One sidebar per page, so one of each.

// Where a dragged tile would land among the tabs.
export interface TabsDrop {
  pinned: boolean;
  index: number; // within the pinned or everyday tabs
  slot: number; // position among the list's rows (for the gap)
}

interface BasecampTarget {
  // Where a tab at this point would join Basecamp (null: it can't, e.g.
  // Basecamp is full).
  indexAt(x: number, y: number): number | null;
  // Opens a spot for it (null: closes it).
  show(incoming: { id: string; index: number } | null): void;
}

interface TabsTarget {
  // Where a tile at this point would land among the tabs (null: not over
  // the tab list).
  dropAt(x: number, y: number): TabsDrop | null;
  // Opens a gap for it (null: closes it).
  show(drop: TabsDrop | null): void;
  // The tab list's top edge: above it is Basecamp.
  top(): number;
}

let basecamp: BasecampTarget | null = null;
let tabs: TabsTarget | null = null;

export function setBasecampTarget(target: BasecampTarget | null) {
  basecamp = target;
}

export function setTabsTarget(target: TabsTarget | null) {
  tabs = target;
}

export const basecampTarget = () => basecamp;
export const tabsTarget = () => tabs;
