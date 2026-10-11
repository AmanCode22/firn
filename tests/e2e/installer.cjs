// Windows' installer events (src/installer.ts): a Start menu entry only, on
// the first install; updates leave shortcuts alone; uninstalling removes
// them (the desktop ones older versions made too). Firn's place among the
// browsers is added on install and update, and removed on uninstall. Plain
// logic, checked without Windows.
const { execFileSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};

const steps = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--input-type=module',
      '-e',
      `import { installerSteps } from ${JSON.stringify(path.join(ROOT, 'src/installer.ts'))};
       const events = ['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete', '--squirrel-firstrun', 'https://example.com', undefined];
       console.log(JSON.stringify(Object.fromEntries(events.map((e) => [String(e), installerSteps(e, 'Firn.exe')]))));`,
    ],
    { encoding: 'utf8' },
  ),
);
const show = (e) => JSON.stringify(steps[e]);

check(
  'install: a Start menu entry only (no desktop shortcut), and Firn listed among the browsers',
  steps['--squirrel-install']?.browser === 'register' &&
    steps['--squirrel-install']?.updateTool?.join(' ') ===
      '--createShortcut=Firn.exe --shortcut-locations=StartMenu',
  show('--squirrel-install'),
);
check(
  'update: shortcuts left alone (a deleted or moved one stays that way)',
  steps['--squirrel-updated']?.browser === 'register' &&
    !steps['--squirrel-updated'].updateTool,
  show('--squirrel-updated'),
);
check(
  'uninstall: the Start menu entry and any desktop shortcut removed, and Firn off the list',
  steps['--squirrel-uninstall']?.browser === 'unregister' &&
    steps['--squirrel-uninstall']?.updateTool?.join(' ') ===
      '--removeShortcut=Firn.exe --shortcut-locations=Desktop,StartMenu',
  show('--squirrel-uninstall'),
);
check(
  'an old version being replaced just quits',
  JSON.stringify(steps['--squirrel-obsolete']) === '{}',
  show('--squirrel-obsolete'),
);
check(
  'anything else (the first start after installing, a link) starts Firn normally',
  steps['--squirrel-firstrun'] === null &&
    steps['https://example.com'] === null &&
    steps['undefined'] === null,
);

console.log(
  `\n${results.filter(Boolean).length}/${results.length} checks passed`,
);
