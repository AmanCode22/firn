// Building and starting Firn for the demo, with its throwaway profile.
//
// Firn runs from the source code here, the way the end-to-end checks run
// it: a packaged Firn has Electron's debugging hook turned off (see the
// fuses in forge.config.mts), so the demo couldn't drive it.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { installDriver } from './director.mjs';
import { launchElectron } from './electron.mjs';

const require = createRequire(import.meta.url);

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const DEMO_DIR = path.join(ROOT, 'demo');
export const PROFILE = path.join(DEMO_DIR, '.profile');
const BUILD = path.join(ROOT, '.vite/build');
const DEV_SERVER = 'http://localhost:5173/';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Switches for the demo's Electron. On a Mac, Chromium keeps the key that
// protects cookies and saved passwords in the Keychain, and a Firn run
// from source can make macOS ask for your password to read it (a prompt
// that may hide behind other windows, with Firn frozen until it's
// answered). The throwaway demo profile has nothing to protect, so it
// uses Chromium's stand-in instead of the Keychain.
const ELECTRON_SWITCHES =
  process.platform === 'darwin'
    ? ['--use-mock-keychain']
    : process.platform === 'linux'
      ? ['--no-sandbox']
      : [];

// What every Firn the demo starts gets: demo mode (src/demo.ts) and the
// throwaway profile.
export const demoEnv = (extra = {}) => ({
  ...process.env,
  FIRN_DEMO: '1',
  FIRN_DEMO_PROFILE: PROFILE,
  ...extra,
});

// A Firn that's already open would share the screen (and could sit over
// the window being recorded). Returns a description of it, or ''.
export function runningFirn() {
  const patterns = [
    // An installed Firn (macOS, then Windows/Linux packages).
    'Firn.app/Contents/MacOS/Firn',
    '/Firn$',
    // Firn running from this source folder (npm start).
    `${ROOT}/node_modules/electron`,
    'electron-forge start',
  ];
  for (const pattern of patterns) {
    try {
      const found = execFileSync('pgrep', ['-fl', pattern], {
        encoding: 'utf8',
      }).trim();
      if (found) return found.split('\n')[0];
    } catch {
      // pgrep found nothing.
    }
  }
  return '';
}

// Stops every Electron started from this folder (the demo's own Firns,
// and the one Electron Forge opens while building) and waits until
// they're gone. (On a Mac, Electron can outlive the process that started
// it; a leftover copy would make the next one close at once, since only
// one Firn runs per profile.) Safe: the demo refuses to start while any
// such Firn is open, so these are all the demo's.
// A process that has ended but not been tidied away yet ("defunct"):
// nothing to stop.
const exited = (pid) => {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    })
      .trim()
      .startsWith('Z');
  } catch {
    return true;
  }
};

export async function stopStrayFirns() {
  const find = () => {
    try {
      return execFileSync(
        'pgrep',
        ['-f', `${ROOT}/node_modules/electron/dist`],
        { encoding: 'utf8' },
      )
        .split('\n')
        .map(Number)
        .filter((pid) => pid && pid !== process.pid && !exited(pid));
    } catch {
      return []; // none
    }
  };
  for (const [signal, ms] of [
    ['SIGTERM', 5000],
    ['SIGKILL', 3000],
  ]) {
    let pids = find();
    if (!pids.length) return;
    for (const pid of pids) {
      try {
        const what = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
          encoding: 'utf8',
        }).trim();
        console.log(
          `[demo]   stopping a leftover Firn (${pid}: ${what.slice(-80)})`,
        );
      } catch {
        // Gone already.
      }
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
    for (let waited = 0; waited < ms && pids.length; waited += 200) {
      await wait(200);
      pids = find();
    }
  }
}

