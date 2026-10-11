// Firn's demo recorder: `npm run demo` records every clip, and
// `npm run demo -- --clip lookout` just one (repeat --clip for a few). See
// demo/README.md.
//
// Each clip starts from a fresh copy of the demo profile, so every run
// gives the same result:
//   1. Firn is built from the source code and its interface served.
//   2. Warm-up (off camera): the demo profile is seeded with the spaces,
//      tabs, and Basecamp, and Firn visits every tab once, so each has its
//      title and icon, and the pages are in the cache.
//   3. Each clip: that warmed profile (or a fresh one, for the welcome and
//      the empty page), Firn opened at 1440×900, the soft demo cursor laid
//      over it, pages settled, then recorded: 1.2s still, the steps, 1.2s
//      still.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CLIPS } from './clips/index.mjs';
import {
  captureScale,
  checkTools,
  finishClip,
  startRecording,
  stopAllRecordings,
  stopStrayRecordings,
  takeStill,
  warmUpScreen,
} from './lib/capture.mjs';
import { openCursor } from './lib/cursor.mjs';
import { findPopups } from './lib/popups.mjs';
import { createDirector, PACE, seededRandom, ui } from './lib/director.mjs';
import {
  buildFirn,
  DEMO_DIR,
  launchFirn,
  PROFILE,
  runningFirn,
  stopStrayFirns,
  startDevServer,
  wipeProfile,
} from './lib/firn.mjs';
import {
  basecampId,
  SPACES,
  tabId,
  writeSession,
  writeSettings,
} from './lib/seed.mjs';

const OUT = path.join(DEMO_DIR, 'out');
const RAW = path.join(OUT, '.raw');
const CACHE = path.join(DEMO_DIR, '.cache');
const WARM = path.join(CACHE, 'warm-profile');
const AD_LISTS = 'ad-block-lists.bin';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (message) => console.log(`[demo] ${message}`);

const { values } = parseArgs({
  options: {
    clip: { type: 'string', multiple: true },
    glass: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    // Clips only, no still pictures.
    'no-stills': { type: 'boolean', default: false },
  },
});

if (values.list) {
  for (const clip of CLIPS) console.log(clip.name);
  process.exit(0);
}
const chosen = values.clip?.length
  ? values.clip.map((name) => {
      const clip = CLIPS.find((c) => c.name === name);
      if (!clip) {
        console.error(
          `No clip called “${name}”. The clips: ${CLIPS.map((c) => c.name).join(', ')}`,
        );
        process.exit(1);
      }
      return clip;
    })
  : CLIPS;

// --- The ad-block lists ------------------------------------------------------
// Firn downloads its block lists when it has none (or they're a day old).
// The demo keeps them between runs, so a run doesn't fetch them again.

const copyKeepingTime = (from, to) => {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const { atime, mtime } = fs.statSync(from);
  fs.utimesSync(to, atime, mtime);
};
const keepAdLists = () =>
  copyKeepingTime(path.join(PROFILE, AD_LISTS), path.join(CACHE, AD_LISTS));
const giveAdLists = () =>
  copyKeepingTime(path.join(CACHE, AD_LISTS), path.join(PROFILE, AD_LISTS));

// --- Firn's window --------------------------------------------------------------

const windowInfo = (app) =>
  app.evaluate(({ screen }) => {
    const win = globalThis.__demoDrive.mainWindow();
    const bounds = win.getContentBounds();
    const display = screen.getDisplayMatching(bounds);
    return {
      bounds,
      scale: display.scaleFactor,
      display: display.bounds,
      workArea: display.workArea,
      windowId: Number(win.getMediaSourceId().split(':')[1]),
    };
  });

const bringToFront = (app) =>
  app.evaluate(({ app }) => {
    const win = globalThis.__demoDrive.mainWindow();
    if (process.platform === 'darwin') app.focus({ steal: true });
    win.show();
    win.focus();
  });

// Saves Firn's session (as closing its window does), then quits; if it
// hasn't quit a few seconds later, it's stopped.
async function quitFirn(app) {
  const child = app.process();
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    child.once('exit', resolve);
  });
  await app
    .evaluate(({ app }) => {
      app.quit();
    })
    .catch(() => {});
  for (let i = 0; i < 30 && !app.ended(); i++) await wait(200);
  await Promise.race([exited, wait(1000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, wait(2000)]);
  }
  // Anything it left running, too (and Chromium's helper processes finish
  // writing a moment later).
  await stopStrayFirns();
  await wait(700);
  running.delete(app);
}

// Firns started by this run, stopped if the run is interrupted.
const running = new Set();
// Firn's interface server, restarted if it stops answering.
let server;
const launch = async () => {
  if (!(await server.alive())) {
    log('  Firn’s interface stopped answering; restarting it…');
    await server.stop();
    server = await startDevServer(log);
  }
  const firn = await launchFirn({ glass: values.glass });
  running.add(firn.app);
  return firn;
};

