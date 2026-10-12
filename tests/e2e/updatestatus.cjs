// Settings > Updates: where Firn's updates are, "Check for updates", and
// "Restart now" once a new version is ready (pretended here: a version
// arrives a moment after asking). A copy that can't update itself says
// why, with no button.
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
const launch = async (env) => {
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    env: { ...process.env, ...env },
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  await ui.evaluate(() => window.firn.runAction('settings'));
  await wait(700);
  return { app, fl };
};
const row = (fl) =>
  fl.evaluate(() => {
    const g = document.querySelector('[data-testid="updates"]');
    return g
      ? {
          name: g.querySelector('.settings-label span')?.textContent,
          status: g.querySelector('[data-testid="update-status"]')?.textContent,
          button: g.querySelector('button')?.textContent ?? null,
          disabled: g.querySelector('button')?.disabled ?? null,
        }
      : null;
  });

(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  fs.writeFileSync(
    '/root/.config/Firn/settings.json',
    JSON.stringify({
      onboarded: true,
      lastVersion: require('../../package.json').version,
    }),
  );
  const version = require('../../package.json').version;

  let { app, fl } = await launch({ FIRN_UPDATES_TEST: '1' });
  let r = await row(fl);
  check(
    'Settings > Updates: the version, and "Check for updates"',
    r?.name === `Firn ${version}` && r?.button === 'Check for updates',
    JSON.stringify(r),
  );
  await fl.click('[data-testid="updates"] button');
  await wait(150);
  r = await row(fl);
  check(
    '...checking: the button rests',
    r?.status === 'Checking for updates…' && r?.disabled === true,
    JSON.stringify(r),
  );
  await wait(1200);
  r = await row(fl);
  check(
    'a new version arrives: "Restart now"',
    /new version is ready/.test(r?.status ?? '') && r?.button === 'Restart now',
    JSON.stringify(r),
  );
  await app.close();
  await wait(1000);

  // This copy (run from the source code) can't update itself: it says so,
  // and offers no button.
  ({ app, fl } = await launch({}));
  r = await row(fl);
  check(
    "a copy that can't update itself says why, with no button",
    /source code/.test(r?.status ?? '') && r?.button === null,
    JSON.stringify(r),
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
