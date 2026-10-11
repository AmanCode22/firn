// Archiving old tabs: everyday tabs not looked at for a while tidy
// themselves away into the Archive (Firn menu, command bar), where any of
// them can be brought back. Settings decides how long: 1, 7 (the default),
// or 30 days, or never.
//
// Days are the days Firn was used, not calendar days, so a week away
// doesn't empty the sidebar: Firn notes each day it's open (`daysUsed`, in
// the session), and a tab is old once Firn has been used on that many days
// since the day it was last looked at.
//
// What's never archived is decided in src/tabs.ts (archiveOld): pinned and
// Basecamp tabs, the tab on screen and each space's current tab, a tab
// playing sound, and a tab in split view.

// How many days of use before a tab is archived (0: never).
export type ArchiveAfter = 0 | 1 | 7 | 30;
export const ARCHIVE_CHOICES: ArchiveAfter[] = [1, 7, 30, 0];

// The days kept (enough for the longest choice, with room to spare).
const DAYS_KEPT = 60;

// A day as Firn counts it: this computer's own date, e.g. "2026-10-11".
export function dayOf(time: number) {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The days Firn was used, with `now`'s day added (oldest first, the last
// DAYS_KEPT only).
export function noteDayUsed(days: readonly string[], now: number): string[] {
  const today = dayOf(now);
  const all = [...new Set([...days, today])]
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today)
    .sort();
  return all.slice(-DAYS_KEPT);
}

// Whether a tab last looked at `lastActiveAt` is old enough to archive:
// Firn has been used on `after` days since that day.
export function isOld(
  lastActiveAt: number,
  daysUsed: readonly string[],
  after: ArchiveAfter,
): boolean {
  if (!after) return false;
  const seen = dayOf(lastActiveAt);
  return daysUsed.filter((day) => day > seen).length >= after;
}