// Copies a profile, leaving out Chromium's "already open" lock files.
const copyProfile = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true, maxRetries: 10 });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (file) => !path.basename(file).startsWith('Singleton'),
  });
};

// The real pointer (left out of the recording) would still light up what
// it rests on, so it must be off the window.
async function waitForPointerOff(app, bounds) {
  if (process.platform !== 'darwin') return;
  let asked = false;
  for (;;) {
    const p = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    const inside =
      p.x >= bounds.x - 4 &&
      p.x <= bounds.x + bounds.width + 4 &&
      p.y >= bounds.y - 4 &&
      p.y <= bounds.y + bounds.height + 4;
    if (!inside) return;
    if (!asked) log('Move your mouse pointer off the Firn window to continue…');
    asked = true;
    await wait(300);
  }
}

// --- Warm-up --------------------------------------------------------------------

async function warmUp() {
  log('Warming up: visiting every demo page once (off camera)…');
  wipeProfile();
  giveAdLists();
  writeSettings();
  writeSession();
  const { app } = await launch();
  const d = createDirector({ app, random: Math.random });
  const sidebar = ui('body');
  const visit = async (id) => {
    await d.run(sidebar, `window.firn.activateTab(${JSON.stringify(id)})`);
    await wait(300);
    await d.settle();
  };
  for (let s = SPACES.length - 1; s >= 0; s--) {
    await d.run(
      sidebar,
      `window.firn.switchSpace(${JSON.stringify(SPACES[s].id)})`,
    );
    await wait(500);
    // Last tab first, so each space comes back on its first tab.
    for (let i = SPACES[s].tabs.length - 1; i >= 0; i--)
      await visit(tabId(s, i));
  }
  for (let i = 2; i >= 0; i--) await visit(basecampId(i));
  await visit(tabId(0, 0));
  await quitFirn(app);
  keepAdLists();
  copyProfile(PROFILE, WARM);
}

function prepareProfile(seed) {
  if (seed === 'tabs') {
    copyProfile(WARM, PROFILE);
    return;
  }
  wipeProfile();
  giveAdLists();
  if (seed === 'welcome') writeSettings({ onboarded: false });
  else {
    writeSettings();
    writeSession({ withTabs: false });
  }
}

// --- One clip ------------------------------------------------------------------

// The recording's pixels per point, and whether the clip size was said.
let scale;
let toldSize = false;

