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

  // A link opened from a split view's left side lands below the split
  // row, never between its two sides (which broke the row apart).
  await open('gray.html');
  await open('mix.html');
  await dragIn('Gray');
  check('a new split view', (await names()) === 'mix|gray', await names());
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]
      .contentView.children.find(
        (v) => v.webContents && v.webContents.getURL().endsWith('/mix.html'),
      )
      .webContents.executeJavaScript(
        "window.open('http://127.0.0.1:8765/two.html')",
        true,
      ),
  );
  await wait(1500);
  const rows = await ui.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.space-tabs .split-row, .space-tabs .tab[data-kind="everyday"]:not(.split-row)',
      ),
    ].map((r) =>
      r.classList.contains('split-row')
        ? 'split:' +
          [...r.querySelectorAll('.tab-title')]
            .map((t) => t.textContent.split(' ')[0])
            .join('+')
        : r.querySelector('.tab-title').textContent.split(' ')[0],
    ),
  );
  const at = rows.findIndex((r) => r.startsWith('split:'));
  check(
    'a link from the left side: the split row stays whole',
    at >= 0 && /Mix/.test(rows[at]) && /Gray/.test(rows[at]),
    rows.join(' / '),
  );
  check(
    '...and the new tab sits right below it',
    rows[at + 1] === 'Page',
    rows.join(' / '),
  );

  // Switching spaces mid-drag (as Ctrl+2 would) cancels the drag: the
  // carried tab goes, and nothing is left waiting for it.
  await ui.evaluate(() => window.firn.runAction('new-space', ''));
  await wait(600);
  await ui.keyboard.press('Enter');
  await wait(400);
  await ui.locator('[data-testid="space"]').first().click();
  await wait(1000);
  const carriedNow = () =>
    fl.evaluate(() => !!document.querySelector('.carried-tab:not(.is-let-go)'));
  const pageRow = ui.locator('.space-tabs .tab[data-kind="everyday"]', {
    hasText: 'Page',
  });
  const pb = await pageRow.boundingBox();
  await ui.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await ui.mouse.down();
  await ui.mouse.move(pb.x + pb.width / 2 + 60, pb.y + pb.height / 2, {
    steps: 4,
  });
  await ui.mouse.move(area.right, area.middle, { steps: 8 });
  await wait(500);
  const carrying = await carriedNow();
  await ui.evaluate(() =>
    document
      .querySelector('[data-testid="space"][data-space="New space"]')
      .click(),
  );
  await wait(1200);
  check(
    'switching spaces mid-drag: the carried tab goes',
    carrying && !(await carriedNow()),
    `${carrying} → ${await carriedNow()}`,
  );
  check(
    '...and the new space shows its empty page, nothing left over it',
    (await names()) === '' &&
      (await ui.locator('.empty-page').count()) === 1 &&
      !(await ui.evaluate(() => !!document.querySelector('.drop-card'))),
    await names(),
  );
  await ui.mouse.up();
  await wait(600);
  const floatingShown = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.some(
        (v) =>
          v.webContents?.getURL().includes('view=floating') && v.getVisible(),
      ),
    );
  check(
    '...and letting go afterwards leaves nothing over the window',
    (await names()) === '' && !(await floatingShown()),
    `${await names()} floating shown: ${await floatingShown()}`,
  );
  // Back in the first space: the tab is in its place, not still carried.
  await ui.locator('[data-testid="space"]').first().click();
  await wait(1000);
  check(
    '...and back in its space, the tab is in its place, not carried',
    !(await carriedNow()) && (await pageRow.count()) === 1,
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
