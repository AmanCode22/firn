// Demo mode (src/demo.ts, for the demo recorder in demo/): only with
// FIRN_DEMO=1, Firn keeps its data in the throwaway folder it's given,
// opens at 1440×900 inside, and is always light. A normal start has none
// of it.
const { _electron } = require('./playwright.cjs');
const ROOT = require('path').resolve(__dirname, '../..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};
const launch = (env) =>
  _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    env: { ...process.env, ...env },
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
const look = (app) =>
  app.evaluate(({ app, BrowserWindow, nativeTheme, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith(':5173/'),
    );
    const [width, height] = win.getContentSize();
    return {
      area: screen.getPrimaryDisplay().workArea,
      userData: app.getPath('userData'),
      width,
      height,
      theme: nativeTheme.themeSource,
      hooks: typeof globalThis.__firnDemo === 'object',
    };
  });

(async () => {
  // A throwaway profile set to dark, to see demo mode keep Firn light.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'firn-demo-'));
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      onboarded: true,
      theme: 'dark',
      lastVersion: require('../../package.json').version,
    }),
  );
  let app = await launch({ FIRN_DEMO: '1', FIRN_DEMO_PROFILE: profile });
  await wait(6000);
  let state = await look(app);
  check(
    'demo mode keeps its data in the folder it was given',
    path.resolve(state.userData) === path.resolve(profile),
    state.userData,
  );
  // (The checks' own screen is 1400×900, so there it's as big as fits.)
  const fits = state.area.width >= 1440 && state.area.height >= 900;
  check(
    '...opens at 1440×900 inside (or as much as the screen has)',
    fits
      ? state.width === 1440 && state.height === 900
      : state.width >= Math.min(1440, state.area.width) - 2 &&
          state.height >= Math.min(900, state.area.height) - 2,
    `${state.width}×${state.height} on ${state.area.width}×${state.area.height}`,
  );
  check(
    '...is light, even when set to dark',
    state.theme === 'light',
    state.theme,
  );
  check('...and lets the recorder pick from a right-click menu', state.hooks);
  await app.close();
  await wait(1000);
  check(
    '...and saves its session there',
    fs.existsSync(path.join(profile, 'session.json')),
  );
  fs.rmSync(profile, { recursive: true, force: true });

  app = await launch({});
  await wait(6000);
  state = await look(app);
  check(
    'a normal start uses Firn’s usual data folder',
    state.userData === '/root/.config/Firn',
    state.userData,
  );
  check(
    '...at its usual size, without the demo hooks',
    !(state.width === 1440 && state.height === 900) && !state.hooks,
    `${state.width}×${state.height}`,
  );
  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('TEST ERROR', e.message);
  process.exit(1);
});
