// Dragging between Basecamp and a space's tabs: a tab dragged up past the
// list's top opens a spot in Basecamp and joins it there; a tile dragged
// down into the list opens a gap and becomes an everyday tab (below the
// divider) or a pinned tab (above it).
const { _electron } = require('./playwright.cjs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { execSync } = require('child_process');
const shot = (name) =>
  execSync(
    `import -window root -crop 420x900+0+0 ${process.env.SP}/${name}.png`,
  );
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
(async () => {
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const open = async (page) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(1200);
  };
  // Red and Green in Basecamp; Blue and Gray as everyday tabs.
  for (const page of ['red.html', 'green.html']) {
    await open(page);
    await ui.evaluate(() => window.firn.runAction('basecamp'));
    await wait(500);
  }
  await open('blue.html');
  await open('gray.html');

  const state = () =>
    ui.evaluate(() => ({
      tiles: [...document.querySelectorAll('.basecamp-tile[data-tile]')]
        .filter((t) => t.dataset.tile !== 'incoming')
        .map((t) => t.getAttribute('aria-label') || t.dataset.tip || ''),
      pinned: [
        ...document.querySelectorAll('.space-tabs .tab[data-kind="pinned"]'),
      ].map((t) => t.textContent.trim()),
      everyday: [
        ...document.querySelectorAll('.space-tabs .tab[data-kind="everyday"]'),
      ].map((t) => t.textContent.trim()),
    }));
  const center = async (locator) => {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const tile = (name) =>
    ui.locator(
      `.basecamp-tile[data-tip*="${name}"], .basecamp-tile[aria-label*="${name}"]`,
    );
  const row = (name) =>
    ui.locator('.space-tabs .tab[data-kind]', { hasText: name });

  // A tab up into Basecamp, between Red and Green.
  const blue = await center(row('Blue site'));
  const red = await center(tile('Red'));
  const green = await center(tile('Green'));
  await ui.mouse.move(blue.x, blue.y);
  await ui.mouse.down();
  await ui.mouse.move(blue.x, blue.y - 20, { steps: 3 });
  await ui.mouse.move((red.x + green.x) / 2, red.y, { steps: 10 });
  await wait(300);
  const spot = await ui.evaluate(
    () => !!document.querySelector('.basecamp-tile.is-incoming'),
  );
  check('a tab dragged up over Basecamp opens a spot there', spot);
  shot('basecamp-drag-in');
  await ui.mouse.up();
  await wait(900);
  let s = await state();
  check(
    '...and joins Basecamp there, leaving the tabs',
    s.tiles.length === 3 &&
      s.tiles[1].includes('Blue') &&
      !s.everyday.some((t) => t.includes('Blue')),
    JSON.stringify(s),
  );

  // A tile down into the everyday tabs.
  const redNow = await center(tile('Red'));
  const gray = await center(row('Gray site'));
  await ui.mouse.move(redNow.x, redNow.y);
  await ui.mouse.down();
  await ui.mouse.move(redNow.x, redNow.y + 20, { steps: 3 });
  await ui.mouse.move(gray.x, gray.y + 10, { steps: 12 });
  await wait(300);
  const gap = await ui.evaluate(() =>
    [...document.querySelectorAll('.space-tabs [data-item]')].some((el) =>
      /translateY\(40px\)/.test(el.style.transform),
    ),
  );
  check('a tile dragged down over the tabs opens a gap there', gap);
  shot('basecamp-drag-out');
  await ui.mouse.up();
  await wait(900);
  s = await state();
  check(
    '...and becomes an everyday tab, leaving Basecamp',
    !s.tiles.some((t) => t.includes('Red')) &&
      s.everyday.some((t) => t.includes('Red')),
    JSON.stringify(s),
  );

  // A tile down above the divider: it becomes a pinned tab.
  const greenNow = await center(tile('Green'));
  const divider = await center(ui.locator('.space-divider'));
  await ui.mouse.move(greenNow.x, greenNow.y);
  await ui.mouse.down();
  await ui.mouse.move(greenNow.x, greenNow.y + 20, { steps: 3 });
  await ui.mouse.move(divider.x, divider.y - 6, { steps: 10 });
  await wait(300);
  await ui.mouse.up();
  await wait(900);
  s = await state();
  check(
    'a tile let go above the divider becomes a pinned tab',
    !s.tiles.some((t) => t.includes('Green')) &&
      s.pinned.some((t) => t.includes('Green')),
    JSON.stringify(s),
  );

  // Pulled just out of Basecamp and let go over the space's name (above
  // the list itself): no dead strip, it lands at the top of the pins.
  const blueNow = await center(tile('Blue'));
  const gridBottom = await ui.evaluate(
    () =>
      document.querySelector('.basecamp-grid').getBoundingClientRect().bottom,
  );
  await ui.mouse.move(blueNow.x, blueNow.y);
  await ui.mouse.down();
  await ui.mouse.move(blueNow.x, gridBottom + 8, { steps: 6 });
  await wait(300);
  await ui.mouse.up();
  await wait(900);
  s = await state();
  check(
    'a tile let go just under Basecamp becomes the first pinned tab',
    !s.tiles.some((t) => t.includes('Blue')) && s.pinned[0]?.includes('Blue'),
    JSON.stringify(s),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
