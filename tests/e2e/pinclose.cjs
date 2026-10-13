// Closing a pinned tab, as in Zen: its first button unloads it (it rests,
// quieter); once it rests, and the mouse has left the row and come back, an
// × takes the pin away (so a double-click can't). Ctrl+Shift+T puts it back,
// a pin again, in its old place. The right-click menu offers the same step.
const { _electron } = require('./playwright.cjs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
(async () => {
  require('child_process').execSync('rm -f /root/.config/Firn/session.json');
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
  // Red and Gray pinned, Blue an everyday tab on screen.
  for (const page of ['red.html', 'gray.html']) {
    await open(page);
    await ui.evaluate(() => window.firn.runAction('pin'));
    await wait(400);
  }
  await open('blue.html');

  const pins = () =>
    ui.evaluate(() =>
      [
        ...document.querySelectorAll('.space-tabs .tab[data-kind="pinned"]'),
      ].map((t) => ({
        title: t.textContent.trim(),
        resting: t.classList.contains('is-unloaded'),
      })),
    );
  const row = () =>
    ui.locator('.space-tabs .tab[data-kind="pinned"]', { hasText: 'Red' });
  const buttonSpot = async () => {
    const b = await row().boundingBox();
    return { x: b.x + b.width - 18, y: b.y + b.height / 2 };
  };
  const removeShown = () =>
    row()
      .locator('[data-testid="remove-pin"]')
      .count()
      .then((n) => n > 0);

  let p = await pins();
  check(
    'two pinned tabs to start',
    p.length === 2 && p.every((t) => !t.resting),
    JSON.stringify(p),
  );

  // A double-click on the unload button: the pin rests, and stays.
  const spot = await buttonSpot();
  await ui.mouse.move(spot.x, spot.y);
  await wait(300);
  await ui.mouse.dblclick(spot.x, spot.y);
  await wait(600);
  p = await pins();
  check(
    'a double-click on the unload button only unloads the pin',
    p.length === 2 && p[0].title.includes('Red') && p[0].resting,
    JSON.stringify(p),
  );
  check('...and no × while the mouse is still there', !(await removeShown()));

  // Away and back: the × appears.
  await ui.mouse.move(spot.x, spot.y + 300);
  await wait(200);
  await ui.mouse.move(spot.x, spot.y);
  await wait(300);
  check('away and back, the resting pin offers an ×', await removeShown());
  await ui.mouse.click(spot.x, spot.y);
  await wait(600);
  p = await pins();
  check(
    'the × takes the pin away',
    p.length === 1 && !p.some((t) => t.title.includes('Red')),
    JSON.stringify(p),
  );

  // Ctrl+Shift+T: back as a pin, in its old place.
  await ui.evaluate(() => window.firn.runAction('reopen'));
  await wait(1200);
  p = await pins();
  check(
    'reopening puts it back, a pin again, in its old place',
    p.length === 2 && p[0].title.includes('Red'),
    JSON.stringify(p),
  );
  const nav = await ui.evaluate(() =>
    document.querySelector('.tab.is-active')?.textContent.trim(),
  );
  check('...and shows it', (nav ?? '').includes('Red'), nav);

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
