// A download's small moments in the sidebar: the new row rises in with a
// wash of the space's color and a soft ring; when the
// file is in, the arrow settles into a file and the ring spreads again.
// Rows already there when Firn starts are simply there. And a long file
// name never makes a row wider than the sidebar (it once pushed the row,
// and its × button, behind the page).
const { _electron } = require('./playwright.cjs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
// A slow download with a very long name (about 3 seconds).
const SIZE = 1500 * 1000;
const LONG_NAME =
  'David_Wurgler_Cover_Letter_Tufts_final_version_for_review_2026.bin';
const server = http
  .createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(
        `<a id="long" href="/file" style="font: 20px sans-serif">Download</a>`,
      );
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': SIZE,
      'Content-Disposition': `attachment; filename="${LONG_NAME}"`,
    });
    let sent = 0;
    const timer = setInterval(() => {
      if (sent >= SIZE || res.destroyed) {
        clearInterval(timer);
        return res.end();
      }
      res.write(Buffer.alloc(50000, 7));
      sent += 50000;
    }, 100);
    req.on('close', () => clearInterval(timer));
  })
  .listen(8766);

(async () => {
  execSync(
    'rm -rf /tmp/fdlfx && mkdir -p /tmp/fdlfx && rm -f /root/.config/Firn/downloads.json',
  );
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  await app.evaluate(({ app }) => app.setPath('downloads', '/tmp/fdlfx'));
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const open = async (url) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(url);
    await fl.keyboard.press('Enter');
    await wait(1500);
  };
  const row = () =>
    ui.evaluate(() => {
      const el = document.querySelector('.downloads .download');
      if (!el) return null;
      // The sidebar's own edge (the shelf itself could be stretched too).
      const sidebar = el.closest('.sidebar').getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const close = el.querySelectorAll('.download-actions button');
      const last = close[close.length - 1]?.getBoundingClientRect();
      return {
        isNew: el.classList.contains('is-new'),
        state: [...el.classList].find(
          (c) => c.startsWith('is-') && !['is-new', 'is-clickable'].includes(c),
        ),
        pulse: !!el.querySelector('.download-pulse'),
        settling: !!el.querySelector('.is-settling'),
        // Icons in the row's icon spot (one, never two stacked).
        icons: el.querySelectorAll('.download-icon > :not(.download-pulse)')
          .length,
        inside: box.right <= sidebar.right + 0.5,
        buttonInside: !!last && last.right <= sidebar.right + 0.5,
        widths: `${Math.round(box.width)} in ${Math.round(sidebar.width)}`,
      };
    });

  // A small file, done almost at once.
  await open('127.0.0.1:8765/dl.html');
  const pg = app.windows().find((w) => w.url().includes('dl.html'));
  await pg.click('#small');
  await wait(400);
  let r = await row();
  check(
    'a new download arrives: it rises in with a wash of color and a soft ring',
    r?.isNew && r?.pulse,
    JSON.stringify(r),
  );
  check(
    'finished: the file settles in',
    r?.state === 'is-done' && r.settling,
    JSON.stringify(r),
  );

  // A slow one with a very long name.
  await open('127.0.0.1:8766/');
  const pg2 = app.windows().find((w) => w.url().includes(':8766/'));
  await pg2.click('#long');
  await wait(600);
  await ui.hover('.downloads .download');
  await wait(300);
  r = await row();
  check(
    'a very long name: the row stays inside the sidebar, with its × in reach',
    r?.state === 'is-progress' && r.inside && r.buttonInside,
    JSON.stringify(r),
  );
  for (let i = 0; i < 40 && (await row())?.state !== 'is-done'; i++)
    await wait(200);
  r = await row();
  check(
    '...and when it finishes, the file settles in with the ring',
    r?.state === 'is-done' && r.pulse && r.settling && r.inside,
    JSON.stringify(r),
  );
  await wait(1500);
  r = await row();
  check(
    '...one file icon, not two stacked',
    r?.state === 'is-done' && r.icons === 1,
    JSON.stringify(r),
  );

  // Started again, rows already there are simply there.
  await app.close();
  // (Without the tabs: Playwright's launcher hangs on restored tabs.)
  execSync('rm -f /root/.config/Firn/session.json');
  const again = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui2 = again.windows().find((w) => w.url().endsWith(':5173/'));
  const calm = await ui2.evaluate(() =>
    [...document.querySelectorAll('.downloads .download')].map(
      (row) =>
        row.classList.contains('is-new') ||
        !!row.querySelector('.download-pulse'),
    ),
  );
  check(
    'next time Firn starts, the rows are simply there (no arrival)',
    calm.length > 0 && calm.every((moving) => !moving),
    JSON.stringify(calm),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await again.close();
  server.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
