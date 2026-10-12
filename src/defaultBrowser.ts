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
// PDFs and images get their own names in Windows' lists ("Firn web page"
// would read oddly beside a PDF).
const PDF_PROG_ID = 'FirnPDF';
const IMAGE_PROG_ID = 'FirnImage';

// The files Firn can be offered for, as Chrome and Edge are: web pages,
// PDFs (Firn's PDF viewer), and the web's own image kinds. Offered only:
// Windows and macOS keep whatever opens them now unless the person picks
// Firn.
export const WEB_FILE_TYPES = {
  page: ['.htm', '.html', '.shtml', '.xht', '.xhtml'],
  pdf: ['.pdf'],
  image: ['.svg', '.webp'],
};
const WEB_FILE = new RegExp(
  `(${Object.values(WEB_FILE_TYPES)
    .flat()
    .map((e) => `\\${e}`)
    .join('|')})$`,
  'i',
);
export const isWebFile = (file: string) => WEB_FILE.test(file);
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

// One registry value: the reg tool's arguments to set it.
const regValue = (key: string, name: string | null, value: string) => [
  'add',
  `HKCU\\${key}`,
  ...(name === null ? ['/ve'] : ['/v', name]),
  '/d',
  value,
  '/f',
];

// What lists Firn among the browsers Windows offers, value by value.
function browserRegistration(): string[][] {
  const launcher = windowsLauncher();
  const icon = `"${launcher}",0`;
  const open = `"${launcher}" "%1"`;
  const values: string[][] = [];
  const set = (key: string, name: string | null, value: string) =>
    values.push(regValue(key, name, value));
  // What opens links, pages, PDFs, and images "with Firn".
  for (const [id, name] of [
    [PROG_ID, 'Firn web page'],
    [PDF_PROG_ID, 'Firn PDF document'],
    [IMAGE_PROG_ID, 'Firn image'],
  ]) {
    set(`${CLASSES}\\${id}`, null, name);
    set(`${CLASSES}\\${id}\\DefaultIcon`, null, icon);
    set(`${CLASSES}\\${id}\\shell\\open\\command`, null, open);
  }
  set(`${CLASSES}\\${PROG_ID}`, 'URL Protocol', '');
  // Firn, the browser.
  set(CLIENT, null, 'Firn');
  set(`${CLIENT}\\DefaultIcon`, null, icon);
  set(`${CLIENT}\\shell\\open\\command`, null, `"${launcher}"`);
  const capabilities = `${CLIENT}\\Capabilities`;
  set(capabilities, 'ApplicationName', 'Firn');
  set(capabilities, 'ApplicationDescription', 'A calm browser.');
  set(capabilities, 'ApplicationIcon', icon);
  for (const scheme of ['http', 'https'])
    set(`${capabilities}\\URLAssociations`, scheme, PROG_ID);
  const files: [string[], string][] = [
    [WEB_FILE_TYPES.page, PROG_ID],
    [WEB_FILE_TYPES.pdf, PDF_PROG_ID],
    [WEB_FILE_TYPES.image, IMAGE_PROG_ID],
  ];
  for (const [extensions, id] of files)
    for (const extension of extensions)
      set(`${capabilities}\\FileAssociations`, extension, id);
  set(REGISTERED, 'Firn', capabilities);
  return values;
}

// Lists Firn among the browsers (the installer, which waits for it).
export function registerWindowsBrowser() {
  for (const args of browserRegistration()) reg(...args);
}

// The same without holding Firn up (about 25 writes, each its own little
// program): "Make Firn default…" stays responsive.
function registerWindowsBrowserQuietly(): Promise<void> {
  return browserRegistration().reduce(
    (done, args) =>
      done.then(
        () =>
          new Promise<void>((resolve, reject) =>
            execFile('reg', args, { windowsHide: true }, (error) =>
              error ? reject(error) : resolve(),
            ),
          ),
      ),
    Promise.resolve(),
  );
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
  for (const id of [PROG_ID, PDF_PROG_ID, IMAGE_PROG_ID])
    remove(`HKCU\\${CLASSES}\\${id}`);
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
  // (Settings opens either way; Firn may well be listed already.)
  void registerWindowsBrowserQuietly()
    .catch(() => {})
    .then(() =>
      shell.openExternal('ms-settings:defaultapps?registeredAppUser=Firn'),
    );
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
    if (isWebFile(arg) && path.isAbsolute(arg) && fs.existsSync(arg))
      links.push(pathToFileURL(arg).href);
  }
  return links;
}
