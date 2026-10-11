// Hover labels on a Mac (pretended here): the system's own tooltips, so
// every button keeps its title, and Firn draws no label of its own; a tab
// whose name is fully shown loses its title while hovered (no repeating
// it), one cut off keeps it. The top bar's buttons keep theirs too.
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
    env: { ...process.env, FIRN_NATIVE_TIPS_TEST: '1' },
    executablePath: require('path').join(
      ROOT,
      'node_modules/electron/dist/electron',
    ),
  });
  await wait(6000);
  const ui = app
    .windows()
    .find((w) => w.url().includes(':5173/') && !w.url().includes('view='));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  const top = app.windows().find((w) => w.url().includes('view=topbar'));
  for (const page of ['red.html', 'longtitle.html']) {
    await ui.click('.new-tab');
    await wait(300);
    await fl.keyboard.type(`127.0.0.1:8765/${page}`);
    await fl.keyboard.press('Enter');
    await wait(1200);
  }

  const button = await ui.evaluate(() => {
    const b = document.querySelector('.space-add');
    return b && `${b.title}|${b.dataset.tip}|${b.getAttribute('aria-label')}`;
  });
  check(
    "a button keeps its title for the Mac's own tooltip (and its name for screen readers)",
    button === 'New space|New space|New space',
    button,
  );
  const ownLabel = await Promise.all(
    [ui, fl].map((w) =>
      w.evaluate(() => !!document.querySelector('.firn-tip')),
    ),
  );
  check(
    '...and Firn draws no label of its own',
    ownLabel.every((has) => !has),
    ownLabel.join(','),
  );
  const barTitle = await top.evaluate(
    () => document.querySelector('[data-tip="Minimize"]')?.title,
  );
  check(
    "the top bar's buttons keep theirs too (the system's tooltip isn't held in the bar)",
    barTitle === 'Minimize',
    String(barTitle),
  );

  const red = '.space-tabs .tab:has-text("Red site")';
  const long = '.space-tabs .tab:has-text("A very long page title")';
  await ui.hover(red);
  await wait(300);
  const redHovered = await ui.evaluate(
    () =>
      [...document.querySelectorAll('.space-tabs .tab')]
        .find((t) => /Red site/.test(t.textContent))
        ?.getAttribute('title') ?? null,
  );
  check(
    'hovering a tab whose name is fully shown: no tooltip repeating it',
    redHovered === null,
    String(redHovered),
  );
  await ui.hover(long);
  await wait(300);
  const longHovered = await ui.evaluate(
    () =>
      [...document.querySelectorAll('.space-tabs .tab')]
        .find((t) => /very long page title/.test(t.textContent))
        ?.getAttribute('title') ?? null,
  );
  const redAfter = await ui.evaluate(
    () =>
      [...document.querySelectorAll('.space-tabs .tab')]
        .find((t) => /Red site/.test(t.textContent))
        ?.getAttribute('title') ?? null,
  );
  check(
    '...one cut off keeps it (the whole name)',
    !!longHovered && longHovered.length > 30,
    String(longHovered),
  );
  check(
    '...and the first gets its title back once the mouse moves on',
    redAfter !== null,
    String(redAfter),
  );

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
