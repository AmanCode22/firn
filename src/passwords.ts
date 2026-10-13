// Saved passwords, kept in passwords.json next to the session. Each
// password is encrypted with the system's own protection (on Windows, the
// same one Chrome and Edge use, tied to your Windows account) before it's
// written; if that protection isn't available, nothing is saved at all.
// Only the site (e.g. "https://github.com"), the username and when it was
// last used are kept as they are.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SaveScheduler } from './store';
import type { SavedLogin } from './types';
import { keepUnreadable } from './unreadable';

// The encryption to use (given by the window code; see src/main.ts).
export interface Vault {
  available(): boolean;
  encrypt(text: string): string;
  decrypt(secret: string): string;
}

interface Entry {
  id: string;
  origin: string;
  username: string;
  // The encrypted password.
  secret: string;
  createdAt: number;
  lastUsedAt: number;
}

export class PasswordStore {
  private entries: Entry[] = [];
  private saver: SaveScheduler;

  constructor(
    private file: string,
    private vault: Vault,
  ) {
    this.load();
    this.saver = new SaveScheduler(() => this.write(), 300);
  }

  get canSave() {
    return this.vault.available();
  }

  // What's saved for a site: nothing, the same login, or the same username
  // with another password.
  compare(origin: string, username: string, password: string) {
    const entry = this.find(origin, username);
    if (!entry) return 'new';
    return this.reveal(entry.id) === password ? 'same' : 'changed';
  }

  // Saves a login (or updates the password of one saved before).
  save(origin: string, username: string, password: string) {
    if (!this.canSave) return false;
    const now = Date.now();
    const entry = this.find(origin, username);
    const secret = this.vault.encrypt(password);
    if (entry) {
      entry.secret = secret;
      entry.lastUsedAt = now;
    } else {
      this.entries.push({
        id: randomUUID(),
        origin,
        username,
        secret,
        createdAt: now,
        lastUsedAt: now,
      });
    }
    this.saver.schedule();
    return true;
  }

  // The login to fill on a site: the one used most recently.
  loginFor(origin: string) {
    const entry = this.entries
      .filter((e) => e.origin === origin)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    if (!entry) return null;
    const password = this.reveal(entry.id);
    if (password === null) return null;
    entry.lastUsedAt = Date.now();
    this.saver.schedule();
    return { username: entry.username, password };
  }

  // For the passwords panel: everything but the passwords.
  list(): SavedLogin[] {
    return this.entries
      .map(({ id, origin, username, lastUsedAt }) => ({
        id,
        origin,
        username,
        lastUsedAt,
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }

  reveal(id: string): string | null {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return null;
    try {
      return this.vault.decrypt(entry.secret);
    } catch {
      return null;
    }
  }

  remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.saver.schedule();
  }

  flush() {
    this.saver.flush();
  }

  private find(origin: string, username: string) {
    return this.entries.find(
      (e) => e.origin === origin && e.username === username,
    );
  }

  private load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data?.entries)) return keepUnreadable(this.file);
      this.entries = (data.entries as Entry[]).filter(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          typeof e.origin === 'string' &&
          typeof e.username === 'string' &&
          typeof e.secret === 'string',
      );
    } catch (error) {
      // No saved passwords yet (or an unreadable file, kept aside).
      keepUnreadable(this.file, error);
    }
  }

  private write() {
    const temp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(
        temp,
        JSON.stringify({ version: 1, entries: this.entries }),
        { mode: 0o600 },
      );
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.error('[Firn] Could not save passwords:', error);
    }
  }
}
