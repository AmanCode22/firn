const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const SP = process.env.SP;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
// A slow download: 2 MB over about 4 seconds.
const SIZE = 2 * 1000 * 1000;
const server = http
  .createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': SIZE,
      'Content-Disposition': 'attachment; filename="big.bin"',
    });
    let sent = 0;
    const chunk = Buffer.alloc(50000, 7);
    const timer = setInterval(() => {
      if (sent >= SIZE || res.destroyed) {
        clearInterval(timer);
        return res.end();
      }
      res.write(chunk);
      sent += chunk.length;
    }, 100);
    req.on('close', () => clearInterval(timer));
  })
  .listen(8766);
(async () => {
  execSync(
    'rm -rf /tmp/fdl && mkdir -p /tmp/fdl && rm -f /root/.config/Firn/session.json /root/.config/Firn/downloads.json',
  );
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
  });
  await wait(6000);
  await app.evaluate(({ app }) => app.setPath('downloads', '/tmp/fdl'));
  await app.evaluate(({ shell, Menu }) => {
    globalThis.__opened = [];
    shell.openPath = async (p) => {
      globalThis.__opened.push('open:' + p);
      return '';
    };
    shell.showItemInFolder = (p) => globalThis.__opened.push('show:' + p);
    Menu.buildFromTemplate = (t) => {
      globalThis.__menu = t;
      return { popup() {} };
    };
  });
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/dl.html');
  await fl.keyboard.press('Enter');
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes('dl.html'));
  const rows = () =>
    ui.evaluate(() =>
      [...document.querySelectorAll('.download')].map((r) => ({
        name: r.querySelector('.download-name').textContent,
        detail: r.querySelector('.download-detail').textContent,
        state: [...r.classList].find(
          (c) => c.startsWith('is-') && c !== 'is-clickable',
        ),
        ring: !!r.querySelector('.download-ring'),
      })),
    );
  const opened = () => app.evaluate(() => globalThis.__opened.slice());

  await pg.click('#small');
  await wait(1200);
  let r = await rows();
  check(
    'a download saves straight to the Downloads folder (no "Save as" box)',
    fs.existsSync('/tmp/fdl/notes.txt'),
    fs.readdirSync('/tmp/fdl').join(','),
  );
  check(
    '...and shows on the shelf as done',
    r.length === 1 &&
      r[0].name === 'notes.txt' &&
      r[0].state === 'is-done' &&
      r[0].detail === 'Done · 12 B',
    JSON.stringify(r),
  );
  await pg.click('#small');
  await wait(1200);
  r = await rows();
  check(
    'the same file again gets " (1)"',
    fs.existsSync('/tmp/fdl/notes (1).txt') && r[0].name === 'notes (1).txt',
    JSON.stringify(r.map((x) => x.name)),
  );
  await ui.locator('.download').first().click();
  await wait(300);
  check(
    'clicking a finished download opens it',
    (await opened()).includes('open:/tmp/fdl/notes (1).txt'),
    JSON.stringify(await opened()),
  );
  await ui.locator('.download').first().hover();
  await ui
    .locator('.download')
    .first()
    .locator('button[data-tip="Show in folder"]')
    .click();
  await wait(300);
  check(
    '"Show in folder" points to it',
    (await opened()).includes('show:/tmp/fdl/notes (1).txt'),
  );
  // slow one: progress, cancel, retry
  await pg.click('#slow');
  await wait(1200);
  r = await rows();
  check(
    'a download in progress shows a ring and "x of 2.0 MB"',
    r[0].name === 'big.bin' &&
      r[0].state === 'is-progress' &&
      r[0].ring &&
      r[0].detail.endsWith(' of 2.0 MB'),
    JSON.stringify(r[0]),
  );
  execSync(`import -window root -crop 300x900+0+0 ${SP}/dl-progress.png`);
  await ui.locator('.download').first().hover();
  await ui
    .locator('.download')
    .first()
    .locator('button[data-tip="Cancel download"]')
    .click();
  await wait(800);
  r = await rows();
  check(
    'Cancel stops it',
    r[0].state === 'is-cancelled' && r[0].detail === 'Cancelled · Try again',
    JSON.stringify(r[0]),
  );
  check(
    '...and no half file is left behind',
    !fs.existsSync('/tmp/fdl/big.bin'),
    fs.readdirSync('/tmp/fdl').join(','),
  );
  await ui.locator('.download').first().click();
  await wait(800);
  r = await rows();
  check(
    'clicking a cancelled one tries again',
    r[0].name === 'big.bin' &&
      r[0].state === 'is-progress' &&
      r.filter((x) => x.name === 'big.bin').length === 1,
    JSON.stringify(r),
  );
  await wait(5000);
  r = await rows();
  check(
    '...and it finishes',
    r[0].state === 'is-done' &&
      r[0].detail === 'Done · 2.0 MB' &&
      fs.statSync('/tmp/fdl/big.bin').size === SIZE,
    JSON.stringify(r[0]),
  );
  check('at most three show on the shelf', r.length === 3, String(r.length));
  // Save image from the right-click menu
  await pg.click('#img', { button: 'right' });
  await wait(300);
  await app.evaluate(() =>
    globalThis.__menu.find((i) => i.label === 'Save image').click(),
  );
  await wait(1200);
  check(
    '"Save image" saves it to Downloads too',
    fs.existsSync('/tmp/fdl/touch.png'),
    fs.readdirSync('/tmp/fdl').join(','),
  );
  execSync(`import -window root -crop 300x900+0+0 ${SP}/dl-done.png`);
  // remove from list
  const before = (await rows()).length;
  await ui.locator('.download').first().hover();
  await ui
    .locator('.download')
    .first()
    .locator('button[data-tip="Remove from list"]')
    .click();
  await wait(500);
  r = await rows();
  check(
    '"Remove from list" takes it off (the file stays)',
    !r.some((x) => x.name === 'touch.png') &&
      fs.existsSync('/tmp/fdl/touch.png'),
    JSON.stringify(r.map((x) => x.name)),
  );
  await wait(1500);
  const saved = JSON.parse(
    fs.readFileSync('/root/.config/Firn/downloads.json', 'utf8'),
  ).downloads.map((d) => d.name + ':' + d.state);
  check(
    'the list is saved for next time',
    saved.join(',') === 'big.bin:done,notes (1).txt:done,notes.txt:done',
    saved.join(','),
  );
  fs.unlinkSync('/tmp/fdl/big.bin');
  await pg.click('#small');
  await wait(1200); // a new download refreshes the list
  r = await rows();
  check(
    'a file deleted since says "Moved or deleted"',
    r.some((x) => x.name === 'big.bin' && x.detail === 'Moved or deleted'),
    JSON.stringify(r),
  );
  await ui.locator('.download', { hasText: 'big.bin' }).click();
  await wait(300);
  check(
    "...and clicking it doesn't try to open it",
    !(await opened()).some((o) => o.includes('big.bin')),
    JSON.stringify(await opened()),
  );
  // The disk isn't looked at on every update, only when Firn comes back
  // to the front (or a download starts or ends): a file deleted meanwhile
  // shows as gone then.
  fs.unlinkSync('/tmp/fdl/notes (1).txt');
  await wait(1200);
  const quiet = (await rows()).find((x) => x.name === 'notes (1).txt');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].emit('focus'),
  );
  await wait(500);
  const back = (await rows()).find((x) => x.name === 'notes (1).txt');
  check(
    'coming back to Firn: a file deleted meanwhile says "Moved or deleted"',
    quiet?.detail.startsWith('Done') && back?.detail === 'Moved or deleted',
    `${quiet?.detail} → ${back?.detail}`,
  );
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('downloads');
  await wait(300);
  const labels = await fl.evaluate(() =>
    [...document.querySelectorAll('.result')].map((x) => x.textContent),
  );
  check(
    'the command bar offers "Open downloads folder"',
    labels.some((l) => l.includes('Open downloads folder')),
    labels.join(' | '),
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
  server.close();
})();