// Starts a command in its own process group, so it can be stopped with
// everything it started.
function startGroup(command, args, options) {
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function stopGroup(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 30 && child.exitCode === null; i++) await wait(100);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

const builtAfter = (since) =>
  ['main.cjs', 'preload.cjs', 'page-preload.cjs'].every((name) => {
    try {
      return fs.statSync(path.join(BUILD, name)).mtimeMs > since;
    } catch {
      return false;
    }
  });

// Builds Firn's main process (Electron Forge, as `npm start` does), then
// stops the copy Forge opens. That copy is already in demo mode, so it
// only ever sees the throwaway profile.
export async function buildFirn(log) {
  const since = Date.now();
  log('Building Firn…');
  const forge = startGroup(
    'npx',
    ['electron-forge', 'start', '--', ...ELECTRON_SWITCHES],
    {
      env: demoEnv(),
    },
  );
  const deadline = Date.now() + 180_000;
  while (!builtAfter(since)) {
    if (forge.exitCode !== null)
      throw new Error('Electron Forge stopped before Firn was built.');
    if (Date.now() > deadline) throw new Error('Building Firn took too long.');
    await wait(250);
  }
  await wait(1500);
  await stopGroup(forge);
  await stopStrayFirns();
}

// Serves Firn's interface (the sidebar and panels) on this computer.
// Builds Firn's interface (the sidebar and panels) the way a release
// does, and serves those finished files on this computer, where the Firn
// built above looks for them. (Not Vite's development server: on a fresh
// Mac it can stall while it prepares things, leaving a window waiting.)
export async function startDevServer(log) {
  const taken = await fetch(DEV_SERVER, { signal: AbortSignal.timeout(2000) })
    .then(() => true)
    .catch(() => false);
  if (taken)
    throw new Error(
      'Something is already using port 5173 (maybe `npm start`). Quit it and run the demo again.',
    );
  log('Starting Firn’s interface…');
  const out = path.join(ROOT, '.vite', 'demo-ui');
  await new Promise((resolve, reject) => {
    const build = spawn(
      'npx',
      [
        'vite',
        'build',
        '--config',
        'vite.renderer.config.mts',
        '--outDir',
        out,
        '--emptyOutDir',
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let said = '';
    build.stdout.on('data', (c) => (said += c));
    build.stderr.on('data', (c) => (said += c));
    build.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Building Firn’s interface failed:\n${said.slice(-1500)}`,
            ),
          ),
    );
  });
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.json': 'application/json',
  };
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', DEV_SERVER);
    let file = path.join(out, decodeURIComponent(pathname));
    if (
      !file.startsWith(out) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    )
      file = path.join(out, 'index.html');
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // (Every address, so "localhost" works whichever way it resolves.)
    server.listen(5173, resolve);
  });
  return {
    stop: () => new Promise((resolve) => server.close(() => resolve())),
    alive: async () => true,
  };
}

export function wipeProfile() {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10 });
  fs.mkdirSync(PROFILE, { recursive: true });
}

// Starts Firn in demo mode and waits for its window and layers.
export async function launchFirn({ glass }) {
  await stopStrayFirns();
  const app = await launchElectron({
    executablePath: require('electron'),
    args: [...ELECTRON_SWITCHES, '.'],
    cwd: ROOT,
    env: demoEnv(glass ? {} : { FIRN_NO_GLASS: '1' }),
  });
  await installDriver(app);
  // What's ready so far: the window, its sidebar, and the floating panels.
  const progress = () =>
    app.evaluate(async () => {
      const drive = globalThis.__demoDrive;
      const layers = drive.layers();
      const floating = layers.find((l) => l.url.includes('view=floating'));
      const has = async (layer, selector) =>
        !!layer &&
        (await drive.js(
          layer.id,
          `!!document.querySelector(${JSON.stringify(selector)})`,
          2000,
        )) === true;
      return {
        window: layers.length > 0,
        url: layers[0]?.url ?? '',
        sidebar: await has(layers[0], '[data-testid="new-tab"]'),
        panels: await has(floating, '#root'),
      };
    });
  // The first start on a computer can take a while: Firn's interface is
  // prepared for the first time.
  let last = { window: false, sidebar: false, panels: false };
  for (let i = 0; i < 1200; i++) {
    if (app.ended()) {
      saveLog(app);
      throw new Error(
        'Firn closed right after starting (see demo/out/firn-log.txt). Run the demo again; if it keeps happening, send Claude what Terminal shows.',
      );
    }
    last = await progress().catch((error) => ({
      ...last,
      error: String(error?.message ?? error)
        .split('\n')[0]
        .slice(0, 200),
    }));
    // (Every 15 seconds, so a slow start doesn't look frozen.)
    if (i && i % 150 === 0)
      console.log(
        `[demo]   still opening (${i / 10}s; window ${last.window ? `yes, showing ${last.url || 'nothing yet'}` : 'no'}, sidebar ${last.sidebar ? 'yes' : 'no'}, panels ${last.panels ? 'yes' : 'no'}${last.error ? `; asking Firn failed: ${last.error}` : ''})…`,
      );
    if (last.window && last.sidebar && last.panels) return { app };
    await wait(100);
  }
  saveLog(app);
  app.process().kill('SIGKILL');
  const missing = !last.window
    ? 'its window'
    : !last.sidebar
      ? 'its sidebar'
      : 'its floating panels';
  throw new Error(
    `Firn didn’t finish opening in 2 minutes (${missing} never loaded; see demo/out/firn-log.txt). Run the demo again; if it keeps happening, send Claude what Terminal shows.`,
  );
}

// What Firn printed, for working out what went wrong.
function saveLog(app) {
  const file = path.join(DEMO_DIR, 'out', 'firn-log.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, app.output());
  // The end of it here too (without Chromium's routine noise).
  const lines = app
    .output()
    .split('\n')
    .filter((line) => line.trim() && !/^\[\d+:\d+\/[\d.]+:/.test(line));
  console.log(`[demo]   Firn's last words:\n${lines.slice(-25).join('\n')}`);
}
