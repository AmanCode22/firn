// A saved file Firn can't read (damaged, or written by a newer Firn) is
// kept, not overwritten: Firn starts fresh, but first copies the file aside
// (session.json → session.json.unreadable-2026-10-13T18-02-11), so what was
// in it can still be recovered. No file at all (the first start) is fine.

import fs from 'node:fs';

export function keepUnreadable(file: string, error?: unknown) {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return;
  try {
    if (!fs.existsSync(file)) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const copy = `${file}.unreadable-${stamp}`;
    fs.copyFileSync(file, copy);
    console.error(`[Firn] Couldn't read ${file}; kept a copy at ${copy}`);
  } catch {
    // Nothing more to do: Firn starts fresh either way.
  }
}
