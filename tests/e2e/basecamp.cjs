// Basecamp: dragging a tile reorders the grid (and a click is still a click).
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
      // A current install (not just updated, so no What's new).
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
  await app.evaluate(({ Menu }) => {
    Menu.buildFromTemplate = (t) => {
      globalThis.__menu = t;
      return { popup() {} };
    };
  });
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );

  // Four sites, each added to Basecamp from its tab's menu.
  for (const color of ['red', 'green', 'blue', 'gray']) {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${color}.html`);
    await fl.keyboard.press('Enter');
    await wait(1200);
    await app.evaluate(() => {
      globalThis.__menu = null;
    });
    await ui.click('.space-tabs .tab.is-active', { button: 'right' });
    await wait(300);
    await app.evaluate(() =>
      globalThis.__menu
        .find((i) => i.label?.startsWith('Add to Basecamp'))
        .click(),
    );
    await wait(400);
  }
  const order = () =>
    ui.evaluate(() =>
      [...document.querySelectorAll('.basecamp-tile')].map((t) =>
        t.dataset.tip.replace(' site', ''),
      ),
    );
  const boxes = () =>
    ui.evaluate(() =>
      [...document.querySelectorAll('.basecamp-tile')].map((t) => {
        const r = t.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
    );
  const start = await order();
  check(
    'four sites in Basecamp, in the order they were added',
    start.join(',') === 'Red,Green,Blue,Gray',
    start.join(','),
  );

  // Drag the first tile onto the third one's spot.
  let b = await boxes();
  await ui.mouse.move(b[0].x, b[0].y);
  await ui.mouse.down();
  for (let i = 1; i <= 10; i++)
    await ui.mouse.move(
      b[0].x + ((b[2].x - b[0].x) * i) / 10,
      b[0].y + ((b[2].y - b[0].y) * i) / 10,
    );
  await wait(300);
  const mid = await ui.evaluate(() => {
    const tiles = [...document.querySelectorAll('.basecamp-tile')];
    return {
      lifted: tiles[0].classList.contains('is-dragged'),
      // Green and Blue step back one spot to make room; Gray stays.
      aside: tiles.map((t) => t.style.transform || ''),
    };
  });
  execSync(
    `import -window root -crop 280x160+${o.x}+${o.y + 40} ${SP}/basecamp-drag.png`,
  );
  check(
    'while dragging: the tile lifts and follows, the others glide aside',
    mid.lifted &&
      mid.aside[1].startsWith('translate(-') &&
      mid.aside[2].startsWith('translate(-') &&
      mid.aside[3] === '',
    JSON.stringify(mid),
  );
  await ui.mouse.up();
  await wait(600);
  const after = await order();
  check(
    'dropping it there reorders Basecamp',
    after.join(',') === 'Green,Blue,Red,Gray',
    after.join(','),
  );
  const settled = await ui.evaluate(() =>
    [...document.querySelectorAll('.basecamp-tile')].every(
      (t) => !t.style.transform,
    ),
  );
  check('...and every tile settles into its place', settled);
  const saved = await ui.evaluate(async () =>
    (await window.firn.allTabs())
      .filter((t) => t.basecamp)
      .map((t) => t.title.replace(' site', '')),
  );
  check(
    '...and the new order is kept (saved with the session)',
    saved.join(',') === 'Green,Blue,Red,Gray',
    saved.join(','),
  );

  // Dragged a little and let go where it started: nothing changes.
  b = await boxes();
  await ui.mouse.move(b[3].x, b[3].y);
  await ui.mouse.down();
  await ui.mouse.move(b[3].x + 12, b[3].y + 6, { steps: 4 });
  await ui.mouse.move(b[3].x + 2, b[3].y, { steps: 4 });
  await ui.mouse.up();
  await wait(500);
  check(
    'let go near where it started: the order stays',
    (await order()).join(',') === 'Green,Blue,Red,Gray',
  );

  // A plain click still just switches to the site.
  await ui.mouse.click(b[1].x, b[1].y);
  await wait(400);
  const clicked = await ui.evaluate(() => ({
    active: document
      .querySelector('.basecamp-tile.is-active')
      ?.dataset.tip.replace(' site', ''),
    order: [...document.querySelectorAll('.basecamp-tile')]
      .map((t) => t.dataset.tip.replace(' site', ''))
      .join(','),
  }));
  check(
    'a click switches to the site without moving anything',
    clicked.active === 'Blue' && clicked.order === 'Green,Blue,Red,Gray',
    JSON.stringify(clicked),
  );

  // Dragging the last tile to the front.
  b = await boxes();
  await ui.mouse.move(b[3].x, b[3].y);
  await ui.mouse.down();
  await ui.mouse.move(b[0].x - 20, b[0].y, { steps: 12 });
  await ui.mouse.up();
  await wait(600);
  const front = await order();
  check(
    'the last tile dragged to the front goes first',
    front.join(',') === 'Gray,Green,Blue,Red',
    front.join(','),
  );
  // The rows as even as they can be: 4 tiles in one row, then 5 as 3 + 2
  // and 6 as 3 + 3 (not 4 + 1 and 4 + 2).
  const rows = () =>
    ui.evaluate(() => {
      const counts = new Map();
      for (const t of document.querySelectorAll('.basecamp-tile')) {
        const top = Math.round(t.getBoundingClientRect().top);
        counts.set(top, (counts.get(top) ?? 0) + 1);
      }
      return [...counts.values()].join('+');
    });
  const four = await rows();
  const more = [];
  for (const color of ['mix', 'dark']) {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${color}.html`);
    await fl.keyboard.press('Enter');
    await wait(1200);
    await ui.evaluate(() => window.firn.runAction('basecamp'));
    await wait(600);
    more.push(await rows());
  }
  check(
    'tiles share their rows evenly: 4 in one row, 5 as 3 + 2, 6 as 3 + 3',
    four === '4' && more[0] === '3+2' && more[1] === '3+3',
    `${four}, ${more.join(', ')}`,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('TEST ERROR', e.message);
  process.exit(1);
});
