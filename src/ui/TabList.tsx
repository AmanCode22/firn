import { useCallback, useRef, useState } from 'react';
import type { TabView } from '../types';
import {
  BadgeMutedIcon,
  BadgeSoundIcon,
  GlobeIcon,
  MutedIcon,
  SoundIcon,
} from './icons';

export function TabIcon({ tab }: { tab: TabView }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (tab.isLoading) return <span className="tab-spinner" />;
  if (!tab.favicon || broken === tab.favicon) return <GlobeIcon />;
  return (
    <img
      className="tab-favicon"
      src={tab.favicon}
      alt=""
      draggable={false}
      onError={() => setBroken(tab.favicon)}
    />
  );
}

export function tabTitle(tab: TabView) {
  if (tab.title) return tab.title;
  if (!tab.url) return 'New tab';
  return tab.url.replace(/^https?:\/\/(www\.)?/i, '');
}

// The speaker on a tab playing sound (or muted): click to mute it, or to
// turn it back on. Shown only while there's something to hear or undo.
// `badge`: the small one in a Basecamp tile's corner (the tile is itself a
// button, so this one can't be).
export function TabSound({ tab, badge }: { tab: TabView; badge?: boolean }) {
  if (!tab.audible && !tab.muted) return null;
  const Tag = badge ? 'span' : 'button';
  const label = tab.muted ? 'Unmute tab' : 'Mute tab';
  return (
    <Tag
      className={`tab-sound ${badge ? 'is-badge' : ''} ${tab.muted ? 'is-muted' : ''}`}
      role={badge ? 'button' : undefined}
      title={label}
      // Its own name for screen readers, kept in step as it changes.
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        window.firn.toggleMute(tab.id);
      }}
    >
      {badge ? (
        tab.muted ? (
          <BadgeMutedIcon />
        ) : (
          <BadgeSoundIcon />
        )
      ) : tab.muted ? (
        <MutedIcon />
      ) : (
        <SoundIcon />
      )}
    </Tag>
  );
}

// Whether two views of a tab show the same thing. Every update from the
// main process brings a fresh copy of every tab, so the sidebar's rows
// compare what's in them, not which copy it is.
export function sameTab(a: TabView, b: TabView) {
  if (a === b) return true;
  for (const key of Object.keys(a) as (keyof TabView)[])
    if (a[key] !== b[key]) return false;
  return Object.keys(a).length === Object.keys(b).length;
}

// For memo(): a row redraws only when something it shows changed (its tab,
// a flag, or where it's nudged to), not on every update to other tabs.
// Handlers are passed in steady (see `useSteady`), so they compare equal.
export function sameRowProps(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const x = a[key];
    const y = b[key];
    if (key === 'tab') return sameTab(x as TabView, y as TabView);
    if (key === 'tabs')
      return (
        (x as TabView[]).length === (y as TabView[]).length &&
        (x as TabView[]).every((t, i) => sameTab(t, (y as TabView[])[i]))
      );
    if (key === 'style') return sameStyle(x, y);
    return x === y;
  });
}

const sameStyle = (x: unknown, y: unknown) => {
  if (x === y) return true;
  if (!x || !y) return false;
  const a = x as Record<string, unknown>;
  const b = y as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  );
};

// A handler that keeps the same identity across redraws but always runs
// the latest version (so rows can skip redrawing without holding on to an
// old one).
export function useSteady<A extends unknown[]>(handler: (...args: A) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  return useCallback((...args: A) => latest.current(...args), []);
}
