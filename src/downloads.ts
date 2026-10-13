// Firn's downloads: files save straight to the Downloads folder (like
// Chrome), a name that's taken gets " (1)", and the most recent ones are
// remembered in downloads.json next to the session, so the sidebar can show
// them and open them again.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EngineDownload } from './engine/engine';
import { SaveScheduler } from './store';
import type { Download } from './types';
import { keepUnreadable } from './unreadable';

const MAX_REMEMBERED = 30;
// Progress is passed on at most this often.
const PROGRESS_MS = 250;

export class Downloads {
  private list: Download[] = [];
  private items = new Map<string, EngineDownload>();
  private saver: SaveScheduler;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private file: string,
    private folder: () => string,
    private onChange: (downloads: Download[]) => void,
  ) {
    this.load();
    this.saver = new SaveScheduler(() => this.save(), 1000);
  }

  // A download is starting: choose where it goes and follow it.
  add(item: EngineDownload) {
    const savePath = this.freePath(item.suggestedName || 'download');
    item.setSavePath(savePath);
    const download: Download = {
      id: randomUUID(),
      url: item.url,
      name: path.basename(savePath),
      path: savePath,
      state: 'progress',
      received: 0,
      total: 0,
      startedAt: Date.now(),
    };
    this.list.unshift(download);
    this.list.length = Math.min(this.list.length, MAX_REMEMBERED);
    this.items.set(download.id, item);
    item.onProgress((received, total) => {
      download.received = received;
      download.total = total;
      this.changedSoon();
    });
    item.onDone((state) => {
      this.items.delete(download.id);
      download.state =
        state === 'completed'
          ? 'done'
          : state === 'cancelled'
            ? 'cancelled'
            : 'failed';
      if (state === 'completed')
        download.received = download.total || download.received;
      download.endedAt = Date.now();
      this.changed(true);
    });
    this.changed(true);
  }

  // Whether each finished file was still there when last looked at.
  private missing = new Map<string, boolean>();

  // The list for the UI, newest first. Finished files are looked for on
  // disk the first time, and again with `recheck` (Firn coming back to the
  // front, perhaps after one was moved or deleted, or a download starting
  // or ending), not on every update (a download in progress updates four
  // times a second).
  all(recheck = false): Download[] {
    return this.list.map((d) => {
      if (d.state !== 'done') return d;
      let missing = this.missing.get(d.id);
      if (recheck || missing === undefined) {
        missing = !fs.existsSync(d.path);
        this.missing.set(d.id, missing);
      }
      return { ...d, missing };
    });
  }

  get(id: string) {
    return this.list.find((d) => d.id === id);
  }

  cancel(id: string) {
    this.items.get(id)?.cancel();
  }

  // Takes it off the list (a finished file stays where it is; one still
  // downloading is stopped).
  remove(id: string) {
    this.cancel(id);
    this.list = this.list.filter((d) => d.id !== id);
    this.missing.delete(id);
    this.changed();
  }

  // Saves right away (when Firn closes).
  flush() {
    this.saver.flush();
  }

  // The file name in the Downloads folder, with " (1)", " (2)"... added if
  // a file (or a download in progress) already has it.
  private freePath(suggested: string) {
    const folder = this.folder();
    // Characters Windows doesn't allow in file names (and control characters).
    const clean = [...path.basename(suggested)]
      .map((c) => (/[<>:"/\\|?*]/.test(c) || c.charCodeAt(0) < 32 ? '_' : c))
      .join('');
    const ext = path.extname(clean);
    const stem = clean.slice(0, clean.length - ext.length) || 'download';
    const taken = (p: string) =>
      fs.existsSync(p) ||
      this.list.some((d) => d.state === 'progress' && d.path === p);
    let candidate = path.join(folder, clean);
    for (let n = 1; taken(candidate); n++)
      candidate = path.join(folder, `${stem} (${n})${ext}`);
    return candidate;
  }

  private changedSoon() {
    if (this.progressTimer) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      this.changed();
    }, PROGRESS_MS);
  }

  private changed(recheck = false) {
    this.onChange(this.all(recheck));
    this.saver.schedule();
  }

  private load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data?.downloads)) return keepUnreadable(this.file);
      this.list = (data.downloads as Download[])
        .filter(
          (d) => d && typeof d.id === 'string' && typeof d.path === 'string',
        )
        .slice(0, MAX_REMEMBERED)
        // Downloads that were still going when Firn closed didn't finish.
        .map((d) =>
          d.state === 'progress'
            ? { ...d, state: 'failed', endedAt: d.endedAt ?? Date.now() }
            : d,
        );
    } catch (error) {
      // No downloads yet, or an unreadable file: start fresh (the
      // unreadable one kept aside).
      keepUnreadable(this.file, error);
    }
  }

  private save() {
    const temp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const downloads = this.list.map((d) => {
        const saved = { ...d };
        delete saved.missing;
        return saved;
      });
      fs.writeFileSync(temp, JSON.stringify({ version: 1, downloads }));
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.error('[Firn] Could not save downloads:', error);
    }
  }
}
