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
    'rm -f /root/.config/Firn/session.json /root/.config/Firn/permissions.json',
  );
  const app = await _electron.launch({
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '.'],
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
  const open = async (u) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(u);
    await fl.keyboard.press('Enter');
    await wait(1500);
  };
  await open('127.0.0.1:8765/perm.html');
  const pg = app.windows().find((w) => w.url().includes('perm.html'));
  const prompt = () =>
    fl.evaluate(() => {
      const c = document.querySelector('.permission-card');
      return c ? c.querySelector('p').textContent : null;
    });
  const result = async () => {
    const r = await pg.evaluate(() => window.result ?? null);
    await pg.evaluate(() => {
      window.result = null;
    });
    return r;
  };
  const flBounds = () =>
    app.evaluate(({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (c) => c.webContents.getURL().includes('view=floating'),
      );
      return { ...v.getBounds(), visible: v.getVisible() };
    });
  const page = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]
      .contentView.children.find((c) =>
        /perm.html/.test(c.webContents.getURL()),
      )
      .getBounds(),
  );

  await pg.click('#notify');
  await wait(600);
  check(
    'a site asking for notifications gets a prompt',
    (await prompt()) === '127.0.0.1:8765 wants to show notifications',
    await prompt(),
  );
  const b = await flBounds();
  check(
    '...a small card at the top-left of the page',
    b.visible &&
      b.x === page.x + 12 - 20 &&
      b.y === page.y + 12 - 20 &&
      b.width === 420 &&
      b.height === 152,
    JSON.stringify({ b, page }),
  );
  check(
    "...that doesn't take the keyboard from the page",
    await app.evaluate(
      ({ webContents }) =>
        !webContents
          .getFocusedWebContents()
          ?.getURL()
          .includes('view=floating'),
    ),
  );
  execSync(
    `import -window root -crop 560x260+${page.x - 20}+0 ${SP}/perm-prompt.png`,
  );
  await fl.click('.permission-button.is-allow');
  await wait(500);
  check(
    'Allow: the site gets it',
    (await result()) === 'notify:granted' && (await prompt()) === null,
  );
  check(
    '...and can see that it may',
    (await pg.evaluate(() => Notification.permission)) === 'granted',
  );
  await pg.reload();
  await wait(1200);
  await pg.click('#notify');
  await wait(500);
  check(
    'asking again: answered from memory, no prompt',
    (await result()) === 'notify:granted' && (await prompt()) === null,
  );

  await pg.click('#cam');
  await wait(800);
  check(
    'camera and microphone together: one prompt',
    (await prompt()) ===
      '127.0.0.1:8765 wants to use your camera and microphone',
    await prompt(),
  );
  await fl.click('.permission-button:not(.is-allow)');
  await wait(600);
  check(
    'Block: the site is refused',
    (await result()) === 'cam:NotAllowedError',
  );
  await pg.click('#cam');
  await wait(600);
  check(
    'asking again: refused from memory, no prompt',
    (await result()) === 'cam:NotAllowedError' && (await prompt()) === null,
  );

  // dismiss with Esc
  await pg.click('#loc');
  await wait(600);
  check(
    'location prompt',
    (await prompt()) === '127.0.0.1:8765 wants to know your location',
    await prompt(),
  );
  await fl.focus('.permission-button');
  await fl.keyboard.press('Escape');
  await wait(500);
  check(
    'Esc closes it without answering (refused this time)',
    (await prompt()) === null && /^loc:1$/.test(String(await result())),
  );
  await pg.click('#loc');
  await wait(600);
  check(
    '...so it asks again next time',
    (await prompt()) === '127.0.0.1:8765 wants to know your location',
    await prompt(),
  );
  // switch tabs while asked: waits
  await ui.locator('.tab').nth(1).click();
  await wait(600);
  check(
    'switching to another tab puts the prompt away',
    (await prompt()) === null && !(await flBounds()).visible,
  );
  await ui.locator('.tab', { hasText: 'Permission page' }).click();
  await wait(800);
  check(
    '...and it comes back with the tab',
    (await prompt()) === '127.0.0.1:8765 wants to know your location',
    await prompt(),
  );
  await fl.click('.permission-button:not(.is-allow)');
  await wait(400);

  // the address bar button
  check(
    'the address bar shows a site button',
    await ui.evaluate(() => !!document.querySelector('.site-button')),
  );
  await ui.click('.site-button');
  await wait(300);
  const menu = await app.evaluate(() =>
    globalThis.__menu.map((i) =>
      i.type === 'separator'
        ? '—'
        : i.label +
          (i.submenu
            ? '[' + i.submenu.filter((s) => s.checked).map((s) => s.label) + ']'
            : ''),
    ),
  );
  check(
    '...listing what it may use',
    menu.join('|') ===
      '127.0.0.1:8765|—|Notifications[Allow]|Camera[Block]|Microphone[Block]|Location[Block]|—|Ask again next time',
    menu.join(' | '),
  );
  await app.evaluate(() =>
    globalThis.__menu
      .find((i) => i.label === 'Camera')
      .submenu.find((s) => s.label === 'Allow')
      .click(),
  );
  await wait(300);
  await app.evaluate(() =>
    globalThis.__menu
      .find((i) => i.label === 'Microphone')
      .submenu.find((s) => s.label === 'Allow')
      .click(),
  );
  await wait(300);
  await pg.click('#cam');
  await wait(800);
  check(
    'changing an answer there takes effect',
    (await result()) === 'cam:ok' && (await prompt()) === null,
  );
  await wait(800);
  const saved = JSON.parse(
    fs.readFileSync('/root/.config/Firn/permissions.json', 'utf8'),
  ).sites['http://127.0.0.1:8765'];
  check(
    'answers are saved for next time',
    saved &&
      saved.notifications === 'allow' &&
      saved.camera === 'allow' &&
      saved.location === 'block',
    JSON.stringify(saved),
  );
  await ui.click('.site-button');
  await wait(300);
  await app.evaluate(() =>
    globalThis.__menu.find((i) => i.label === 'Ask again next time').click(),
  );
  await wait(500);
  const gone = await ui.evaluate(() => !document.querySelector('.site-button'));
  const before = await pg.evaluate(() => Notification.permission);
  await pg.reload();
  await wait(1200);
  const after = await pg.evaluate(() => Notification.permission);
  check(
    '"Ask again next time" forgets them (button goes away)',
    gone,
    `button gone: ${gone}, before reload: ${before}, after: ${after}`,
  );
  const pg2 = app.windows().find((w) => w.url().includes('perm.html'));
  await pg2.click('#notify');
  await wait(600);
  check(
    '...and the site gets the prompt again',
    (await prompt()) === '127.0.0.1:8765 wants to show notifications',
    await prompt(),
  );

  // Asking twice before you answer (sites often do): one answer settles
  // both, no second prompt.
  await pg2.evaluate(() => {
    window.second = null;
    Notification.requestPermission().then((r) => (window.second = r));
  });
  await wait(400);
  await fl.click('.permission-button.is-allow');
  await wait(800);
  const answered = await pg2.evaluate(() => [window.result, window.second]);
  check(
    'a site asking twice: one answer settles both, no second prompt',
    (await prompt()) === null &&
      answered[0] === 'notify:granted' &&
      answered[1] === 'granted',
    JSON.stringify({ prompt: await prompt(), answered }),
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})();
