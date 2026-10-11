// Firn's few settings, kept in settings.json next to the session. Only what
// a normal person might want to change; everything else Firn decides.

import fs from 'node:fs';
import path from 'node:path';
import { SEARCH_ENGINES, type SearchEngine } from './url';
import { ARCHIVE_CHOICES, type ArchiveAfter } from './archive';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'duckduckgo',
  theme: 'system',
  downloadsFolder: '',
  addressBar: 'sidebar',
  safeBrowsing: true,
  adBlocking: true,
  adsAllowedSites: [],
  onboarded: false,
  lastVersion: '',
  archiveAfter: 7,
};

export function loadSettings(file: string): Settings {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cleanSettings(data, DEFAULT_SETTINGS);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// `changes` applied to `current`, keeping only values that make sense.
export function cleanSettings(changes: unknown, current: Settings): Settings {
  const c = (changes && typeof changes === 'object' ? changes : {}) as Record<
    string,
    unknown
  >;
  return {
    searchEngine:
      typeof c.searchEngine === 'string' && c.searchEngine in SEARCH_ENGINES
        ? (c.searchEngine as SearchEngine)
        : current.searchEngine,
    theme:
      c.theme === 'system' || c.theme === 'light' || c.theme === 'dark'
        ? c.theme
        : current.theme,
    downloadsFolder:
      typeof c.downloadsFolder === 'string'
        ? c.downloadsFolder
        : current.downloadsFolder,
    addressBar:
      c.addressBar === 'sidebar' || c.addressBar === 'top'
        ? c.addressBar
        : current.addressBar,
    safeBrowsing:
      typeof c.safeBrowsing === 'boolean'
        ? c.safeBrowsing
        : current.safeBrowsing,
    adBlocking:
      typeof c.adBlocking === 'boolean' ? c.adBlocking : current.adBlocking,
    adsAllowedSites: Array.isArray(c.adsAllowedSites)
      ? [
          ...new Set(
            c.adsAllowedSites
              .filter((site): site is string => typeof site === 'string')
              .map((site) => site.trim().toLowerCase())
              .filter(Boolean),
          ),
        ].slice(0, 1000)
      : current.adsAllowedSites,
    onboarded:
      typeof c.onboarded === 'boolean' ? c.onboarded : current.onboarded,
    lastVersion:
      typeof c.lastVersion === 'string' ? c.lastVersion : current.lastVersion,
    archiveAfter: ARCHIVE_CHOICES.includes(c.archiveAfter as ArchiveAfter)
      ? (c.archiveAfter as ArchiveAfter)
      : current.archiveAfter,
  };
}

export function saveSettings(file: string, settings: Settings) {
  const temp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ version: 1, ...settings }));
    fs.renameSync(temp, file);
  } catch (error) {
    console.error('[Firn] Could not save settings:', error);
  }
}
