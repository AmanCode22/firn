// What each site may use (camera, microphone, location, notifications,
// clipboard, opening other apps), as answered in Firn's prompt. Kept in
// permissions.json next to the session, on this computer only.

import fs from 'node:fs';
import path from 'node:path';
import type { PermissionKind } from './engine/engine';
import { SaveScheduler } from './store';
import { keepUnreadable } from './unreadable';

export type Decision = 'allow' | 'block';

// How each kind is described in prompts and menus.
export const PERMISSION_WORDING: Record<
  PermissionKind,
  { ask: (detail: string) => string; label: (detail: string) => string }
> = {
  camera: { ask: () => 'use your camera', label: () => 'Camera' },
  microphone: { ask: () => 'use your microphone', label: () => 'Microphone' },
  location: { ask: () => 'know your location', label: () => 'Location' },
  notifications: {
    ask: () => 'show notifications',
    label: () => 'Notifications',
  },
  clipboard: {
    ask: () => 'see text and images you copy',
    label: () => 'Clipboard',
  },
  external: {
    ask: (detail) => `open “${detail}” links in another app`,
    label: (detail) => `Open “${detail}” links`,
  },
};

// Decisions are stored per site under "kind" (or "external:zoommtg").
const keyOf = (kind: PermissionKind, detail: string) =>
  kind === 'external' ? `external:${detail}` : kind;

export function parseKey(key: string): {
  kind: PermissionKind;
  detail: string;
} {
  const [kind, ...rest] = key.split(':');
  return { kind: kind as PermissionKind, detail: rest.join(':') };
}

export class SitePermissions {
  private sites = new Map<string, Record<string, Decision>>();
  private saver: SaveScheduler;

  constructor(private file: string) {
    this.load();
    this.saver = new SaveScheduler(() => this.save(), 500);
  }

  get(origin: string, kind: PermissionKind, detail = ''): Decision | undefined {
    return this.sites.get(origin)?.[keyOf(kind, detail)];
  }

  set(
    origin: string,
    kind: PermissionKind,
    detail: string,
    decision: Decision,
  ) {
    if (!origin) return;
    const site = this.sites.get(origin) ?? {};
    site[keyOf(kind, detail)] = decision;
    this.sites.set(origin, site);
    this.saver.schedule();
  }

  // Everything decided for a site, by key.
  of(origin: string): Record<string, Decision> {
    return { ...this.sites.get(origin) };
  }

  forgetAll() {
    this.sites.clear();
    this.saver.schedule();
  }

  forget(origin: string) {
    if (this.sites.delete(origin)) this.saver.schedule();
  }

  flush() {
    this.saver.flush();
  }

  private load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [origin, site] of Object.entries(data?.sites ?? {})) {
        if (!site || typeof site !== 'object') continue;
        const clean: Record<string, Decision> = {};
        for (const [key, value] of Object.entries(site))
          if (value === 'allow' || value === 'block') clean[key] = value;
        this.sites.set(origin, clean);
      }
    } catch (error) {
      // Nothing decided yet, or an unreadable file: start fresh (the
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
        JSON.stringify({ version: 1, sites: Object.fromEntries(this.sites) }),
      );
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.error('[Firn] Could not save site permissions:', error);
    }
  }
}
