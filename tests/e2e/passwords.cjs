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
    'rm -f /root/.config/Firn/session.json /root/.config/Firn/passwords.json',
  );
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
    env: { ...process.env, FIRN_INSECURE_TEST_PASSWORDS: '1' },
  });
  await wait(6000);
  await app.evaluate(({ Menu, dialog }) => {
    Menu.buildFromTemplate = (t) => {
      globalThis.__menu = t;
      return { popup() {} };
    };
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const open = async (u) => {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(u);
    await fl.keyboard.press('Enter');
    await wait(1500);
    return app
      .windows()
      .filter((w) => w.url().includes(u.split('/').pop()))
      .at(-1);
  };
  const prompt = () =>
    fl.evaluate(() => {
      const c = document.querySelector('.permission-card');
      return c ? c.textContent : null;
    });
  const stored = () => {
    try {
      return JSON.parse(
        fs.readFileSync('/root/.config/Firn/passwords.json', 'utf8'),
      ).entries;
    } catch {
      return [];
    }
  };

  let pg = await open('127.0.0.1:8765/login.html');
  const leaks = await pg.evaluate(() =>
    [
      typeof require,
      typeof window.ipcRenderer,
      typeof window.electron,
      typeof window.firn,
      typeof process,
    ].join(','),
  );
  check(
    "the page sees nothing of Firn's helper",
    leaks === 'undefined,undefined,undefined,undefined,undefined',
    leaks,
  );
  // a failed sign-in: no prompt
  await pg.fill('#email', 'david@example.com');
  await pg.fill('#pw', 'wrong');
  await pg.click('#go');
  await wait(1200);
  check(
    "a sign-in that fails (the page stays) doesn't ask",
    (await prompt()) === null,
    await prompt(),
  );
  // a sign-in that works
  await pg.fill('#pw', 'glacier-123');
  await pg.click('#go');
  await wait(1200);
  check(
    'after signing in, Firn offers to save the password',
    ((await prompt()) ?? '').includes('Save password for 127.0.0.1:8765?') &&
      (await prompt()).includes('david@example.com'),
    await prompt(),
  );
  const o = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  );
  execSync(
    `import -window root -crop 560x200+${o.x + 240}+${o.y} ${SP}/pw-prompt.png`,
  );
  await fl.click('.permission-button.is-allow');
  await wait(800);
  const s1 = stored();
  check(
    "Save: it's kept, encrypted (the password isn't in the file as text)",
    s1.length === 1 &&
      s1[0].username === 'david@example.com' &&
      !fs
        .readFileSync('/root/.config/Firn/passwords.json', 'utf8')
        .includes('glacier-123') /* stored encoded, not as text */,
    JSON.stringify(s1.map((e) => e.username)),
  );
  // fill on a new visit
  pg = await open('127.0.0.1:8765/login.html');
  check(
    'nothing is filled before you click into the form',
    (await pg.evaluate(() => document.getElementById('pw').value)) === '',
  );
  // A site's own script can't make Firn fill: not by moving focus into
  // the form, nor right after you clicked somewhere else on the page, nor
  // into a see-through form it slipped in.
  const values = () =>
    pg.evaluate(() =>
      [...document.querySelectorAll('input')].map((i) => i.value).join(''),
    );
  await pg.evaluate(() => document.getElementById('email').focus());
  await wait(600);
  const byScript = await values();
  await pg.evaluate(() => document.activeElement.blur());
  await pg.mouse.click(300, 400);
  await pg.evaluate(() => document.getElementById('pw').focus());
  await wait(600);
  const afterClickElsewhere = await values();
  await pg.evaluate(() => {
    document.activeElement.blur();
    const f = document.createElement('form');
    f.style.opacity = '0';
    f.innerHTML =
      '<input id="sneaky-user" type="email"><input id="sneaky-pw" type="password">';
    document.body.append(f);
  });
  const sneaky = await pg.evaluate(() => {
    const r = document.getElementById('sneaky-user').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await pg.mouse.click(sneaky.x, sneaky.y);
  await wait(600);
  const intoHidden = await values();
  await pg.evaluate(() => {
    document.activeElement.blur();
    document.querySelector('#sneaky-user').form.remove();
  });
  check(
    "a site's script can't make Firn fill a login (focus by script, a see-through form)",
    byScript === '' && afterClickElsewhere === '' && intoHidden === '',
    JSON.stringify([byScript, afterClickElsewhere, intoHidden]),
  );

  await pg.click('#email');
  await wait(600);
  const filled = await pg.evaluate(() => [
    document.getElementById('email').value,
    document.getElementById('pw').value,
  ]);
  check(
    'clicking into the login form fills it',
    filled[0] === 'david@example.com' && filled[1] === 'glacier-123',
    JSON.stringify(filled),
  );
  await pg.click('#go');
  await wait(1200);
  check(
    "signing in with the saved login doesn't ask again",
    (await prompt()) === null,
    await prompt(),
  );
  // changed password
  pg = await open('127.0.0.1:8765/login.html');
  await pg.click('#email');
  await wait(500);
  await pg.fill('#pw', 'new-secret-456');
  await pg.click('#go');
  await wait(1200);
  check(
    'a new password for the same login: "Update the password"',
    ((await prompt()) ?? '').includes(
      'Update the password for 127.0.0.1:8765?',
    ),
    await prompt(),
  );
  await fl.click('.permission-button.is-allow');
  await wait(800);
  // Not now
  pg = await open('127.0.0.1:8765/login.html');
  await pg.click('#email');
  await wait(600); // the saved login fills in first
  check(
    '(the saved login fills in; you can type over it)',
    (await pg.evaluate(() => document.getElementById('email').value)) ===
      'david@example.com',
  );
  await pg.fill('#email', 'other@example.com');
  await pg.fill('#pw', 'x1');
  await wait(300);
  console.log(
    'before submit',
    JSON.stringify(
      await pg.evaluate(() => [
        document.getElementById('email').value,
        document.getElementById('pw').value,
        location.href,
      ]),
    ),
  );
  await pg.click('#go');
  await wait(1200);
  console.log(
    'after submit',
    JSON.stringify(await pg.evaluate(() => location.href)),
    await prompt(),
    await fl.evaluate(() => document.body.innerText.slice(0, 80)),
  );
  await fl.click('.permission-button:not(.is-allow)', { timeout: 3000 });
  await wait(600);
  check(
    '"Not now" saves nothing',
    stored().length === 1,
    String(stored().length),
  );
  // panel
  await ui.evaluate(() => window.firn.runAction('passwords'));
  await wait(600);
  const rows = await fl.evaluate(() =>
    [...document.querySelectorAll('.password-row')].map((r) => [
      r.querySelector('.password-site').textContent,
      r.querySelector('.password-username').textContent,
      r.querySelector('.password-secret').textContent,
    ]),
  );
  check(
    'the passwords panel lists the login, password hidden',
    rows.length === 1 &&
      rows[0][0] === '127.0.0.1:8765' &&
      rows[0][1] === 'david@example.com' &&
      rows[0][2] === '••••••••',
    JSON.stringify(rows),
  );
  execSync(
    `import -window root -crop ${o.width}x${o.height}+${o.x}+${o.y} ${SP}/pw-panel.png`,
  );
  await fl.locator('.password-row').hover();
  await fl.click('.password-row button[data-tip="Show"]');
  await wait(300);
  check(
    'Show reveals the (updated) password',
    (await fl.evaluate(
      () => document.querySelector('.password-secret').textContent,
    )) === 'new-secret-456',
  );
  await fl.click('.password-row button[data-tip="Copy password"]');
  await wait(300);
  check(
    'Copy puts it on the clipboard',
    (await app.evaluate(({ clipboard }) => clipboard.readText())) ===
      'new-secret-456',
  );
  await fl.click('.password-row button[data-tip="Delete"]');
  await wait(800);
  check(
    'Delete (after you confirm) removes it',
    stored().length === 0 &&
      (await fl.evaluate(
        () => document.querySelectorAll('.password-row').length,
      )) === 0,
  );
  await fl.keyboard.press('Escape');
  await wait(300);
  await ui.click('.firn-menu-button');
  await wait(300);
  check(
    'the Firn menu has "Passwords"',
    (await app.evaluate(() => globalThis.__menu.map((i) => i.label))).includes(
      'Passwords',
    ),
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})();
