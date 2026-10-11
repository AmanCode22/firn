// The demo profile's starting point, written in Firn's own formats: the
// session (src/store.ts: SavedSession, version 2) and the settings
// (src/settings.ts). Nothing here is a format of its own.

import fs from 'node:fs';
import path from 'node:path';
import { PROFILE, ROOT } from './firn.mjs';

const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).version;

// Firn's space colors (SPACE_COLOR_CHOICES in src/welcome.ts) and icons
// (SPACE_ICON_NAMES in src/spaceIcons.ts).
const GLACIER = '#7f9cb0';
const SAGE = '#8fae8b';
const SAND = '#c9a27e';

// David's picks from the try-pages contact sheet: pages with color and
// imagery (Wikipedia's white was too much), no pop-ups.
export const SPACES = [
  {
    id: 'demo-personal',
    name: 'Personal',
    icon: 'home',
    color: GLACIER,
    tabs: [
      'https://firnbrowser.com/',
      'https://www.metmuseum.org/art/collection/search/436535',
      'https://culturedcode.com/things/',
    ],
  },
  {
    id: 'demo-work',
    name: 'Work',
    icon: 'work',
    color: SAGE,
    tabs: [
      'https://linear.app/',
      'https://twks.ch/en',
      'https://stripe.com/',
      'https://www.raycast.com/',
    ],
  },
  {
    id: 'demo-weekend',
    name: 'Weekend',
    icon: 'mountain',
    color: SAND,
    tabs: [
      'https://agnestoth.com/',
      'https://crl-2026.webflow.io/',
      'https://www.nts.live/',
      'https://www.apple.com/macbook-air/',
    ],
  },
];

export const BASECAMP = [
  'https://firnbrowser.com/release-notes',
  'https://mijobello.com/',
  'https://culturedcode.com/things/',
];

// A fixed clock for the seeded tabs, so every run starts the same.
const T0 = Date.UTC(2026, 0, 1);

export const tabId = (spaceIndex, tabIndex) => `demo-${spaceIndex}-${tabIndex}`;
export const basecampId = (index) => `demo-basecamp-${index}`;

// Firn's settings: light, the welcome done, and this version already
// seen (so What's new stays away). `onboarded: false` for the welcome.
export function writeSettings({ onboarded = true } = {}) {
  write('settings.json', {
    version: 1,
    searchEngine: 'duckduckgo',
    theme: 'light',
    downloadsFolder: '',
    addressBar: 'sidebar',
    safeBrowsing: true,
    adBlocking: true,
    adsAllowedSites: [],
    onboarded,
    lastVersion: VERSION,
  });
}

// The three spaces, their tabs, and Basecamp (`withTabs: false`: the
// spaces alone).
// (`spaces` and `basecamp`: others than the demo's own, e.g. the pages
// to try, demo/try-pages.mjs.)
export function writeSession({
  withTabs = true,
  spaces = SPACES,
  basecamp = BASECAMP,
} = {}) {
  const tabs = [];
  if (withTabs) {
    basecamp.forEach((url, i) =>
      tabs.push(tab(basecampId(i), spaces[0].id, url, i, { basecamp: true })),
    );
    spaces.forEach((space, s) =>
      space.tabs.forEach((url, i) =>
        // Earlier tabs count as more recent, so each space opens on its
        // first tab.
        tabs.push(
          tab(tabId(s, i), space.id, url, i, { recency: 100 - s * 10 - i }),
        ),
      ),
    );
  }
  write('session.json', {
    version: 2,
    spaces: spaces.map(({ id, name, icon, color }, order) => ({
      id,
      name,
      icon,
      color,
      order,
    })),
    tabs,
    splits: [],
    window: {
      id: '1',
      activeSpaceId: spaces[0].id,
      activeTabId: withTabs ? tabId(0, 0) : null,
      sidebarWidth: 260,
      sidebarCollapsed: false,
    },
    recentlyClosed: [],
  });
}

function tab(id, spaceId, url, order, { basecamp = false, recency = 0 } = {}) {
  return {
    id,
    spaceId,
    url,
    title: '',
    favicon: '',
    pinned: false,
    ...(basecamp && { basecamp: true }),
    order,
    lastActiveAt: T0 + recency * 60_000,
  };
}

function write(name, data) {
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(path.join(PROFILE, name), JSON.stringify(data));
}
