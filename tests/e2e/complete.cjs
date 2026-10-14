// The command bar completes an address from this computer (history and
// open tabs; nothing is sent anywhere): typed "127" fills in the test
// site's address, the added part selected; typing on replaces it, Enter
// goes there, Backspace takes it away, and text with a space is a search.
const { _electron } = require('./playwright.cjs');
const { execFileSync, execSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${n}${x !== '' ? '  (' + x + ')' : ''}`,
  );
};

// The rule itself (plain logic).
const rule = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--input-type=module',
      '-e',
      `import { completeAddress as c } from ${JSON.stringify(path.join(ROOT, 'src/ui/complete.ts'))};
       const urls = ['https://www.github.com/dwurgy/firn?tab=1#top', 'https://news.ycombinator.com/'];
       console.log(JSON.stringify({
         site: c('git', urls), keepsCase: c('GiT', urls), deep: c('github.com/dw', urls),
         space: c('git hub', urls), none: c('zzz', urls), whole: c('github.com', urls),
         empty: c('', urls), typedInFull: c('github.com/dwurgy/firn', urls),
       }));`,
    ],
    { encoding: 'utf8' },
  ),
);
check(
  '"git" completes to the site, github.com',
  rule.site === 'github.com',
  rule.site,
);
check(
  '...keeping what was typed as typed',
  rule.keepsCase === 'GiThub.com',
  rule.keepsCase,
);
check(
  'past the site, the full address',
  rule.deep === 'github.com/dwurgy/firn',
  rule.deep,
);
check(
  'a space (a search), no match, all typed already, or nothing typed: no completion',
  [rule.space, rule.none, rule.whole, rule.empty].every((v) => v === null),
  JSON.stringify(rule),
);
check(
  'never adds a "?…" or "#…" part: an address typed in full stays as it is',
  rule.typedInFull === null && !rule.deep.includes('?'),
  JSON.stringify(rule),
);

(async () => {
  execSync('rm -f /root/.config/Firn/session.json');
  const app = await _electron.launch({
    args: ['--no-sandbox', '.'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  });
  await wait(6000);
  const ui = app.windows().find((w) => w.url().endsWith(':5173/'));
  const fl = app.windows().find((w) => w.url().includes('view=floating'));
  // Visit the test site once, so it's in history.
  await ui.evaluate(() => window.firn.openUrl('127.0.0.1:8765/red.html'));
  await wait(1500);

  const box = () =>
    fl.evaluate(() => {
      const input = document.querySelector('[data-testid="command-input"]');
      return {
        value: input.value,
        selected: input.value.slice(input.selectionStart, input.selectionEnd),
        first: document.querySelector('[data-testid="command-result"]')
          ?.textContent,
      };
    });
  await ui.click('.new-tab');
  await wait(400);
  await fl.keyboard.type('127', { delay: 60 });
  await wait(600);
  let b = await box();
  check(
    'typed "127": the box fills in the visited site, the added part selected',
    b.value === '127.0.0.1:8765' && b.selected === '.0.0.1:8765',
    JSON.stringify(b),
  );
  check(
    '...and the first result goes there',
    (b.first ?? '').startsWith('127.0.0.1:8765'),
    b.first,
  );
  await fl.keyboard.type('.0', { delay: 60 });
  await wait(400);
  b = await box();
  check(
    'typing on replaces the selected part, and it completes again',
    b.value === '127.0.0.1:8765' && b.selected === '.0.1:8765',
    JSON.stringify(b),
  );
  await fl.keyboard.press('Backspace');
  await wait(400);
  b = await box();
  check(
    "Backspace takes the completion away (it doesn't come straight back)",
    b.value === '127.0' && b.selected === '',
    JSON.stringify(b),
  );
  await fl.keyboard.type('.', { delay: 60 });
  await wait(400);
  await fl.keyboard.press('Enter');
  await wait(1500);
  const url = await ui.evaluate(
    () =>
      document.querySelector('[data-testid="address-input"], .address-input')
        ?.value ?? '',
  );
  const opened = await app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((w) => w.getURL()),
  );
  check(
    'Enter goes to the completed address',
    opened.some((u) => u === 'http://127.0.0.1:8765/'),
    `${url} / ${opened.filter((u) => u.includes('8765')).join(', ')}`,
  );

  await ui.click('.new-tab');
  await wait(400);
  await fl.keyboard.type('127 notes', { delay: 30 });
  await wait(500);
  b = await box();
  check(
    'text with a space is a search: not completed',
    b.value === '127 notes',
    JSON.stringify(b),
  );
  await fl.keyboard.press('Escape');

  console.log(
    `\n${results.filter(Boolean).length}/${results.length} checks passed`,
  );
  await app.close();
})().catch((e) => {
  console.log('FAIL  TEST ERROR', e.message);
  process.exit(1);
});
