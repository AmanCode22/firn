// Firn as the default browser: links clicked in other apps (mail, chat,
// documents) open in Firn's normal window, as a new tab.
//
// For that, the system has to know Firn is a browser:
// - macOS: Firn's Info.plist says it opens http and https links and web
//   pages (forge.config.mts), and asking to be the default shows macOS's
//   own "Use Firn as your default browser?" question.
// - Windows: a few entries in the person's part of the registry (no
//   administrator needed) list Firn among the browsers in Settings > Apps >
//   Default apps. Firn's installer adds them on install and update, and
//   removes them on uninstall. Windows doesn't let any app make itself the
//   default (so no app can sneakily take over), so "Make Firn default…"
//   opens that Settings page at Firn, and the person picks it there.
// Linux isn't offered (its packages are set up by the system).

import { app, shell } from 'electron';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Windows: the names Firn registers under.
const PROG_ID = 'FirnURL';
const CLIENT = String.raw`Software\Clients\StartMenuInternet\Firn`;
const CLASSES = String.raw`Software\Classes`;
const REGISTERED = String.raw`Software\RegisteredApplications`;
// The settings key of the person's actual choice for https links.
const HTTPS_CHOICE = String.raw`HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice`;

export type DefaultBrowserState = 'yes' | 'no' | 'unavailable';

// Automated tests only: pretend this copy can be the default (and isn't,
// until asked), since the checks run on Linux.
let testState = process.env.FIRN_DEFAULT_BROWSER_TEST as
  | DefaultBrowserState
  | undefined;

// --- Windows registration --------------------------------------------------

// The installer's launcher (one folder above the versioned app folder), so
// links keep working after updates, which move the app to a new folder.
const windowsLauncher = () =>
  path.join(path.dirname(path.dirname(process.execPath)), 'Firn.exe');

const reg = (...args: string[]) =>
  execFileSync('reg', args, { stdio: 'ignore', windowsHide: true });

const regSet = (key: string, name: string | null, value: string) =>
  reg(
    'add',
    `HKCU\\${key}`,
    ...(name === null ? ['/ve'] : ['/v', name]),
    '/d',
    value,
    '/f',
  );

// Lists Firn among the browsers Windows offers (done by the installer, and
// again before asking, in case it was undone). Quick: about a dozen
// registry writes.
export function registerWindowsBrowser() {
  const launcher = windowsLauncher();
  const icon = `"${launcher}",0`;
  const open = `"${launcher}" "%1"`;
  // What opens links and pages "with Firn".
  regSet(`${CLASSES}\\${PROG_ID}`, null, 'Firn web page');
  regSet(`${CLASSES}\\${PROG_ID}`, 'URL Protocol', '');
  regSet(`${CLASSES}\\${PROG_ID}\\DefaultIcon`, null, icon);
  regSet(`${CLASSES}\\${PROG_ID}\\shell\\open\\command`, null, open);
  // Firn, the browser.
  regSet(CLIENT, null, 'Firn');
  regSet(`${CLIENT}\\DefaultIcon`, null, icon);
  regSet(`${CLIENT}\\shell\\open\\command`, null, `"${launcher}"`);
  const capabilities = `${CLIENT}\\Capabilities`;
  regSet(capabilities, 'ApplicationName', 'Firn');
  regSet(capabilities, 'ApplicationDescription', 'A calm browser.');
  regSet(capabilities, 'ApplicationIcon', icon);
  for (const scheme of ['http', 'https'])
    regSet(`${capabilities}\\URLAssociations`, scheme, PROG_ID);
  for (const extension of ['.htm', '.html'])
    regSet(`${capabilities}\\FileAssociations`, extension, PROG_ID);
  regSet(REGISTERED, 'Firn', capabilities);
}

// Takes it all away again (when Firn is uninstalled).
export function unregisterWindowsBrowser() {
  const remove = (...args: string[]) => {
    try {
      reg('delete', ...args, '/f');
    } catch {
      // Already gone.
    }
  };
  remove(`HKCU\\${REGISTERED}`, '/v', 'Firn');
  remove(`HKCU\\${CLIENT}`);
  remove(`HKCU\\${CLASSES}\\${PROG_ID}`);
}

// --- Is Firn the default? ----------------------------------------------------

// Whether this copy can be the default: an installed Windows copy, or a Mac
// copy in the Applications folder (macOS ignores apps run from elsewhere).
const canBeDefault = () => {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32')
    return fs.existsSync(
      path.join(path.dirname(path.dirname(process.execPath)), 'Update.exe'),
    );
  if (process.platform === 'darwin') return app.isInApplicationsFolder();
  return false;
};

export function defaultBrowserState(): Promise<DefaultBrowserState> {
  if (testState) return Promise.resolve(testState);
  if (!canBeDefault()) return Promise.resolve('unavailable');
  if (process.platform === 'darwin')
    return Promise.resolve(app.isDefaultProtocolClient('https') ? 'yes' : 'no');
  // Windows: the person's own choice for https links.
  return new Promise((resolve) =>
    execFile(
      'reg',
      ['query', HTTPS_CHOICE, '/v', 'ProgId'],
      { windowsHide: true },
      (error, stdout) =>
        resolve(!error && stdout.includes(PROG_ID) ? 'yes' : 'no'),
    ),
  );
}

// "Make Firn default…": macOS asks the person itself; Windows opens its
// Default apps settings at Firn.
export function askToBeDefault() {
  if (testState) {
    testState = 'yes';
    return;
  }
  if (!canBeDefault()) return;
  if (process.platform === 'darwin') {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
    return;
  }
  try {
    registerWindowsBrowser();
  } catch {
    // Still open the settings; Firn may well be listed already.
  }
  void shell.openExternal('ms-settings:defaultapps?registeredAppUser=Firn');
}

// --- Links from other apps -------------------------------------------------

// What another app asked Firn to open, from its command line (Windows) as
// a web address, or a web page file. Anything else is ignored.
export function linksFromArguments(argv: string[]): string[] {
  const links: string[] = [];
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (/^https?:\/\//i.test(arg)) {
      links.push(arg);
      continue;
    }
    if (/\.html?$/i.test(arg) && path.isAbsolute(arg) && fs.existsSync(arg))
      links.push(pathToFileURL(arg).href);
  }
  return links;
}
