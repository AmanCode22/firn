// A download's three small moments, clicked with a real (system) mouse:
// the hand-off (a Firn flake glides from the click to the sidebar, drawn by the
// floating layer in a small box just around its path, then the layer goes),
// the arrival (the new row's slot opens and it rises in with a wash of the
// space's color; rows already there when Firn started don't), the nod as
// the dot lands, and the finish (the file settles in and a soft ring
// spreads).
const { _electron } = require('./playwright.cjs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (...a) =>
  execSync(`python3 ${__dirname}/xmouse.py ${a.join(' ')}`);
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
// A slow download (about 3 seconds), to see the nod while it's arriving.
const SIZE = 1500 * 1000;
const server = http
  .createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': SIZE,
      'Content-Disposition': 'attachment; filename="big.bin"',
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
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/dl.html');
  await fl.keyboard.press('Enter');
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes('dl.html'));
  // Where something on the page is, on the screen.
  const onScreen = async (selector) => {
    const box = await pg.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.x + 20, y: r.y + r.height / 2 };
    }, selector);
    const at = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const page = w.contentView.children.find((v) =>
        v.webContents?.getURL().includes('dl.html'),
      );
      return { content: w.getContentBounds(), page: page.getBounds() };
    });
    return {
      x: Math.round(at.content.x + at.page.x + box.x),
      y: Math.round(at.content.y + at.page.y + box.y),
    };
  };
  const floatingBox = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const v = w.contentView.children.find((c) =>
        c.webContents?.getURL().includes('view=floating'),
      );
      return v.getVisible() && v.getBounds().width > 0
        ? { ...v.getBounds(), window: w.getContentBounds().width }
        : null;
    });
  // Clicks a link with the system mouse and watches the floating layer.
  const clickAndWatch = async (selector) => {
    const at = await onScreen(selector);
    mouse('move', at.x, at.y);
    await wait(150);
    mouse('down');
    mouse('up');
    const seen = [];
    let dot = false;
    for (let i = 0; i < 30; i++) {
      seen.push(await floatingBox());
      if (!dot)
        dot = await fl.evaluate(
          () => !!document.querySelector('.download-flight-flake'),
        );
      await wait(30);
    }
    return { seen, dot };
  };

  // A small file: done almost at once.
  const small = await clickAndWatch('#small');
  const boxes = small.seen.filter(Boolean);
  check(
    'clicking a download: a Firn flake glides from the click, drawn in a small box around its path',
    small.dot &&
      boxes.length > 0 &&
      boxes.every((b) => b.width < b.window && b.height > 0),
    JSON.stringify(boxes[0] ?? null),
  );
  check(
    '...and then the floating layer goes',
    !small.seen.at(-1) && !(await floatingBox()),
  );
  const row = () =>
    ui.evaluate(() => {
      const slot = document.querySelector('.downloads .download-slot');
      const el = slot?.querySelector('.download');
      return slot
        ? {
            arriving: slot.classList.contains('is-arriving'),
            isNew: el.classList.contains('is-new'),
            state: [...el.classList].find(
              (c) =>
                c.startsWith('is-') && !['is-new', 'is-clickable'].includes(c),
            ),
            pulse: !!el.querySelector('.download-pulse'),
            settling: !!el.querySelector('.is-settling'),
            nodding: !!el.querySelector('.is-nodding'),
          }
        : null;
    });
  let r = await row();
  check(
    'the new row arrives: its slot opens and it rises in with a wash of color',
    r?.arriving && r?.isNew,
    JSON.stringify(r),
  );
  check(
    'finished: the file settles in and a soft ring spreads',
    r?.state === 'is-done' && r.pulse && r.settling,
    JSON.stringify(r),
  );

  // A slow one: the ring nods as the dot lands.
  await clickAndWatch('#slow');
  r = await row();
  check(
    'while it arrives, the ring nods as the dot lands',
    r?.state === 'is-progress' && r.nodding && r.isNew,
    JSON.stringify(r),
  );
  for (let i = 0; i < 40 && (await row())?.state !== 'is-done'; i++)
    await wait(200);
  r = await row();
  check(
    '...and when it finishes, the same settle and ring',
    r?.state === 'is-done' && r.pulse && r.settling,
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
    [...document.querySelectorAll('.downloads .download-slot')].map(
      (slot) =>
        slot.classList.contains('is-arriving') ||
        !!slot.querySelector('.is-new, .download-pulse'),
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
