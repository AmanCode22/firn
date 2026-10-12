// Leaving a split view by pinning a tab or adding it to Basecamp: the split
// comes apart, and only the tab you're on stays on the page (the other
// half used to stay on screen beside it).
const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const fs = require('fs');
const { execSync } = require('child_process');
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
  const open = async (page) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(1200);
  };
  // The web pages on screen, left to right.
  const names = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        .contentView.children.filter(
          (v) =>
            v.webContents &&
            v.getVisible() &&
            v.getBounds().width > 0 &&
            v.webContents.getURL().includes(':8765/'),
        )
        .sort((a, b) => a.getBounds().x - b.getBounds().x)
        .map((v) =>
          v.webContents.getURL().split('/').pop().replace('.html', ''),
        )
        .join('|'),
    );
  const area = await ui.evaluate(() => {
    const r = document.querySelector('.page-area').getBoundingClientRect();
    return { right: r.left + r.width * 0.75, middle: (r.top + r.bottom) / 2 };
  });
  // Drags a tab from the sidebar onto the page's right half.
  const dragIn = async (title) => {
    const row = ui.locator('.space-tabs .tab[data-kind="everyday"]', {
      hasText: title,
    });
    const b = await row.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await ui.mouse.move(x, y);
    await ui.mouse.down();
    await ui.mouse.move(x + 60, y, { steps: 4 });
    await ui.mouse.move(area.right, area.middle, { steps: 8 });
    await wait(400);
    await ui.mouse.up();
    await wait(1200);
  };

  await open('red.html');
  await open('blue.html');
  await dragIn('Red');
  check(
    'two pages side by side',
    (await names()) === 'blue|red',
    await names(),
  );
  await ui.evaluate(() => window.firn.runAction('pin'));
  await wait(800);
  const afterPin = await names();
  check(
    'pinning one of them: only the tab you are on stays on the page',
    afterPin.split('|').length === 1,
    afterPin,
  );

  await open('green.html');
  await dragIn('Blue');
  const before = await names();
  await ui.evaluate(() => window.firn.runAction('basecamp'));
  await wait(800);
  const afterBasecamp = await names();
  check(
    'adding one to Basecamp: the same',
    before.split('|').length === 2 && afterBasecamp.split('|').length === 1,
    `${before} → ${afterBasecamp}`,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
