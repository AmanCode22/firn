# Firn

A calm, minimal browser that's easy for everyone: vertical tabs, spaces, split view, and link previews, without the learning curve. No telemetry; your data stays on your device. Built on Chromium.

[firnbrowser.com](https://firnbrowser.com)

## Download

- **Windows:** [Firn Setup.exe](https://github.com/dwurgy/firn/releases/latest/download/Firn.Setup.exe). Open it and Firn installs in a few seconds, just for you (no administrator rights needed), and adds itself to the Start menu. Firn is signed with its maker's name. While it's new, Windows may still say "Windows protected your PC" the first time: click **More info**, then **Run anyway**.
- **Mac:** [Firn for Mac](https://github.com/dwurgy/firn/releases/latest/download/Firn.for.Mac.zip), one app for Apple chips and Intel. Unzip it, drag **Firn** into **Applications**, and open it. It's signed and checked by Apple, so macOS only asks once whether to open an app from the internet.
- **Every version** and its notes: the [Releases page](https://github.com/dwurgy/firn/releases).
- **Linux:** no download yet; Firn can be built from its source code (see "For developers" below).

Firn keeps itself up to date: it checks for a new version a minute after it opens and every few hours, downloads it quietly, and is the new version the next time you open it, with a short **What's new** note. **Settings > Updates** shows where things stand, with a **Check for updates** button. Uninstalling keeps your tabs, history, and passwords, so reinstalling brings everything back.

## What Firn does

### Tabs in the sidebar

Tabs live in a sidebar on the left, top to bottom. **Ctrl+S** (Cmd+S on a Mac) hides it to give the page the whole window; move the mouse to the left edge and it peeks back out.

- **Basecamp** is the grid of your everyday sites at the top, the same in every space (up to 12). Right-click a tab and choose **Add to Basecamp**.
- **Pinned tabs** belong to one space and sit under its name. Pin a tab with **Ctrl+D**, by right-clicking it, or by dragging it above the line.
- Basecamp and pinned tabs remember their *home* address. Closing one doesn't remove it: it rests, a little quieter, until you click it again. Right-click for **Go back to home**.
- **Tabs tidy themselves away.** Everyday tabs you haven't looked at for a while (7 days of using Firn, by default; Settings > Tabs) move into the **Archive**, the little box at the bottom right of the sidebar. Click it to bring any of them back. Closing a tab yourself still closes it.
- **Tabs you're not using rest.** A tab you haven't looked at for an hour goes to sleep and gives back its memory. It keeps its place and loads again, on the same page, when you click it. Basecamp sites, tabs playing sound, and pages where you've started typing stay awake.

### Spaces

Spaces keep separate sets of tabs, like Work and Personal. Each has its own name, color, and icon; the color softly tints the window. Switch with the icons at the bottom of the sidebar or **Ctrl+Shift+1…9**, and right-click a space's icon to rename it or change its color or icon. Right-click a tab to move it to another space.

### The command bar

**Ctrl+T** opens the command bar: type an address or a search. It also finds your open tabs in every space and pages from your history, and runs actions by name (**pin**, **basecamp**, **reopen**, **new space**, a space's name, and more).

### Split view and Lookout

- **Split view:** drag a tab from the sidebar onto the page, and the two open side by side, each with its own address and back/forward. Drag the gap to resize. Rest the mouse near the top middle of a side for a small handle to swap the sides or take one out.
- **Lookout:** **Shift+click** a link to preview it in a panel floating over the page. **Esc** closes it; a button opens it as a tab. Links from a Basecamp or pinned tab to another site open in Lookout by themselves, so your pinned tab stays put.

### Sound

A small speaker shows on any tab playing sound; click it to mute the tab. When something plays in a tab you're not looking at, a mini player at the bottom of the sidebar shows what it is, with a button to pause it and a click to go to it.

### Downloads

Files save to your Downloads folder and show at the bottom of the sidebar, with a ring that fills as they arrive. Click a finished one to open it, or hover to show it in its folder. PDFs open right in the tab.

### Privacy

- **No telemetry.** Firn doesn't track you or report how you use it. Your tabs, history, passwords, and settings stay on your computer.
- **Ads and trackers are blocked** by default, with Ghostery's open-source blocker and the public EasyList, EasyPrivacy, and uBlock Origin lists. If a site breaks, right-click the page and choose **Allow ads on this site**.
- **Scam and malware warnings** use Google Safe Browsing, checked on your computer: Firn downloads Google's lists, which hold only the first few bytes of a code made from each dangerous address. Only when one matches, which is rare, does Firn ask Google about those few bytes, never the address.
- **Saved passwords** are encrypted with your computer's own protection, or not saved at all if it has none. They fill in only when you click into a sign-in form, only on the very same site, and only over a secure connection.
- **Site permissions:** a site must ask before using your camera, microphone, location, notifications, or clipboard, and Firn remembers your answer. The button at the left of the address bar changes it.
- **What Firn sends, and to whom:** the update check (to update.electronjs.org: only Firn's version and the kind of computer), the daily block lists (downloaded from Ghostery's public GitHub), and Safe Browsing's lists (from Google, as above). Nothing about you or what you browse.

### Shortcuts

**Settings > Keyboard** lists every shortcut. A few to start with: **Ctrl+T** for the command bar, **Ctrl+S** to hide the sidebar, **Ctrl+D** to pin, **Shift+click** for Lookout, and **Ctrl+Shift+1…9** for spaces. On a Mac, use Cmd instead of Ctrl.

## For developers

### Running Firn from its source code

You need [Node.js](https://nodejs.org) (the LTS version) and Git installed once.

```
git clone https://github.com/dwurgy/firn.git
cd firn
npm install      # first time only, and whenever package.json changes
npm start        # opens Firn
```

**Windows: if PowerShell says "running scripts is disabled on this system"**, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and answer `Y` (or use `npm.cmd install` / `npm.cmd start`).

`npm start` runs Firn in development mode: a change in `src/ui/` updates the window by itself; for `src/main.ts` or `src/preload.ts`, type `rs` in the terminal and press Enter. Development mode is slower than the real thing. For a fast copy, run `npm run package` and open `out\Firn-win32-x64\Firn.exe` (on macOS, `out/Firn-darwin-*/Firn.app`); it keeps the same tabs and history, but only one Firn can run at a time.

`npm run make` builds the installer (`out\make\squirrel.windows\x64\Firn Setup.exe` on Windows).

Before committing: `npm run lint`, `npm run typecheck`, and the end-to-end checks, `bash tests/e2e/run.sh` (see `tests/e2e/README.md`).

### Builds and releases on GitHub

GitHub builds Firn on its own Windows and Mac computers every time changes are pushed (`.github/workflows/build.yml`).

- **To try a change:** open the **Actions** tab, click the latest **Build** run, and download "Firn for Windows" or "Firn for macOS" under **Artifacts** (signed in to GitHub; kept for 30 days).
- **To publish a version:** raise `version` in `package.json` and add its notes at the top of `CHANGELOG.md` (`## Firn X.Y.Z`, a bold one-line headline, a sentence or two, then `### New` / `### Better` / `### Fixed` lists; Firn's What's new reads them). Then, on GitHub, **Releases > Draft a new release**: a tag named `v` plus the version (for example `v0.7.4`), the headline as the title, the rest of the section as the description, and **Publish release**. In about 15 minutes GitHub attaches the Windows installer and update files and the Mac zip, and installed copies update themselves from it.
- **Signing:** the Mac build signs with Firn's Apple Developer ID and has Apple notarize it, from six repository secrets: `MAC_CERTIFICATE_P12`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, and `APPLE_TEAM_ID`. The Windows build signs with Azure Artifact Signing, signing in as the `windows-signing` environment, from `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`. Without them, a push still builds (unsigned), but a release refuses to.

### The Safe Browsing key

Google's Safe Browsing needs a free key, built into each copy of Firn. Without one, Firn works the same but doesn't warn about scam sites.

1. At [console.cloud.google.com](https://console.cloud.google.com), create a project, and in **APIs & Services → Library** enable the **Safe Browsing API**.
2. In **APIs & Services → Credentials**, create an API key and restrict it to the Safe Browsing API.
3. For your own builds, put the key in a file named `safe-browsing-key.txt` in the `firn` folder (it's never uploaded: `.gitignore` skips it). For GitHub's builds, add it as the repository secret `FIRN_SAFE_BROWSING_KEY`.

Google's free key is for non-commercial use; if Firn is ever sold, it should move to Google's paid version (Web Risk).

### Where things live

- `src/main.ts`: the main process: the window, its layers, shortcuts, and messages from the UI.
- `src/tabs.ts`: tabs, spaces, Basecamp, pins, archiving, and sleeping tabs. It doesn't depend on Electron.
- `src/engine/`: the browser engine: `engine.ts` describes what a web page can do, and `electron.ts` is Electron's version of it.
- `src/types.ts`: the data model shared by every part of Firn.
- `src/preload.ts`: the narrow bridge between Firn's interface and the main process.
- `src/ui/`: Firn's own interface (React): the sidebar, the floating panels, the top bar, the welcome, and the styles.
- `src/page-preload.ts`: the small, walled-off helper inside web pages (saved passwords, and "has someone typed here?" for sleeping tabs).
- `src/adblock.ts`, `src/safebrowsing.ts`, `src/passwords.ts`, `src/defaultBrowser.ts`, `src/updates.ts`: ad blocking, scam warnings, saved passwords, the default browser, and updates.
- `tests/e2e/`: checks that start Firn and click through it.
- `brand/` and `assets/`: Firn's logo, wordmark, and app icons. `demo/`: the recorder for marketing clips.

Your data lives in `%APPDATA%\Firn` on Windows (`~/Library/Application Support/Firn` on a Mac): `session.json` (tabs and spaces; deleting it starts Firn fresh), `history.json`, `settings.json`, `passwords.json`, and friends.

### If something misbehaves

- **Ctrl+Shift+D** prints a snapshot of the window's layers, the cursor, and the screen to the terminal.
- Start Firn with `FIRN_DEBUG=1` (in PowerShell: `$env:FIRN_DEBUG=1; npm start`) to log what the layers do.
- `FIRN_NO_GLASS=1` turns off the frosted-glass frame, if the window ever shows black or flickers behind the sidebar.

## License

Firn's code is open source under the [Mozilla Public License 2.0](LICENSE), the license Firefox uses. Anyone can read it, check what Firn does with their data, and build on it; changes to Firn's own files have to stay open under the same license.

**The Firn name, logo, and app icons are not covered by the license.** They identify Firn itself, so please don't use them for your own version or anything that could be mistaken for Firn; give a version you share its own name and look. (That covers `brand/`, `assets/`, and `src/ui/firn-mark.svg`.)

Fraunces, the typeface in `src/ui/fonts/`, has its own license: the SIL Open Font License (`src/ui/fonts/Fraunces-OFL.txt`).
