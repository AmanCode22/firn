// Firn's browsing history: the pages you've visited, kept in Firn's own data
// folder (history.json, next to the session) so the command bar can find a
// page again after its tab is gone. Only web pages are kept, at most
// MAX_ENTRIES of them (the least recently visited go first).

import fs from 'node:fs';
import path from 'node:path';
import { SaveScheduler } from './store';
import type { HistoryEntry } from './types';
import { keepUnreadable } from './unreadable';

const MAX_ENTRIES = 5000;
const DAY = 24 * 60 * 60 * 1000;

export class History {
  private entries = new Map<string, HistoryEntry>();
  private saver: SaveScheduler;

  constructor(private file: string) {
    this.load();
    this.saver = new SaveScheduler(() => this.save(), 2000);
  }

  // A page was visited (`newVisit`), or its title or icon became known.
  visit(url: string, title: string, favicon: string, newVisit: boolean) {
    if (!/^https?:\/\//i.test(url)) return;
    const entry = this.entries.get(url) ?? {
      url,
      title: '',
      favicon: '',
      visits: 0,
      lastVisit: 0,
    };
    if (title) entry.title = title;
    if (favicon) entry.favicon = favicon;
    if (newVisit) {
      entry.visits += 1;
      entry.lastVisit = Date.now();
    }
    // Most recent last, so the oldest are the first to go.
    this.entries.delete(url);
    this.entries.set(url, entry);
    while (this.entries.size > MAX_ENTRIES)
      this.entries.delete(this.entries.keys().next().value!);
    this.saver.schedule();
  }

  // The best matches for what was typed: every word has to appear in the
  // title or address. Pages visited often and recently come first, and
  // ones whose site name starts with what was typed are lifted.
  search(query: string, limit: number): HistoryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const now = Date.now();
    const scored: { entry: HistoryEntry; score: number }[] = [];
    for (const entry of this.entries.values()) {
      const text = `${entry.title} ${entry.url}`.toLowerCase();
      if (!words.every((word) => text.includes(word))) continue;
      const host = hostOf(entry.url);
      const days = (now - entry.lastVisit) / DAY;
      const score =
        Math.log2(1 + entry.visits) * 2 +
        Math.max(0, 6 - days / 5) +
        (host.startsWith(words[0]) ? 8 : 0) +
        (entry.title.toLowerCase().startsWith(words[0]) ? 3 : 0);
      scored.push({ entry, score });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry }) => entry);
  }

  // The history page's list: newest first, every word typed appearing in
  // the title or address (all of it when nothing's typed).
  list(query: string, limit: number): HistoryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found: HistoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.lastVisit) continue;
      const text = `${entry.title} ${entry.url}`.toLowerCase();
      if (words.every((word) => text.includes(word))) found.push(entry);
    }
    return found.sort((a, b) => b.lastVisit - a.lastVisit).slice(0, limit);
  }

  remove(url: string) {
    if (this.entries.delete(url)) this.saver.schedule();
  }

  // Forgets the pages visited since `since` (0: everything).
  clear(since: number) {
    for (const [url, entry] of this.entries)
      if (entry.lastVisit >= since) this.entries.delete(url);
    this.saver.schedule();
  }

  // Saves right away (when Firn closes).
  flush() {
    this.saver.flush();
  }

  private load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data?.entries)) return keepUnreadable(this.file);
      for (const entry of data.entries as HistoryEntry[])
        if (entry && typeof entry.url === 'string')
          this.entries.set(entry.url, entry);
    } catch (error) {
      // No history yet (first run), or an unreadable file: start fresh (the
      // unreadable one kept aside).
      keepUnreadable(this.file, error);
    }
  }

  private save() {
    const temp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        temp,
        JSON.stringify({ version: 1, entries: [...this.entries.values()] }),
      );
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.error('[Firn] Could not save history:', error);
    }
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}
