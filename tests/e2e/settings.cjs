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
  execSync(
    'rm -rf /tmp/fdl2 && mkdir -p /tmp/fdl2 /root/.config/Firn && rm -f /root/.config/Firn/session.json /root/.config/Firn/settings.json /root/.config/Firn/downloads.json',
  );
  require('fs').writeFileSync(
    '/root/.config/Firn/settings.json',
    JSON.stringify({
      onboarded: true,
      // A current install (not just updated, so no What's new).
      lastVersion: require('../../package.json').version,
    }),
  );
  fs.writeFileSync(
    '/root/.config/Firn/permissions.json',
    JSON.stringify({
      version: 1,
      sites: { 'https://example.com': { camera: 'allow' } },
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
  await app.evaluate(({ Menu, dialog }) => {
    Menu.buildFromTemplate = (t) => {
      globalThis.__menu = t;
      return { popup() {} };
    };
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: ['/tmp/fdl2'],
    });
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const ev = (type, keyCode, modifiers) =>
    app.evaluate(
      ({ webContents }, a) => {
        const w =
          webContents.getFocusedWebContents() ||
          webContents.getAllWebContents()[0];
        w.sendInputEvent(a);
      },
      { type, keyCode, modifiers },
    );
  const key = async (k) => {
    await ev('keyDown', 'Control', ['control']);
    await ev('keyDown', k, ['control']);
    await ev('keyUp', k, ['control']);
    await ev('keyUp', 'Control', []);
  };
  const shown = () =>
    fl.evaluate(() => !!document.querySelector('.settings-sheet'));
  const saved = () =>
    JSON.parse(fs.readFileSync('/root/.config/Firn/settings.json', 'utf8'));

  // the ⋯ menu
  await ui.click('.firn-menu-button');
  await wait(300);
  const labels = await app.evaluate(() =>
    globalThis.__menu.map((i) => (i.type === 'separator' ? '—' : i.label)),
  );
  check(
    "the sidebar's ⋯ menu: new tab, new space, history, archived tabs, passwords, downloads, settings, what's new",
    labels.join('|') ===
      "New tab|New space|—|History|Archived tabs|Passwords|Downloads|—|Settings|What's new",
    labels.join(' | '),
  );
  // the archive box, at the bottom right: its right-click menu opens the
  // Archive or chooses how long until tabs are tidied away
  await ui.click('[data-testid="archive-box"]', { button: 'right' });
  await wait(300);
  const boxMenu = await app.evaluate(() =>
    globalThis.__menu.map((i) =>
      i.type === 'separator'
        ? '—'
        : i.submenu
          ? `${i.label}: ${i.submenu.map((c) => (c.checked ? `[${c.label}]` : c.label)).join(', ')}`
          : i.label,
    ),
  );
  check(
    "the archive box's right-click menu: show, and how long (7 days at first)",
    boxMenu.join(' | ') ===
      "Show archived tabs | — | Archive tabs you haven't used for: 1 day, [7 days], 30 days, Never",
    boxMenu.join(' | '),
  );
  await app.evaluate(() =>
    globalThis.__menu[2].submenu.find((i) => i.label === '30 days').click(),
  );
  await wait(300);
  check(
    '...choosing 30 days there changes the setting',
    saved().archiveAfter === 30,
    String(saved().archiveAfter),
  );
  // (back to 7 days for the checks after this one)
  await ui.click('[data-testid="archive-box"]', { button: 'right' });
  await wait(300);
  await app.evaluate(() =>
    globalThis.__menu[2].submenu.find((i) => i.label === '7 days').click(),
  );
  await wait(300);
  await ui.click('.firn-menu-button');
  await wait(300);
  await app.evaluate(() =>
    globalThis.__menu.find((i) => i.label === 'Settings').click(),
  );
  await wait(600);
  check('...Settings opens the settings panel', await shown());
  const v = await fl.evaluate(() => ({
    engine: document.querySelector('.dropdown-button span').textContent,
    theme: document.querySelector('.segmented .is-on')?.textContent,
    folder: [...document.querySelectorAll('.settings-row')]
      .find((r) => r.textContent.includes('Save files to'))
      .querySelector('small').textContent,
    foot: document.querySelector('.sheet-footer span').textContent,
  }));
  check(
    '...showing DuckDuckGo, Match system, the downloads folder and the version',
    v.engine === 'DuckDuckGo' &&
      v.theme === 'Match system' &&
      !!v.folder &&
      /^Firn \d/.test(v.foot),
    JSON.stringify(v),
  );
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  execSync(
    `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${SP}/settings.png`,
  );
  // search engine
  await fl.click('.dropdown-button');
  await wait(300);
  const opts = await fl.evaluate(() =>
    [...document.querySelectorAll('.dropdown-option')].map(
      (o) =>
        o.textContent + (o.getAttribute('aria-selected') === 'true' ? '*' : ''),
    ),
  );
  check(
    'the search engine dropdown lists the five engines',
    opts.join(',') === 'DuckDuckGo*,Google,Bing,Ecosia,Startpage',
    opts.join(','),
  );
  await fl.keyboard.press('Escape');
  await wait(300);
  check(
    'Esc closes just the list, not settings',
    (await shown()) &&
      !(await fl.evaluate(() => !!document.querySelector('.dropdown-list'))),
  );
  await fl.click('.dropdown-button');
  await wait(300);
  await fl.click('.dropdown-option:has-text("Google")');
  await wait(500);
  check(
    'choosing Google is saved',
    saved().searchEngine === 'google',
    JSON.stringify(saved()),
  );
  await fl.keyboard.press('Escape');
  await wait(300);
  check('Esc closes the panel', !(await shown()));
  await key('T');
  await wait(300);
  await fl.keyboard.type('glacier ice');
  await fl.keyboard.press('Enter');
  await wait(800);
  const urls = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((w) => w.getURL()),
  );
  check(
    '...and searches now use Google',
    urls.some((u) =>
      u.startsWith('https://www.google.com/search?q=glacier%20ice'),
    ),
    urls.filter((u) => /search/.test(u)).join(' '),
  );
  // theme
  await key(',');
  await wait(500);
  check('Ctrl+, opens settings', await shown());
  await fl.click('.segmented button:has-text("Dark")');
  await wait(500);
  const dark =
    (await ui.evaluate(
      () =>
        document.documentElement.dataset.theme === 'dark' &&
        getComputedStyle(document.documentElement)
          .getPropertyValue('--frame')
          .trim() === '#3a3734',
    )) &&
    (await fl.evaluate(
      () => document.documentElement.dataset.theme === 'dark',
    ));
  check(
    'choosing Dark turns Firn dark',
    dark && saved().theme === 'dark',
    `${dark} ${saved().theme}`,
  );
  await fl.click('.dropdown-button');
  await wait(300);
  const listBg = await fl.evaluate(
    () =>
      getComputedStyle(document.querySelector('.dropdown-list'))
        .backgroundColor,
  );
  check(
    '...and the dropdown list is dark too',
    listBg === 'rgb(43, 40, 38)',
    listBg,
  );
  execSync(
    `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${SP}/settings-dark.png`,
  );
  await fl.keyboard.press('Escape');
  await wait(200);
  await fl.click('.segmented button:has-text("Light")');
  await wait(400);
  check(
    '...and Light turns it light',
    await ui.evaluate(() => document.documentElement.dataset.theme === 'light'),
  );
  // downloads folder
  await fl.click('.settings-row:has-text("Save files to") .sheet-button');
  await wait(500);
  const folder = await fl.evaluate(
    () =>
      [...document.querySelectorAll('.settings-row')]
        .find((r) => r.textContent.includes('Save files to'))
        .querySelector('small').textContent,
  );
  check(
    'changing the downloads folder shows the new one',
    folder === '/tmp/fdl2' && saved().downloadsFolder === '/tmp/fdl2',
    folder,
  );
  await fl.keyboard.press('Escape');
  await wait(300);
  await ui.click('.new-tab');
  await wait(300);
  await fl.keyboard.type('127.0.0.1:8765/dl.html');
  await fl.keyboard.press('Enter');
  await wait(1500);
  const pg = app.windows().find((w) => w.url().includes('dl.html'));
  await pg.evaluate(() => {
    document.cookie = 'firntest=1; max-age=3600';
  });
  await pg.click('#small');
  await wait(1200);
  check(
    '...and downloads go there',
    fs.existsSync('/tmp/fdl2/notes.txt'),
    fs.readdirSync('/tmp/fdl2').join(','),
  );
  // privacy
  await key(',');
  await wait(500);
  await fl.click(
    '.settings-row:has-text("Cookies and site data") .sheet-button',
  );
  await wait(1000);
  await pg.reload();
  await wait(1000);
  const cookie = await pg.evaluate(() => document.cookie);
  check(
    '"Clear…" (after you confirm) clears cookies and site data',
    !cookie.includes('firntest'),
    cookie,
  );
  await key(',');
  await wait(500);
  await fl.click('.settings-row:has-text("Site permissions") .sheet-button');
  await wait(800);
  const perms = JSON.parse(
    fs.readFileSync('/root/.config/Firn/permissions.json', 'utf8'),
  ).sites;
  const btn = await fl.evaluate(
    () =>
      document.querySelector('.settings-row:nth-child(4) .sheet-button')
        ?.textContent ??
      [...document.querySelectorAll('.sheet-button')]
        .map((b) => b.textContent)
        .join(','),
  );
  check(
    '"Reset all" forgets every site\'s permission answers',
    Object.keys(perms).length === 0,
    JSON.stringify(perms),
  );
  await fl.click('.settings-row:has-text("History") .sheet-button');
  await wait(300);
  check(
    '"Clear history…" offers the same choices as the history panel',
    (
      await app.evaluate(() =>
        globalThis.__menu.map((i) => i.label).filter(Boolean),
      )
    ).includes('All time'),
  );
  await fl.keyboard.press('Escape');
  await wait(300);
  await key('T');
  await wait(300);
  await fl.keyboard.type('settings');
  await wait(300);
  await fl.locator('.result', { hasText: /^Settings/ }).click();
  await wait(500);
  check('the command bar offers "Settings"', await shown());
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})();
