// A split view's handles, with a real system mouse: near the top middle of
// a side, a pill comes out (on the floating layer, in front of the page).
// Dragging its grip over the other side swaps the two (shown as it goes,
// kept on letting go); its × takes that side out of the split, and the
// tab stays.
const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const fs = require('fs');
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
(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  fs.writeFileSync(
    '/root/.config/Firn/settings.json',
    JSON.stringify({
      onboarded: true,
      lastVersion: require('../../package.json').version,
    }),
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
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  const open = async (page) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(1200);
  };
  // The web pages shown, left to right: which page, and where.
  const shownPages = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.contentView.children
        .filter((v) => v.webContents && v.getVisible())
        .map((v) => ({ url: v.webContents.getURL(), ...v.getBounds() }))
        .filter((v) => v.url.includes(':8765/') && v.width > 0)
        .sort((a, b) => a.x - b.x)
        .map((v) => ({
          page: v.url.split('/').pop().replace('.html', ''),
          x: v.x,
          width: v.width,
        }));
    });
  const names = async () => (await shownPages()).map((p) => p.page).join('|');
  const card = () =>
    ui.evaluate(() => {
      const c = document.querySelector('.drop-card');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const area = document.querySelector('.page-area').getBoundingClientRect();
      return {
        side: r.left - area.left < area.width / 4 ? 'left' : 'right',
        title: c.getAttribute('aria-label') ?? '',
      };
    });
  const active = () =>
    ui.evaluate(
      () =>
        document.querySelector('.space-tabs .tab.is-active')?.textContent ?? '',
    );
  const rowOf = (title) =>
    ui.locator('.space-tabs .tab[data-kind="everyday"]', { hasText: title });
  const center = async (locator) => {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // The page area's left and right halves, in the window.
  const area = await ui.evaluate(() => {
    const r = document.querySelector('.page-area').getBoundingClientRect();
    return { left: r.left, right: r.right, middle: (r.top + r.bottom) / 2 };
  });
  const leftHalf = area.left + (area.right - area.left) * 0.25;
  const rightHalf = area.left + (area.right - area.left) * 0.75;

  const xm = (...a) =>
    execSync(
      `python3 ${__dirname}/xmouse.py ${a.map((v) => (typeof v === 'number' ? Math.round(v) : v)).join(' ')}`,
    );
  const realDrag = async (from, to, steps = 20) => {
    xm('move', Math.round(o.x + from.x), Math.round(o.y + from.y));
    await wait(200);
    xm('down');
    await wait(100);
    for (let i = 1; i <= steps; i++) {
      xm(
        'move',
        Math.round(o.x + from.x + ((to.x - from.x) * i) / steps),
        Math.round(o.y + from.y + ((to.y - from.y) * i) / steps),
      );
      await wait(25);
    }
    await wait(600);
  };
  await open('red.html');
  await open('blue.html');
  // Red dragged in on the right: blue | red.
  const red = await center(rowOf('Red'));
  await ui.mouse.move(red.x, red.y);
  await ui.mouse.down();
  await ui.mouse.move(red.x + 60, red.y, { steps: 4 });
  await ui.mouse.move(rightHalf, area.middle, { steps: 8 });
  await wait(400);
  await ui.mouse.up();
  await wait(1000);
  check('split: blue | red', (await names()) === 'blue|red', await names());

  const handle = () =>
    fl.evaluate(() => {
      const h = document.querySelector('.split-handle.is-shown');
      return h ? { dragging: h.classList.contains('is-dragging') } : null;
    });
  const floatingBox = () =>
    app.evaluate(({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (v) =>
          v.webContents?.getURL().includes('view=floating') && v.getVisible(),
      );
      return v ? v.getBounds() : null;
    });
  const pages = await shownPages();
  const leftMiddle = pages[0].x + pages[0].width / 2;
  const top = await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((v) =>
      v.webContents?.getURL().includes('blue.html'),
    );
    return v.getBounds().y;
  });

  // Away from the top: no handle.
  xm('move', o.x + leftMiddle, o.y + top + 300);
  await wait(500);
  check('away from the top, no handle', !(await handle()));
  // Passing through near the top middle: not yet (it waits a moment).
  xm('move', o.x + leftMiddle + 40, o.y + top + 20);
  await wait(120);
  check('just passing by the top middle, no handle yet', !(await handle()));
  // Resting there: its handle.
  await wait(500);
  let box = await floatingBox();
  check(
    'near the top middle of a side, its handle comes out',
    !!(await handle()) &&
      box &&
      Math.abs(box.x + box.width / 2 - leftMiddle) <= 2 &&
      box.y < top + 20,
    JSON.stringify(box),
  );
  execSync(
    `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${SP}/splithandle-shown.png`,
  );
  // The grip: the pill's left part.
  const grip = { x: box.x + 20 + 22, y: box.y + box.height / 2 };
  xm('move', o.x + grip.x, o.y + grip.y);
  await wait(200);
  xm('down');
  await wait(100);
  for (let i = 1; i <= 16; i++) {
    xm(
      'move',
      o.x + grip.x + ((rightHalf - grip.x) * i) / 16,
      o.y + grip.y + ((area.middle - grip.y) * i) / 16,
    );
    await wait(30);
  }
  await wait(600);
  box = await floatingBox();
  check(
    'dragged over the other side: the pill follows, and the two swap',
    (await names()) === 'red|blue' &&
      (await handle())?.dragging &&
      box &&
      Math.abs(box.x + box.width / 2 - rightHalf) <= 3,
    `${await names()} ${JSON.stringify(box)}`,
  );
  execSync(
    `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${SP}/splithandle-drag.png`,
  );
  xm('up');
  await wait(700);
  const row = await ui.evaluate(() =>
    [...document.querySelectorAll('.space-tabs .split-row .tab-title')]
      .map((t) => t.textContent)
      .join('|'),
  );
  check(
    'let go: swapped for good (the sidebar row too), and the pill goes',
    (await names()) === 'red|blue' &&
      /^Red.*\|Blue/.test(row) &&
      !(await handle()),
    `${await names()} / ${row}`,
  );

  // Dragged and brought back: nothing changes.
  xm('move', o.x + leftMiddle, o.y + top + 20);
  await wait(500);
  box = await floatingBox();
  const grip2 = { x: box.x + 20 + 22, y: box.y + box.height / 2 };
  xm('move', o.x + grip2.x, o.y + grip2.y);
  await wait(200);
  xm('down');
  for (const x of [rightHalf, leftHalf])
    for (let i = 1; i <= 8; i++) {
      xm('move', o.x + x - 40 + i * 5, o.y + area.middle);
      await wait(30);
    }
  await wait(400);
  xm('up');
  await wait(700);
  check(
    'dragged over and back again: nothing changes',
    (await names()) === 'red|blue',
    await names(),
  );

  // A panel opening mid-drag (here Settings) takes the handle away: the
  // swap it was showing is undone, and stays undone after letting go.
  xm('move', o.x + leftMiddle, o.y + top + 20);
  await wait(500);
  box = await floatingBox();
  const grip3 = { x: box.x + 20 + 22, y: box.y + box.height / 2 };
  xm('move', o.x + grip3.x, o.y + grip3.y);
  await wait(200);
  xm('down');
  for (let i = 1; i <= 16; i++) {
    xm(
      'move',
      o.x + grip3.x + ((rightHalf - grip3.x) * i) / 16,
      o.y + grip3.y + ((area.middle - grip3.y) * i) / 16,
    );
    await wait(30);
  }
  await wait(600);
  const previewed = await names();
  await ui.evaluate(() => window.firn.runAction('settings', ''));
  await wait(700);
  const underPanel = await names();
  xm('up');
  await wait(300);
  await fl.keyboard.press('Escape');
  await wait(700);
  check(
    'a panel opening mid-drag: the swap shown is undone',
    previewed === 'blue|red' && underPanel === 'red|blue',
    `${previewed} → ${underPanel}`,
  );
  check(
    '...and stays undone once the panel is closed',
    (await names()) === 'red|blue' && !(await handle()),
    await names(),
  );

  // The ×: takes that side out; the tab stays.
  const rightMiddle = (await shownPages())[1];
  xm('move', o.x + rightMiddle.x + rightMiddle.width / 2, o.y + top + 20);
  await wait(500);
  box = await floatingBox();
  const close = { x: box.x + box.width - 20 - 15, y: box.y + box.height / 2 };
  xm('move', o.x + close.x, o.y + close.y);
  await wait(200);
  xm('down');
  await wait(60);
  xm('up');
  await wait(900);
  const rows = await ui.evaluate(() =>
    [...document.querySelectorAll('.space-tabs .tab[data-kind="everyday"]')]
      .map((t) => t.textContent)
      .join('|'),
  );
  check(
    'its ×: that side leaves the split, the tab stays in the sidebar',
    (await names()) === 'red' &&
      /Blue/.test(rows) &&
      !(await ui.evaluate(() => !!document.querySelector('.split-row'))),
    `${await names()} / ${rows}`,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('TEST ERROR', e.message);
  process.exit(1);
});
