// Trying pages for the demo: `npm run demo:try-pages` opens each candidate
// page in Firn's demo mode, takes a picture of it, and notes any pop-up
// it finds, then makes a contact sheet (demo/out/try-pages/index.html) to
// pick the prettiest from. To try other pages instead of the candidates
// below, put them after the command:
// `npm run demo:try-pages -- https://example.com/ https://…`.
//
// The demo's own pages are in lib/seed.mjs; this only helps choose them.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkTools, takeStill } from './lib/capture.mjs';
import { createDirector, ui } from './lib/director.mjs';
import {
  buildFirn,
  DEMO_DIR,
  launchFirn,
  runningFirn,
  startDevServer,
  stopStrayFirns,
  wipeProfile,
} from './lib/firn.mjs';
import { findPopups } from './lib/popups.mjs';
import { tabId, writeSession, writeSettings } from './lib/seed.mjs';

const OUT = path.join(DEMO_DIR, 'out', 'try-pages');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (message) => console.log(`[demo] ${message}`);

// The candidates: big imagery or rich color, calm layouts, and (as far as
// can be told without opening them) no pop-ups, nothing advertising
// another browser, and no photos of real people up front.
const CANDIDATES = [
  // Space and the Earth
  'https://apod.nasa.gov/apod/astropix.html',
  'https://apod.nasa.gov/apod/ap220712.html',
  'https://apod.nasa.gov/apod/ap190410.html',
  'https://earth.nullschool.net/',
  'https://radio.garden/',
  // Art, books, and long reads
  'https://publicdomainreview.org/',
  'https://publicdomainreview.org/collections/',
  'https://ciechanow.ski/mechanical-watch/',
  'https://ciechanow.ski/bicycle/',
  'https://www.metmuseum.org/art/collection/search/436535',
  'https://www.rijksmuseum.nl/en/collection/SK-C-5',
  // Music
  'https://12k.bandcamp.com/',
  'https://ghostly.bandcamp.com/',
  'https://www.nts.live/',
  // Beautifully made products (for the Work space)
  'https://linear.app/',
  'https://stripe.com/',
  'https://culturedcode.com/things/',
  'https://www.raycast.com/',
  'https://vercel.com/',
  'https://www.apple.com/macbook-air/',
  // Firn's own
  'https://firnbrowser.com/',
  'https://firnbrowser.com/release-notes',
];

// Pages given after the command, or else the candidates.
const given = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));
const pages = given.length ? given : CANDIDATES;

const windowInfo = (app) =>
  app.evaluate(() => {
    const win = globalThis.__demoDrive.mainWindow();
    return {
      bounds: win.getContentBounds(),
      windowId: Number(win.getMediaSourceId().split(':')[1]),
    };
  });

async function main() {
  checkTools();
  const open = runningFirn();
  if (open) {
    console.error(
      `[demo] Firn is already running. Quit it first (Cmd+Q), then try again.\n       (Found: ${open})`,
    );
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // One space holding every page to try.
  wipeProfile();
  writeSettings();
  writeSession({
    spaces: [
      {
        id: 'demo-try',
        name: 'Try',
        icon: 'home',
        color: '#7f9cb0',
        tabs: pages,
      },
    ],
    basecamp: [],
  });

  await buildFirn(log);
  const server = await startDevServer(log);
  let app;
  const results = [];
  try {
    ({ app } = await launchFirn({ glass: false }));
    const d = createDirector({ app, random: Math.random });
    const info = await windowInfo(app);
    for (const [i, url] of pages.entries()) {
      log(`(${i + 1}/${pages.length}) ${url}`);
      await d.run(
        ui('body'),
        `window.firn.activateTab(${JSON.stringify(tabId(0, i))})`,
      );
      await wait(500);
      await d.settle(25_000);
      // A moment for pictures, fonts, and anything that slides in late.
      await wait(3000);
      const popups = await findPopups(app);
      const title = await app
        .evaluate(() => {
          const layer = globalThis.__demoDrive
            .layers()
            .find((l) => l.shown && !l.url.startsWith('http://localhost'));
          return layer
            ? globalThis.__demoDrive.js(layer.id, 'document.title', 3000)
            : '';
        })
        .catch(() => '');
      const file = `${String(i + 1).padStart(2, '0')}.png`;
      await takeStill(
        { windowId: info.windowId, region: info.bounds },
        path.join(OUT, file),
      ).catch((error) => log(`  couldn't take its picture: ${error.message}`));
      if (popups.length)
        log(`  heads-up: maybe a pop-up (${popups.join('; ')})`);
      results.push({ url, title: title ?? '', file, popups });
    }
  } finally {
    if (app) app.process().kill('SIGKILL');
    await stopStrayFirns();
    await server.stop();
  }

  // The contact sheet.
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const cards = results
    .map(
      (r, i) => `<figure>
  <a href="${esc(r.file)}"><img src="${esc(r.file)}" loading="lazy" alt=""></a>
  <figcaption><b>${i + 1}. ${esc(r.title || '(no title: it may not have loaded)')}</b><br>
  <a href="${esc(r.url)}">${esc(r.url)}</a>
  ${r.popups.length ? `<br><span class="warn">Maybe a pop-up: ${esc(r.popups.join('; '))}</span>` : ''}</figcaption>
</figure>`,
    )
    .join('\n');
  fs.writeFileSync(
    path.join(OUT, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Pages to try</title>
<style>
  body { margin: 32px; font: 14px/1.45 -apple-system, system-ui, sans-serif; background: #f4f1ec; color: #2b2826; }
  h1 { font-weight: 600; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 28px; }
  figure { margin: 0; }
  img { width: 100%; border-radius: 10px; box-shadow: 0 2px 10px rgba(60,40,20,.15); }
  figcaption { margin-top: 8px; }
  a { color: #4f6f84; word-break: break-all; }
  .warn { color: #a5502f; }
</style>
<h1>Pages to try</h1>
<p>Each page as Firn shows it in a demo clip. Tell Claude the numbers you like.</p>
<main>
${cards}
</main>`,
  );
  log(
    `Done. The contact sheet: ${path.relative(process.cwd(), path.join(OUT, 'index.html'))}`,
  );
  if (process.platform === 'darwin')
    execFile('open', [path.join(OUT, 'index.html')]);
}

main().catch((error) => {
  console.error(`[demo] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