// A step of a clip, given `seconds` to finish; if it doesn't, the run
// stops and says which step it was.
async function within(step, seconds, promise) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Stuck while ${step} (over ${seconds}s). Look for a macOS prompt behind the windows (Cmd+Tab); otherwise send Claude what Terminal shows.`,
          ),
        ),
      seconds * 1000,
    );
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

// Anything big stuck over a page (a pop-up that got past demo mode's
// hiding) is said in the log, so that clip can be looked at.
async function lookForPopups(app, when) {
  for (const page of await findPopups(app))
    log(
      `  heads-up (${when}): something big is stuck over the page, maybe a pop-up: ${page}`,
    );
}

async function record(clip) {
  log(`Recording ${clip.name}…`);
  prepareProfile(clip.seed);
  log('  opening Firn…');
  const { app } = await launch();
  try {
    log('  Firn is open; getting ready…');
    await wait(1000);
    await within('bringing Firn to the front', 15, bringToFront(app));
    const info = await within('measuring Firn’s window', 15, windowInfo(app));
    if (info.workArea.width < 1440 || info.workArea.height < 900)
      throw new Error(
        `The main screen is too small for a 1440×900 window (it has ${info.workArea.width}×${info.workArea.height} free). Use a larger display, or a "More Space" setting in System Settings > Displays.`,
      );
    // How sharp the recording is (measured once per run).
    if (scale === undefined) log('  checking the screen…');
    scale ??= await within(
      'checking the screen',
      45,
      captureScale(info.display, info.scale),
    );
    if (!toldSize) {
      toldSize = true;
      const size = (n) => Math.round(n * scale) - (Math.round(n * scale) % 2);
      log(
        `Clips will be ${size(info.bounds.width)}×${size(info.bounds.height)}${scale < 2 ? ' (for 2880×1800, pick a display setting that’s exactly twice as sharp; see demo/README.md)' : ''}.`,
      );
    }
    log('  adding the demo cursor…');
    const cursor = await within(
      'adding the demo cursor',
      20,
      openCursor(app, info.bounds),
    );
    let stillNumber = 0;
    // Stills are taken in the background, so the clip flows on.
    const stills = [];
    const d = createDirector({
      app,
      cursor,
      random: seededRandom(clip.name),
      takeStill: () => {
        if (values['no-stills']) return;
        stillNumber++;
        const file = path.join(
          OUT,
          'stills',
          `${clip.name}-${stillNumber}.png`,
        );
        stills.push(
          takeStill(
            { windowId: info.windowId, region: info.bounds },
            file,
          ).then(() => log(`  still: ${path.relative(DEMO_DIR, file)}`)),
        );
      },
    });
    // Each clip opens on its own space and page (`start`), so the clips
    // don't all begin on the same picture.
    if (clip.start) {
      const s = SPACES.findIndex((space) => space.name === clip.start.space);
      if (s < 0) throw new Error(`No space called ${clip.start.space}.`);
      log(`  opening ${clip.start.space}, tab ${clip.start.tab + 1}…`);
      await within(
        'opening its first page',
        30,
        (async () => {
          await d.run(
            ui('body'),
            `window.firn.switchSpace(${JSON.stringify(SPACES[s].id)})`,
          );
          await wait(400);
          await d.run(
            ui('body'),
            `window.firn.activateTab(${JSON.stringify(tabId(s, clip.start.tab))})`,
          );
          await wait(400);
        })(),
      );
    }
    log('  setting up the clip…');
    await within('setting up the clip', 60, clip.setup?.(d));
    await within('waiting for pages to load', 60, d.settle());
    await within('bringing Firn to the front', 15, bringToFront(app));
    // (And the cursor's window back above it.)
    await within(
      'raising the demo cursor',
      15,
      app.evaluate(() => globalThis.__demoCursor.moveTop()),
    );
    await waitForPointerOff(app, info.bounds);
    await lookForPopups(app, 'before');

    if (clip.video === false) {
      await clip.run(d);
      await Promise.all(stills);
      return;
    }
    const raw = path.join(RAW, `${clip.name}.mkv`);
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    log('  recording…');
    const recording = await within(
      'starting the recording',
      45,
      startRecording(
        {
          ...info.bounds,
          x: info.bounds.x - info.display.x,
          y: info.bounds.y - info.display.y,
        },
        scale,
        raw,
      ),
    );
    await wait(400);
    const from = Date.now();
    await wait(PACE.lead);
    await within('playing the clip', 90, clip.run(d));
    await wait(PACE.lead);
    const to = Date.now();
    await wait(300);
    await lookForPopups(app, 'at the end');
    log('  saving…');
    const saved = await within('stopping the recording', 60, recording.stop());
    await Promise.all(stills);
    const file = path.join(OUT, 'clips', `${clip.name}.mp4`);
    await finishClip(saved, from, to, file);
    fs.rmSync(raw, { force: true });
    log(
      `  clip: ${path.relative(DEMO_DIR, file)} (${((to - from) / 1000).toFixed(1)}s)`,
    );
  } finally {
    // A clip that failed mid-recording mustn't leave it running.
    stopAllRecordings();
    await quitFirn(app);
  }
}

// --- The run -----------------------------------------------------------------------

const failed = [];

async function main() {
  checkTools();
  const running = runningFirn();
  if (running) {
    console.error(
      `[demo] Firn is already running. Quit it first (Firn > Quit Firn, or Cmd+Q), then run the demo again.\n       (Found: ${running})`,
    );
    process.exit(1);
  }
  fs.mkdirSync(path.join(OUT, 'clips'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true });
  // This run's stills replace the last run's (with --no-stills, the last
  // run's stay).
  if (!values['no-stills'])
    for (const clip of chosen)
      for (const name of fs.readdirSync(path.join(OUT, 'stills')))
        if (name.startsWith(`${clip.name}-`))
          fs.rmSync(path.join(OUT, 'stills', name));
  wipeProfile();
  stopStrayRecordings(RAW);
  if (process.platform === 'darwin') {
    log('Checking that the screen can be recorded…');
    await warmUpScreen();
    log(
      'If macOS asks whether your Terminal may access the screen directly ("bypass the system private window picker"), click Allow. It would otherwise sit in the middle of every clip.',
    );
    if (process.stdin.isTTY) {
      log('Press Return to go on.');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      process.stdin.pause();
    } else await wait(10_000);
  }

  await buildFirn(log);
  server = await startDevServer(log);
  // Ctrl+C (or a crash) still stops Firn and the interface server.
  const stopAll = async () => {
    stopAllRecordings();
    for (const app of running) app.process().kill('SIGKILL');
    await stopStrayFirns();
    await server.stop();
  };
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      console.error('\n[demo] Stopped.');
      void stopAll().then(() => process.exit(130));
    });
  try {
    if (chosen.some((clip) => clip.seed === 'tabs')) await warmUp();
    // A clip that fails is noted and skipped; the others still record.
    for (const clip of chosen)
      await record(clip).catch((error) => {
        failed.push(clip.name);
        console.error(`[demo] ${clip.name} failed: ${error?.message ?? error}`);
      });
  } finally {
    await stopAll();
  }
  if (failed.length) {
    console.error(
      `[demo] Done, except: ${failed.join(', ')} (see above). Run just those again with --clip.`,
    );
    process.exitCode = 1;
    return;
  }
  log(
    `Done. Clips and stills are in ${path.relative(process.cwd(), OUT) || OUT}`,
  );
}

main().catch((error) => {
  console.error(`[demo] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
