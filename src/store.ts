// Saves the session to disk and loads it back, so closing and reopening Firn
// brings everything back as it was. The file lives in Firn's own data folder
// (on Windows: %APPDATA%\Firn\session.json).
//
// Writes go to a temporary file first and are then swapped in, so a crash
// mid-write can never leave a half-written, unreadable session behind.

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { BASECAMP_MAX } from './tabs';
import type { SavedSession, SavedTab } from './types';
import { keepUnreadable } from './unreadable';

// Version 2 added Basecamp: version 1's pinned tabs (shown as a grid back
// then) become Basecamp, which is where that grid lives now.
const SESSION_VERSION = 2;

export const sessionPath = () =>
  path.join(app.getPath('userData'), 'session.json');

export function loadSession(): SavedSession | null {
  try {
    const data = JSON.parse(fs.readFileSync(sessionPath(), 'utf8'));
    if (!Array.isArray(data?.tabs)) {
      keepUnreadable(sessionPath());
      return null;
    }
    if (data.version === 1) {
      let room = BASECAMP_MAX;
      for (const tab of data.tabs as SavedTab[]) {
        if (tab.pinned && room > 0) {
          tab.pinned = false;
          tab.basecamp = true;
          room--;
        }
      }
    } else if (data.version !== SESSION_VERSION) {
      // (Written by a newer Firn, say: kept aside, not overwritten.)
      keepUnreadable(sessionPath());
      return null;
    }
    return { ...data, version: SESSION_VERSION } as SavedSession;
  } catch (error) {
    // No session yet (first run), or an unreadable file: start fresh (the
    // unreadable one kept aside).
    keepUnreadable(sessionPath(), error);
    return null;
  }
}

// What was last written (nothing changed: nothing to write).
let lastWritten = '';

export function saveSession(session: Omit<SavedSession, 'version'>) {
  const file = sessionPath();
  const temp = `${file}.tmp`;
  try {
    const text = JSON.stringify({ version: SESSION_VERSION, ...session });
    if (text === lastWritten) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
    lastWritten = text;
  } catch (error) {
    console.error('[Firn] Could not save the session:', error);
  }
}

// Collects many changes into one write a moment later, so busy moments
// (pages loading, tabs being dragged) don't write the file over and over.
// The first change starts the wait and later ones join it, so a save always
// comes within the delay, even while something keeps changing (a page
// whose title ticks every second used to put it off until Firn closed).
export class SaveScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private save: () => void,
    private delayMs = 800,
  ) {}

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  // Saves right away (e.g. when the window closes).
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.save();
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
