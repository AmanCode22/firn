// Windows: the installer's events. Firn's installer (Squirrel) starts Firn
// with one of these when it installs, updates, or uninstalls it, and waits
// for it to quit; nothing else runs then.
//
// Shortcuts: a Start menu entry only, made once on the first install (where
// Windows lists apps, and where people pin them to the taskbar or Start).
// No desktop shortcut, and updates never touch shortcuts, so one someone
// deleted or moved stays that way (the Start menu entry opens the small
// Firn.exe that always starts the newest version, so it never goes stale).
// Uninstalling removes both kinds (versions before 0.7.0 also made one on
// the desktop).
//
// Firn's place in the list of browsers is added and removed at the same
// moments (src/defaultBrowser.ts).
import { spawn } from 'node:child_process';
import path from 'node:path';

export type InstallerEvent =
  | '--squirrel-install'
  | '--squirrel-updated'
  | '--squirrel-uninstall'
  | '--squirrel-obsolete';

// What each installer event does: Firn's place among the browsers, and what
// the installer's tool (Update.exe) is asked to do with shortcuts (nothing,
// on an update).
export function installerSteps(
  event: string | undefined,
  exe: string,
): { browser?: 'register' | 'unregister'; updateTool?: string[] } | null {
  switch (event) {
    case '--squirrel-install':
      return {
        browser: 'register',
        updateTool: [
          `--createShortcut=${exe}`,
          '--shortcut-locations=StartMenu',
        ],
      };
    case '--squirrel-updated':
      return { browser: 'register' };
    case '--squirrel-uninstall':
      return {
        browser: 'unregister',
        updateTool: [
          `--removeShortcut=${exe}`,
          '--shortcut-locations=Desktop,StartMenu',
        ],
      };
    case '--squirrel-obsolete':
      return {};
    default:
      return null;
  }
}

// Handles an installer event, if Firn was started for one: true then, and
// Firn should quit right away.
export function handleInstallerEvent(browser: {
  register: () => void;
  unregister: () => void;
}): boolean {
  if (process.platform !== 'win32') return false;
  const steps = installerSteps(
    process.argv[1],
    path.basename(process.execPath),
  );
  if (!steps) return false;
  try {
    if (steps.browser) browser[steps.browser]();
    if (steps.updateTool)
      // The installer's own tool, beside the version folders.
      spawn(
        path.resolve(path.dirname(process.execPath), '..', 'Update.exe'),
        steps.updateTool,
        { detached: true, stdio: 'ignore' },
      ).unref();
  } catch {
    // Not worth failing an install over ("Make Firn default…" registers
    // Firn again).
  }
  return true;
}
