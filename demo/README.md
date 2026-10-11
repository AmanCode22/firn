# Firn's demo recorder

Records Firn's marketing clips and stills the same way every time, with no
setup in Firn: one command opens Firn with a throwaway demo profile, drives
it slowly with a soft on-screen cursor, and saves each clip as its own video
plus a few still pictures.

```
npm run demo                          # every clip
npm run demo -- --clip lookout        # just one
npm run demo -- --clip spaces --clip basecamp   # a few
npm run demo -- --list                # the clips' names
npm run demo -- --glass               # keep the see-through glass (see below)
npm run demo -- --no-stills           # clips only, no still pictures
```

What you get:

- `demo/out/clips/<clip>.mp4`: 2880×1800 on a Retina screen, 60 frames a
  second, H.264 (CRF 14, yuv420p), no sound.
- `demo/out/stills/<clip>-<n>.png`: full-resolution pictures of Firn's
  window at the clearest moments (no cursor, no window shadow).

`demo/out/` isn't saved in Git. Each run replaces the clips (and stills) it
records.

## One-time setup (Mac)

1. **Node.js 22 or newer** and this project's packages (`npm install`, which
   you already did for Firn).
2. **ffmpeg**, with Homebrew (<https://brew.sh>):

   ```
   brew install ffmpeg
   ```

3. **Screen Recording permission** for the app you run the command in
   (Terminal, iTerm, or VS Code): System Settings > Privacy & Security >
   Screen & System Audio Recording, turn it on, and reopen that app. The
   first run may ask on its own; say yes, then run it again.
4. **Direct screen access** (newer macOS): at the start of a run, macOS may
   show a dialog saying your Terminal "is requesting to bypass the system
   private window picker and directly access your screen". Click
   **Allow**. The demo waits for you (press Return) so the dialog doesn't
   end up in the middle of every clip. macOS asks again now and then.

That's all. No Accessibility permission is needed: the demo never moves your
real pointer or presses real keys.

## Before each run

- **Quit Firn** if it's open (the demo tells you if it is).
- **Turn on Do Not Disturb** (Control Center > Focus), so no notification
  slides into a clip.
- **For the sharpest clips (2880×1800)**, the main screen should be exactly
  twice as sharp as its setting: a MacBook's own screen, or a 4K display
  set to **1920 × 1080** (System Settings > Displays, the setting labeled
  1920 × 1080 or "Larger Text"). At other settings the clips come out at
  whatever the screen gives (e.g. 2160×1350 for a 4K display at "looks like
  2560 × 1440", or 1440×900 on a non-Retina screen); the demo says which
  when it starts. Switch back afterwards if you like.
- **Keep your mouse off Firn's window** while it records. Your real pointer
  is left out of the recording, but Firn would still light up whatever it
  rests on. The demo waits, and says so, if it's over the window.
- Leave the Mac alone while it runs (about 5 minutes for every clip). Other
  windows mustn't cover Firn's window.

## If it stops

Each step prints a line (opening Firn, checking the screen, recording), so
the last line shows where it stopped.

- **A macOS prompt**, which may be hidden behind other windows (Cmd+Tab to
  find it): Screen Recording for Terminal, which needs Terminal reopened
  (Cmd+Q) once it's allowed. The demo doesn't use your Keychain (it uses
  Chromium's stand-in, `--use-mock-keychain`), so it shouldn't ask for your
  password.
- **A leftover Firn window** from a run that was stopped: `pkill -f
  "$HOME/firn/node_modules/electron"` (with your folder's path), then run
  it again.
- **"Firn didn't finish opening"**: `demo/out/firn-log.txt` has what Firn
  printed.

## Choosing the pages

```
npm run demo:try-pages                       # the candidates in try-pages.mjs
npm run demo:try-pages -- https://example.com/ https://…   # just these
```

Opens each candidate page in Firn's demo mode, takes a picture of it, and
notes any pop-up it finds, then opens a contact sheet
(`demo/out/try-pages/index.html`). Pick the prettiest, and they go into the
spaces in `lib/seed.mjs`.

## The clips

| Clip            | What it shows                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `tabs-overview` | Personal: the pointer runs down the tabs, opens a new tab, types "nts", picks NTS Radio (in Weekend) |
| `spaces`        | Personal → Work → Weekend with the space buttons, pausing on each                                      |
| `basecamp`      | Clicking between the three Basecamp tiles, then right-click a tab > Add to Basecamp                    |
| `split-view`    | In Weekend, drag crl-2026 onto the page's right half beside agnestoth.com: the two side by side; then ease the divider          |
| `lookout`       | On firnbrowser.com: Shift+click a link (Lookout), scroll it a little, close it                        |
| `welcome`       | The First light welcome on a fresh profile, from hello to "Welcome in."                                |
| `empty-page`    | Each space with nothing open: the snow and the mark in each space's color                               |
| `hero`          | A still only: Personal, firnbrowser.com open, the sidebar beside it                                   |

Right-click menus are drawn by macOS, not Firn: when a clip uses one, the
cursor glides to the item, and the demo chooses it.

**No pop-ups in a clip.** In demo mode Firn hides Wikipedia's donation
banners, the usual cookie and consent boxes, and MDN's banners (`src/demo.ts`).
Before and after each clip the recorder looks for anything big still stuck
over a page and says so ("heads-up: … maybe a pop-up"); then swap that page
in `lib/seed.mjs`, or add the pop-up to the list in `src/demo.ts`. The demo
pages are chosen to have none: no search result pages, nothing that
advertises another browser, no Wikipedia Main Page (it shows the day's news
and photos of real people).

## How it works

- **Demo mode** (`src/demo.ts`), only when Firn is started with
  `FIRN_DEMO=1`: Firn keeps its data in `demo/.profile` (wiped before every
  clip; your real Firn profile is never touched), opens at 1440×900 inside,
  centered on the main screen, is always light, never checks for updates,
  never contacts Google Safe Browsing, and refuses any site's permission
  question. Ad blocking stays on. A normal `npm start` doesn't do any of
  this.
- **The demo profile** is written in Firn's own formats (`session.json` and
  `settings.json`, see `lib/seed.mjs`): Personal (Glacier), Work (Sage), and
  Weekend (Sand), each with three or four tabs, and Basecamp with Firn's release
  notes, mijobello.com, and Things (David's picks from `npm run demo:try-pages`).
- **Each clip opens on its own page** (`start` in the clip: a space and a
  tab), set up off camera, so the clips don't all begin on the same picture.
- **Warm-up**: before the clips, Firn visits every demo page once, off
  camera, so every tab has its title and icon and the pages are cached.
  Each clip then starts from a copy of that warmed profile (the welcome and
  the empty page start from scratch).
- **Recording**: Firn's web pages are separate views laid over its window,
  each with its own renderer, so a browser-automation video (Playwright's
  `recordVideo`) would show the sidebar with a blank hole where the page is.
  So the demo records the screen where Firn's window is, with ffmpeg's macOS
  screen capture (AVFoundation), cropped to the window, without the system
  pointer. It's saved quickly with the Mac's hardware encoder first, then
  trimmed to the clip and encoded at high quality. Stills are macOS's
  `screencapture` of Firn's window alone.
- **The cursor** is a small transparent, click-through window over Firn's,
  that only exists while the demo runs (`lib/cursor.mjs`). It glides to each
  target (ease-in-out, about 600ms) and shows a small press on each click.
- **Driving Firn** (`lib/director.mjs`, `lib/electron.mjs`): the demo starts
  Electron itself and works through Firn's main process. It finds things by
  their `data-testid` and clicks, types, and scrolls with Electron's own
  input events. (Not Playwright: when it starts an Electron app it waits
  for every page to set up, and Firn's not-yet-opened tabs never do, so it
  could hang.)
- **Pacing**: 1.2s still before the first action and after the last, about
  700ms between steps, typing at a natural, slightly uneven speed (the same
  on every run), short smooth scrolls, and pages loaded and fonts in before
  recording starts.
- **Glass**: the demo turns Firn's see-through glass off by default
  (`FIRN_NO_GLASS`), since it shows whatever is behind the window (your
  desktop picture), which would make clips differ. `--glass` keeps it.

Firn runs from the source code (as with `npm start`): a packaged Firn has
Electron's debugging switch turned off, so the demo couldn't drive it.

## Same result every run

Each clip starts from the same profile, with the same window size and place,
light look, cursor path, and typing rhythm. Two things can still differ:
the websites themselves (they change over time), and a clip's
length by a fraction of a second when a page takes longer to load.

## Adding a clip

1. Make `demo/clips/<name>.mjs`, like the others:

   ```js
   import { ui, floating, web } from '../lib/director.mjs';

   export default {
     name: 'my-clip',
     seed: 'tabs', // 'tabs' (the demo spaces), 'spaces' (no tabs), or 'welcome'
     async setup(d) {
       // Off camera: get things ready, and put the cursor where it starts.
       await d.placeCursor(700, 500);
     },
     async run(d) {
       // Recorded (with the 1.2s stills around it).
       await d.click(ui('[data-testid="new-tab"]'));
       await d.step(); // about 700ms
       await d.type(floating('[data-testid="command-input"]'), 'calm');
       await d.press(floating('[data-testid="command-input"]'), 'Enter');
       await d.settle(); // pages loaded, fonts in
       await d.still(); // demo/out/stills/my-clip-1.png
     },
   };
   ```

2. List it in `demo/clips/index.mjs`.
3. `npm run demo -- --clip my-clip`.

Targets name a layer of Firn's window and a CSS selector there: `ui(…)` for
the sidebar, `floating(…)` for the floating panels (command bar, Lookout's
buttons, the welcome), and `web(…, { url: 'part of its address' })` for the
web page on screen. Options: `nth` (which match), `text` (the one containing
this text), and `at` (where in it, e.g. `[0.4, 0.5]`). Prefer `data-testid`
attributes; add one to Firn's interface where a clip needs it.

The director's actions: `click(target, { button: 'right', shift: true })`,
`hover`, `type`, `press` (a key such as `'Enter'`), `scroll(target, pixels)`,
`drag(target, dx, dy)`, `chooseMenuItem('Label')` (in the right-click menu
just opened), `waitFor`, `settle`, `step`, `pause(ms)`, and `still`.

## Trying it on Linux

For working on the recorder without a Mac: it also runs under an X display
(e.g. `Xvfb :98 -screen 0 1920x1080x24` with `DISPLAY=:98`), recording with
ffmpeg's X11 capture. The cursor's see-through window needs a compositor
there (e.g. `xcompmgr`). The clips are meant to be made on a Mac.
