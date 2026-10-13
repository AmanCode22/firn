// Dragging a tab out of the sidebar onto the page opens it in split view
// (see "Dragging a tab into split view" in src/tabs.ts). The sidebar's
// drags (tabs, and Basecamp tiles) use this to tell when the pointer has
// left the sidebar for the page, and to report it.

// How far past the sidebar's edge the pointer goes before it counts as
// over the page (so a drag that just brushes the edge stays a reorder).
const PAST_EDGE = 16;

// The sidebar's right edge, at rest (not where it's drawn: the peeking
// sidebar slides out of the way while a tab is over the page).
export function sidebarEdge(from: Element | null) {
  const sidebar = from?.closest<HTMLElement>('.sidebar');
  return sidebar ? sidebar.offsetLeft + sidebar.offsetWidth : null;
}

// Whether the pointer is over the page; if so, Firn is told where.
export function dragOverPage(
  e: { clientX: number },
  tabId: string,
  from: Element | null,
) {
  const edge = sidebarEdge(from);
  if (edge === null) return false;
  const over = e.clientX > edge + PAST_EDGE;
  if (over) window.firn.dragToSplit(tabId, e.clientX);
  return over;
}

// A tab pulled sideways this far out of its place is carried: it leaves
// the sidebar (which is drawn behind the page) for the floating layer,
// and stays under the pointer, in front of the page, until it's let go.
// Its place in the sidebar waits for it, faded.
export const CARRY_AFTER = 16;

// What's needed to carry it: where it was grabbed, and where it's drawn
// now (`box`, in this layer); `tile`: drawn as a Basecamp tile.
export function carry(
  e: { clientX: number; clientY: number },
  tabId: string,
  grab: { x: number; y: number; width: number },
  box: { left: number; top: number },
  tile = false,
) {
  window.firn.carryTab({
    tile,
    tabId,
    x: e.clientX,
    y: e.clientY,
    grabX: grab.x,
    grabY: grab.y,
    width: grab.width,
    fromX: box.left,
    fromY: box.top,
  });
}
