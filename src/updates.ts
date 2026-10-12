// Automatic updates, on Windows and macOS.
//
// How it works: an installed Firn asks update.electronjs.org (a free
// service run by the Electron project for open-source apps) whether
// Firn's GitHub releases have a newer version. It sends only Firn's
// version and the kind of computer (e.g. "win32-x64" or "darwin-arm64"),
// nothing about the person or what they browse. If there is one, it's
// downloaded quietly in the background (by Squirrel: the installer tool
// behind "Firn Setup.exe" on Windows, and macOS's own updater for apps
// like Firn); the next time Firn is opened, it's the new version. No
// questions, nothing to click.
//
// On a Mac, the download is the release's Mac zip: one app for Apple-chip
// and Intel Macs, attached under each kind's name
// ("Firn-darwin-arm64-<version>.zip" and "Firn-darwin-x64-<version>.zip",
// which the service matches to "darwin-arm64" and "darwin-x64"; its
// "-universal" name alone wasn't handed to either, so through 0.6.0 Macs
// didn't update). macOS only accepts it because it's signed with the same
// Developer ID as the Firn already there. Linux packages are updated by
// the system, so Linux is skipped.

import { app, autoUpdater } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateState } from './types';

const REPOSITORY = 'dwurgy/firn';
// Wait a little after Firn opens (the installer finishes its own work in
// the first seconds after an install), then look again every few hours.
const FIRST_CHECK_MS = 60 * 1000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// Where Firn asks: one address per version and kind of computer.
export const updateFeedUrl = (
  version: string,
  platform: string,
  arch: string,
) =>
  `https://update.electronjs.org/${REPOSITORY}/${platform}-${arch}/${version}`;

// Why this copy can't update itself, in plain words for Settings, or null
// if it can. On Windows, only a copy installed by "Firn Setup.exe" (it has
// the installer's Update.exe in the folder above it, not one unzipped by
// hand); on a Mac, only one in the Applications folder (macOS won't let an
// app opened straight from Downloads replace itself); never a copy run
// from the source code.
const whyNoUpdates = (): string | null => {
  if (!app.isPackaged)
    return 'Run from its source code, so it doesn’t update itself.';
  if (process.platform === 'win32')
    return fs.existsSync(
      path.join(path.dirname(process.execPath), '..', 'Update.exe'),
    )
      ? null
      : 'Not installed with Firn Setup, so it can’t update itself.';
  if (process.platform === 'darwin')
    return app.isInApplicationsFolder()
      ? null
      : 'Move Firn to your Applications folder to keep it up to date.';
  return 'Updated by your system’s software updates.';
};

// Where updates are, for Settings (which also offers "Check for updates"
// and, once a new version is ready, "Restart now").
let state: UpdateState = { status: 'idle' };
const listeners = new Set<(state: UpdateState) => void>();
const setState = (next: UpdateState) => {
  state = next;
  for (const listener of listeners) listener(state);
};
export const updateState = () => state;
export const onUpdateState = (listener: (state: UpdateState) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let checkNow = () => {};
let restartNow = () => {};
// "Check for updates" (not while a check or a download is under way, or
// once a new version is ready).
export const checkForUpdates = () => {
  if (['checking', 'downloading', 'ready', 'off'].includes(state.status))
    return;
  checkNow();
};
// "Restart now": Firn closes (saving everything, as always) and opens
// again as the new version.
export const installUpdate = () => {
  if (state.status === 'ready') restartNow();
};

export const startUpdates = (log: (message: string) => void) => {
  // (The checks pretend: a new version arrives a moment after asking.)
  if (process.env.FIRN_UPDATES_TEST === '1') {
    checkNow = () => {
      setState({ status: 'checking' });
      setTimeout(() => setState({ status: 'downloading' }), 400);
      setTimeout(() => setState({ status: 'ready' }), 800);
    };
    restartNow = () => log('updates: (pretend) restarting');
    return;
  }
  const why = whyNoUpdates();
  if (why) {
    log(`updates: off (${why})`);
    setState({ status: 'off', reason: why });
    return;
  }
  const feed = updateFeedUrl(app.getVersion(), process.platform, process.arch);
  autoUpdater.setFeedURL({ url: feed });
  log(`updates: asking ${feed}`);

  let timer: NodeJS.Timeout | undefined;
  const check = () => {
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      log(`updates: couldn't check (${String(error)})`);
      setState({ status: 'error' });
    }
  };
  checkNow = check;
  restartNow = () => autoUpdater.quitAndInstall();
  // No internet, or GitHub having a bad moment, isn't worth interrupting
  // anyone about: Settings says so quietly, and Firn tries again at the
  // next check.
  autoUpdater.on('error', (error) => {
    log(`updates: couldn't check (${error.message})`);
    if (state.status !== 'ready') setState({ status: 'error' });
  });
  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }));
  autoUpdater.on('update-not-available', () => {
    log('updates: up to date');
    setState({ status: 'up-to-date', checkedAt: Date.now() });
  });
  autoUpdater.on('update-available', () => {
    log('updates: downloading');
    setState({ status: 'downloading' });
  });
  autoUpdater.on('update-downloaded', (_event, _notes, name) => {
    // It's ready for the next time Firn opens; no need to keep asking.
    log(`updates: ${name || 'new version'} ready for the next start`);
    setState({ status: 'ready' });
    if (timer) clearInterval(timer);
  });

  setTimeout(() => {
    check();
    timer = setInterval(check, CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
};
