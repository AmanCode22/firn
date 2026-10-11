// Archiving old tabs: everyday tabs not looked at for the chosen number of
// days of use (counted from the days Firn was used, not calendar days)
// tidy themselves away into the Archive; pinned and Basecamp tabs, the tab
// on screen, and each space's most recent tab stay. The Archive (Firn menu,
// command bar, Settings) brings one back, in its space, and survives a
// restart.
const ROOT = require('path').resolve(__dirname, '../..');
const fs = require('fs');
const { execSync } = require('child_process');
const SP = process.env.SP;
const DATA = '/root/.config/Firn';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};

const DAY = 86_400_000;
const now = Date.now();
const dayOf = (t) => {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const page = (name) => `http://127.0.0.1:8765/${name}.html`;
const tab = (id, spaceId, name, order, lastActiveAt, extra = {}) => ({
  id,
  spaceId,
  url: page(name),
  title: `${name[0].toUpperCase()}${name.slice(1)} site`,
  favicon: '',
  pinned: false,
  order,
  lastActiveAt,
  ...extra,
});

// Firn was used on each of the last 40 days; four tabs were last looked at
// 30 days ago (and one 40). The Archive already holds a tab put away 35
// days ago (forgotten after 30 days of use) and one from 3 days ago.
const session = {
  version: 2,
  spaces: [
    { id: 'sp-a', name: 'Personal', icon: 'home', color: '#7f9cb0', order: 0 },
    { id: 'sp-b', name: 'Work', icon: 'work', color: '#8fae8b', order: 1 },
  ],
  tabs: [
    tab('gray', 'sp-a', 'gray', 0, now - 30 * DAY, { basecamp: true }),
    tab('green', 'sp-a', 'green', 1, now - 30 * DAY, { pinned: true }),
    tab('red', 'sp-a', 'red', 2, now),
    tab('blue', 'sp-a', 'blue', 3, now - 30 * DAY),
    tab('mix', 'sp-b', 'mix', 4, now - 30 * DAY),
    tab('long', 'sp-b', 'long', 5, now - 40 * DAY),
  ],
  splits: [],
  window: {
    id: '1',
    activeSpaceId: 'sp-a',
    activeTabId: 'red',
    sidebarWidth: 260,
    sidebarCollapsed: false,
  },
  recentlyClosed: [],
  daysUsed: Array.from({ length: 40 }, (_, i) => dayOf(now - (i + 1) * DAY)),
  archive: [
    ['ancient', 35],
    ['recent', 3],
  ].map(([id, days]) => ({
    id,
    url: page(id === 'ancient' ? 'two' : 'glance'),
    title: id === 'ancient' ? 'Ancient site' : 'Recent site',
    favicon: '',
    spaceId: 'sp-a',
    archivedAt: now - days * DAY,
  })),
};

// Started plainly and checked over CDP: Playwright's launcher waits forever
// on restored tabs that haven't loaded yet.
const launch = async (tidies) => {
  const { spawn } = require('child_process');
  const p = spawn(
    require('path').join(ROOT, 'node_modules/electron/dist/electron'),
    ['--no-sandbox', '--remote-debugging-port=9222', '.'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  const started = Date.now();
  const { evalIn } = await require('./cdp.cjs').cdp();
  const ui = (expr) => evalIn((u) => u.endsWith(':5173/'), expr);
  const fl = (expr) => evalIn((u) => u.includes('view=floating'), expr);
  // Until the sidebar is there (the first start compiles it), then past the
  // first tidy, 8 seconds after Firn opens.
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    const ready = await ui(
      `!!document.querySelector('[data-testid="archive-box"]')`,
    ).catch(() => false);
    if (ready === true) break;
  }
  // Then until the first tidy (8 seconds after Firn opens) when it has
  // something to put away (the box pulses), or past it.
  for (let i = 0; tidies && i < 30; i++) {
    const pulsed = await ui(
      `!!document.querySelector('.archive-icon.is-pulsing')`,
    ).catch(() => false);
    if (pulsed === true) break;
    await wait(1000);
  }
  await wait(Math.max(2000, 12000 - (Date.now() - started)));
  return { p, ui, fl };
};

(async () => {
  fs.writeFileSync(`${DATA}/session.json`, JSON.stringify(session));
  const settings = JSON.parse(fs.readFileSync(`${DATA}/settings.json`, 'utf8'));
  fs.writeFileSync(
    `${DATA}/settings.json`,
    // (No choice made: the default, 7 days.)
    JSON.stringify({ ...settings, archiveAfter: undefined }),
  );

  let { p, ui, fl } = await launch(true);
  const rows = () =>
    ui(`[...document.querySelectorAll('.space-tabs .tab, .basecamp-tile')].map(
      (t) => t.getAttribute('data-tip') || t.getAttribute('aria-label') || t.textContent.trim())`);
  const after = (await rows()) ?? [];
  check(
    'an everyday tab unused for 7 days of use is tidied away',
    after.length > 0 && !after.some((r) => /blue/i.test(r)),
    after.join(', '),
  );
  check(
    '...the tab on screen, the pinned tab, and Basecamp stay',
    ['red', 'green', 'gray'].every((n) =>
      after.some((r) => new RegExp(n, 'i').test(r)),
    ),
    after.join(', '),
  );

  // The archive box, at the right of the spaces (which stay centered),
  // gave its little pulse.
  const box = await ui(`(() => {
    const box = document.querySelector('[data-testid="archive-box"]').getBoundingClientRect();
    const spaces = document.querySelector('.space-switcher').getBoundingClientRect();
    const side = document.querySelector('.sidebar-bottom').getBoundingClientRect();
    return {
      right: box.left >= spaces.right - 1,
      centered: Math.abs((spaces.left + spaces.right) / 2 - (side.left + side.right) / 2) < 2,
      pulsed: !!document.querySelector('.archive-icon.is-pulsing') &&
        !!document.querySelector('.archive-ring'),
    };
  })()`);
  check(
    'the archive box sits at the bottom right, the spaces centered',
    box?.right && box?.centered,
    JSON.stringify(box),
  );
  check('...and it pulsed when tabs were tidied away', box?.pulsed);

  await ui(`document.querySelector('[data-testid="archive-box"]').click()`);
  await wait(800);
  const listed = async () =>
    (await fl(
      `[...document.querySelectorAll('[data-testid="archived-tab"]')].map((r) => r.textContent)`,
    )) ?? [];
  let archived = await listed();
  check(
    'clicking the box opens the Archive: it lists it, and another space’s older tab',
    archived.length === 3 &&
      archived.some((r) => /blue/i.test(r)) &&
      archived.some((r) => /long/i.test(r)),
    archived.join(' | '),
  );
  check(
    '...an archived tab from 3 days ago stays, one from 35 days of use ago is forgotten',
    archived.some((r) => /recent/i.test(r)) &&
      !archived.some((r) => /ancient/i.test(r)),
  );
  check(
    '...but not a space’s most recent tab, though just as old',
    !archived.some((r) => /mix/i.test(r)),
  );
  const groups =
    (await fl(
      `[...document.querySelectorAll('.history-day h3')].map((h) => h.textContent)`,
    )) ?? [];
  check(
    '...grouped by space',
    groups.join(',') === 'Personal,Work',
    groups.join(','),
  );
  execSync(`import -window root -crop 1280x820+0+0 ${SP}/archive-panel.png`);

  await fl(
    `[...document.querySelectorAll('[data-testid="archived-tab"]')].find((r) => /blue/i.test(r.textContent))?.click()`,
  );
  await wait(1500);
  const active = await ui(
    `document.querySelector('.space-tabs .tab.is-active')?.textContent ?? null`,
  );
  const overlay = await fl(`!!document.querySelector('.history-sheet')`);
  check(
    'clicking it brings it back, on screen, and the panel closes',
    /blue/i.test(active ?? '') && !overlay,
    `${active}, panel ${overlay}`,
  );

  await ui(`window.firn.runAction('settings')`);
  await wait(800);
  const setting = await fl(`(() => {
    const row = [...document.querySelectorAll('.settings-row')].find((r) =>
      /Archive tabs you haven't used for/.test(r.textContent));
    return row?.querySelector('.dropdown-button')?.textContent ?? null;
  })()`);
  check(
    'Settings: "Archive tabs you haven’t used for" (7 days by default)',
    setting === '7 days',
    setting,
  );

  // After a restart, the Archive is still there, and today counts as a day
  // of use.
  await wait(2000);
  p.kill();
  await wait(2500);
  const saved = JSON.parse(fs.readFileSync(`${DATA}/session.json`, 'utf8'));
  check(
    'it’s saved: the Archive, and today as a day Firn was used',
    saved.archive?.length === 2 &&
      saved.archive.some((a) => /long/.test(a.url)) &&
      !saved.archive.some((a) => /blue/.test(a.url)) &&
      saved.daysUsed?.includes(dayOf(Date.now())),
    JSON.stringify({
      archive: saved.archive?.map((a) => a.url),
      last: saved.daysUsed?.slice(-1),
    }),
  );
  ({ p, ui, fl } = await launch());
  await ui(`window.firn.runAction('archive')`);
  await wait(800);
  archived = await listed();
  check(
    '...and back after a restart',
    archived.length === 2,
    archived.join(' | '),
  );
  p.kill();

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
