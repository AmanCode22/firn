// Automatic updates: only an installed copy (Windows: by Firn Setup.exe;
// Mac: in the Applications folder) asks for updates.
// This copy (Linux, run from the source code) must stay quiet and still
// open normally. Firn is started directly (not through Playwright) so its
// log can be read from the very first line.
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
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
  execSync('rm -f /root/.config/Firn/session.json');
  fs.writeFileSync(
    '/root/.config/Firn/settings.json',
    JSON.stringify({
      onboarded: true,
      // A current install (not just updated, so no What's new).
      lastVersion: require('../../package.json').version,
    }),
  );
  const firn = spawn(
    path.join(ROOT, 'node_modules/electron/dist/electron'),
    ['--no-sandbox', '.'],
    { cwd: ROOT, env: { ...process.env, FIRN_DEBUG: '1' } },
  );
  let out = '';
  firn.stdout.on('data', (d) => (out += d));
  await wait(12000);
  check(
    'a copy run from the source code does not ask for updates',
    out.includes('updates: off (Run from its source code') &&
      !out.includes('updates: asking'),
  );
  check('Firn still opens normally', out.includes('started'));
  firn.kill();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.log('FAIL  crashed: ' + e.message);
  process.exit(1);
});
