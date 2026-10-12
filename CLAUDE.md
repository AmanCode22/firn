# Project Brief — Firn

**Firn** (firnbrowser.com) is a calm, minimalist desktop browser. The name comes from firn, the settled, compacted snow high on alpine glaciers — quiet, clean, and still. Let that idea quietly inform the visual identity (soft whites, frost, gentle glacier tones alongside warm neutrals) without getting literal or icy-cold.

It is a calm, minimalist desktop browser in the spirit of Arc and Zen: sidebar-first, vertical tabs, pinned tabs, spaces, lookout, and split view. Built on Electron (real Chromium rendering). Built by David with Claude — David is not a professional developer, so explain decisions in plain language and keep changes small and testable.

Personal use first. Testers later. No rush — quality and feel over speed.

---

## North star

**It should feel calm.** Every screen should breathe. If something feels crammed, busy, or "techy," it's wrong — even if it works.

Inspired by Arc and Zen's *experience*, but all visuals, icons, and names are our own. Never copy their logos, assets, or branding.

## Vision: Zen and Arc for everyone

Zen and Arc are beautiful, but they're built for power users. Firn brings their best ideas to normal people (friends and family, not just enthusiasts), in a calm, beautiful package, on Chrome's engine, without the power-user bloat.

**Four words: Privacy, Simplicity, Calm, Beauty.**

- **Spaces are the big idea.** They're powerful and still easy for anyone to understand. Firn doesn't need Profiles, Containers *and* Spaces; Spaces alone should cover it.
- **Have the guts to say no.** Before adding a feature, ask: would a non-techy person understand it and miss it if it were gone? If it mainly serves power users, leave it out, or tuck it away so it never adds clutter.
- **Short menus.** No giant right-click menus (Zen's tab menu is the anti-example). A menu shows the few things you'd actually reach for, in plain words.
- **Discoverable, not memorized.** Anything important can be found by looking or right-clicking; keyboard shortcuts are a bonus, never the only way.
- **Privacy by default.** Data stays on the device unless the person chooses otherwise. No tracking, no telemetry, and privacy claims are only made when they're true.
- **Names: plain words win.** Keep a familiar word when it's already plain English (Spaces, Pins). Give something our own name when the other browsers' word is their brand coinage or unclear (Basecamp instead of Essentials, Lookout instead of Glance).
- **Serial (Oxford) comma, always.** In a list of three or more, a comma goes before the final "and" or "or": "tabs, color, and icon", "macOS, Windows, and Linux". Everywhere people read Firn's words: the app's interface, the welcome, warnings, menus, the README, release notes, and the website. (Two items take no comma: "mail and calendar".)
- **Opinionated: two looks, never more.** Firn picks the layout for people, the way mainstream browsers did for decades: vertical tabs in the sidebar, the page as the star. The one choice is where the address bar sits ("In the sidebar" or "At the top"), offered on every platform, at onboarding and in settings. That's the last layout choice Firn ever gets: no top-bar tabs, no icon-only sidebar. Wanting more room is answered by hiding the sidebar (Ctrl+S, peeks at the left edge), not by more layouts.
  - *In the sidebar* (default): the current design. On Windows/Linux, reaching the top edge slides down a slim top bar with minimize/maximize/close, for dragging and double-clicking the window. On macOS there's no bar: the window's top edge itself grabs (its traffic lights stay in the sidebar).
  - *At the top*: the top bar is always there, across the whole window, and the sidebar's top row moves up into it, in exactly the same spot (switching looks or hiding the sidebar moves nothing): the window's traffic lights (macOS) and the sidebar button on the left, back, forward, and reload at the sidebar column's right edge; the **same address bar** (same component, height, look and width as in the sidebar) centered over the page area; on the right, the window buttons (Windows/Linux; on macOS the right side stays empty). The sidebar, docked or peeking, sits below the bar with Basecamp, tabs, and spaces. The traffic lights never move in this look (no handoff between the bar and a sliding sidebar), and the left edge only brings the sidebar out below the bar.
- **Calm over clever.** When a choice is between more options and less to think about, pick less to think about.

We're not removing features now; this is the lens for everything from here on.

---

## Design principles

1. **Space is a feature.** Generous padding, comfortable row heights, nothing touching the edges. When in doubt, add room.
2. **Minimal chrome.** The web page is the star. Browser UI recedes until needed.
3. **Warm and organic, not techy.** Soft neutrals, warm tones, gentle contrast. No neon accents, no harsh pure black/white.
4. **Soft translucency.** Sidebar and overlays use subtle frosted-glass blur (Liquid Glass–like), tinted by the current space's color.
5. **Quiet motion.** Short, eased animations (150–250ms). Things glide, never snap or bounce.
6. **One accent at a time.** Each space has one theme color; everything else stays neutral.

### Starter design tokens (tune freely)

```
Sidebar width:        260px default (resizable 200–360), collapsible to 0
Tab row height:       36px
Tab row padding:      8px 12px
Gap between tabs:     4px
Section spacing:      20px
Corner radius:        10px (tabs), 14px (panels/overlays)
Window content inset: 8px around the web view, radius 12px (page floats in the frame)
Font:                 system UI font, 13px tabs, 12px labels; brand moments
                      (big headings only: the welcome, panel titles, the
                      empty page, the scam warning) use Fraunces, soft
Motion:               200ms, ease-out
Neutrals:             warm grays (slight brown/sand undertone), not blue-gray
Light & dark:         both, following the OS setting
```

### First light (the welcome and the empty page)

Firn's brand moments use the "First light" look: sunrise in a snowy cabin, coffee in hand. Cool glacier sky high, warm sunrise low, snow at the bottom. Code: `src/ui/FirstLight.tsx` (the scene and the snow) and the "First light" section of `src/ui/styles.css`.

- **Where:** the full-window welcome (sky, sun, drifting flakes, snow, grain) and the empty page (the same sky and sunrise, snow, and the mark). Not on everyday browser UI.
- **Only the snow and the mark take the space's color.** The glacier sky haze and the orange sunrise glow stay the same for every space (David's call: they're First light's constant).
- **Snow:** five wavy bands. Glacier blues by default and for a Glacier space (the first color, the default for new spaces, so nothing shifts at the welcome's space step); with another space color, `mix(page, space, 20/33/47/62/78%)` in light and `mix(#2B2826, space, 12/20/29/38/48%)` in dark. A color change cross-fades (400ms).
- **Dark = "blue hour":** a dark sky with a deep glacier haze and a faint ember low down, dark snow, light ink buttons.
- **Performance (required):** no `backdrop-filter` on large surfaces ("glass" is a semi-clear color); the paper grain sits under the content, never over blurred things; glows are plain gradients and the snow is one SVG; nothing re-renders while idle; motion is transform and opacity only, and stops with reduced motion.
- **The welcome's finish** ("Welcome in."): about 2.4s, unhurried (David found 1.6s too fast to enjoy); the words hold a moment, the browser rises over them (about 1.1s), then the scene fades to the real browser. Reduced motion: a plain 300ms fade.

---

## Features

### Vertical tabs (sidebar)
- Tabs live in a left sidebar, top to bottom.
- Favicon + title, close button appears only on hover.
- Drag to reorder. Smooth animation as rows shift.
- Sidebar can collapse fully and reappear on hover at the left edge.

### Pinned tabs
- Pinned area at the top of the sidebar, shown as a compact grid of favicon tiles.
- Pinned tabs persist forever (across restarts), per space.
- A pinned tab remembers its "home" URL; a reset action returns it there.

### Today tabs (unpinned)
- Below pinned tabs, divided by a soft separator.
- Optional later: auto-archive unpinned tabs after X hours of inactivity (like Arc).

### Spaces
- Groups of pinned + unpinned tabs, each with a name, icon (Firn's own simple line icons, drawn in the space's color — not emoji, which look like site favicons), and theme color.
- Switch with a row of dots/icons at the bottom of the sidebar, or with a keyboard shortcut / horizontal swipe.
- Switching spaces gently cross-fades the sidebar tint.

### Lookout (link preview)
- Configurable trigger (e.g. modifier+click or click on links that leave the site).
- Opens the link in a floating rounded overlay over the current page, with a dimmed backdrop.
- Close with Esc or clicking outside. One button promotes it to a full tab.
- Opens with a subtle scale + fade.

### Split view
- Two (later up to four) tabs side by side, with a draggable divider.
- Each pane keeps its own address and navigation.
- Split groups show as one combined item in the sidebar.

### Command bar
- One shortcut (Ctrl/Cmd+T or Ctrl/Cmd+L) opens a centered floating bar: type a URL, search, or jump to an open tab.

### Essentials (unglamorous but required)
- Session restore on restart.
- Keyboard shortcuts for everything.
- History, downloads, basic settings page.
- Find in page, zoom, dev tools.

---

## Architecture

- **Electron + TypeScript.** UI built with React + Vite (via Electron Forge's Vite template) unless there's a strong reason otherwise.
- **Web pages** render in `WebContentsView`s managed by the main process (not the deprecated `BrowserView`, and avoid the `<webview>` tag). The sidebar and overlays are the app's own UI layer.
- **Security defaults, always:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` for any web content. Only a narrow preload bridge between UI and main process.
  - The one exception, for saved passwords: a tiny helper inside web pages (`src/page-preload.ts`), in its own isolated world, that exposes nothing to the page. It only reports a sign-in and asks for a login to fill. The main process trusts nothing it says about which site it is: it only accepts Firn's own pages' top frames, takes the site from the frame's real address, and only on https (or this computer). Passwords are encrypted with the system's protection (`safeStorage`) or not saved at all.
- **Engine layer:** keep Firn able to move to a Chromium fork later. Two rules for all code:
  1. The UI (`src/ui/`) never touches Electron; it only talks through the preload bridge (`window.firn`).
  2. App logic (tabs, spaces, Basecamp, pins, session) never touches Electron's page views directly; it uses the engine interface in `src/engine/engine.ts`. Electron's version lives in `src/engine/electron.ts`.
  Window and overlay code (`src/main.ts`) may stay Electron-specific; a fork would rewrite it natively anyway.
- **State:** one central store for the tab model, saved to disk so sessions survive restarts. Design it so it can later sync to a cloud database (Supabase or Firebase) for multi-device.

### Core data model (get this right first)

```
Space   { id, name, icon, color, order }
Tab     { id, spaceId, url, title, favicon, pinned, homeUrl?,
          order, lastActiveAt, splitGroupId? }
SplitGroup { id, spaceId, tabIds[], layout, sizes[] }
Window  { id, activeSpaceId, activeTabId, sidebarWidth, sidebarCollapsed }
```

Lookout overlays are temporary and are not stored as tabs until promoted.

---

## Roadmap

Each phase has a "done" test. Don't start the next phase until the current one passes.

1. **Window that browses** — Electron app opens, loads a site, address bar, back/forward/reload.
   *Done:* David can browse normally in it for 10 minutes.
2. **Sidebar + vertical tabs** — Tab model, sidebar UI, new/close/switch/reorder tabs, design tokens applied.
   *Done:* It already looks calm and spacious, and David prefers it to Chrome's vertical tabs.
3. **Pinned tabs + persistence** — Pinned grid, session restore.
   *Done:* Close and reopen; everything comes back exactly as it was.
4. **Spaces** — Create/switch/theme spaces.
   *Done:* Work and personal spaces feel like separate browsers.
5. **Lookout + split view + command bar.**
   *Done:* Used daily without reaching for another browser.
6. **Polish & shipping** — Shortcuts, settings, auto-updates, Windows/Mac/Linux builds, code signing (later, when sharing with testers).
7. **Later** — Cross-device sync, mobile companion app (iOS requires WebKit, so it's a separate native app).

---

### Where we are

*Update this note whenever a step lands.*

- **Phases 1–5: done.** Firn browses, has the sidebar with vertical tabs, pins, Basecamp, spaces, session restore, Lookout, split view and the command bar.
- **Phase 6 (polish & shipping): in progress.**
  - Done: find in page, zoom, right-click menus, downloads, PDF viewer, site permissions, history, settings (including the address bar's two looks), saved passwords, scam and malware warnings (Google Safe Browsing), the welcome, Fraunces brand headings, the Firn menu at the bottom-left, the Windows installer ("Firn Setup.exe"), version 0.1.0, the MPL 2.0 license, and automatic Windows and Mac builds on GitHub (releases attach the downloads), and the first round of testing on real Macs (traffic lights that move with the sidebar, page corners matching macOS 26+, the window's top edge to grab it).
  - First light: the full-window welcome (sunrise scene, frosted cards, snow in the space's color, the "Welcome in." finish) and the empty page (the sky and sunrise, with snow and the mark in the space's color). Glacier is the first space color and the default for new spaces. See "First light" under the design principles.
  - Auto-updates: Windows and Mac built (`src/updates.ts`), to be tested for real once 0.1.0 is published and a later version follows: an installed copy (Windows: by Firn Setup.exe; Mac: in Applications) checks GitHub releases through update.electronjs.org and updates on the next start. Mac: the universal app, attached as `Firn-darwin-arm64-<version>.zip` and `Firn-darwin-x64-<version>.zip` too (the service matches a Mac's "darwin-arm64"/"darwin-x64" by those names; the `-universal` zip alone was never downloaded by an update through 0.6.0, so Macs weren't updating: fixed from 0.6.1's release on), and needs the Developer ID signature.
  - Mac menu bar: short Firn / File / Edit / View / Window / Help menus (`src/menu.ts`), Firn > Settings… (Cmd+,); Ctrl+, already opened Settings on Windows. Checked on David's Mac mini.
  - Mac app icon: the Liquid Glass icon (`brand/icon-composer/Firn.icon`) on macOS 26+, compiled by GitHub's Mac build; older Macs keep the .icns. Checked on David's Mac mini (subtle, but there).
  - **Default browser, for 0.3.0** (`src/defaultBrowser.ts`): Settings > Default browser ("Open links in Firn", "Make Firn default…" or "Firn is your default browser"), shown only where this copy can be the default (installed on Windows, or in a Mac's Applications folder). Windows: the installer's install/update events write Firn's browser registration under HKCU (StartMenuInternet\Firn, the FirnURL ProgID for http/https/.htm/.html, RegisteredApplications), uninstall removes it; the button re-registers and opens `ms-settings:defaultapps?registeredAppUser=Firn` (Windows won't let apps set themselves); "is default" reads the https UserChoice ProgId. Mac: `protocols` (http/https) and an HTML document type in Info.plist; the button calls setAsDefaultProtocolClient (macOS asks). Links arrive as command-line arguments (first start, or `second-instance`) on Windows, `open-url`/`open-file` on Mac, and open as new tabs in the normal window (only http/https and existing .htm/.html files). Also an optional welcome step, "Open links in Firn?" (between everyday sites and tips), shown only when the state is "no" when leaving the first screen (decided once, so the steps don't shift when it becomes "yes"); `FIRN_DEFAULT_BROWSER_TEST` pretends for the end-to-end checks. Checked on David's Windows PC. **More file types** (David: Windows listed only .htm, .html, HTTP, and HTTPS): Firn is now offered, as Chrome and Edge are, for web pages (.htm, .html, .shtml, .xht, .xhtml), PDFs (Firn PDF document), and .svg and .webp images (Firn image), one list (`WEB_FILE_TYPES` in `src/defaultBrowser.ts`) for Windows' registration, files handed over by other apps, and the Mac's `open-file`; on the Mac also XHTML, PDF, and the two image kinds as "Alternate" viewers in Info.plist. Offered only: what opens them now stays unless the person picks Firn. No mailto or tel (a browser can't do anything with them). Every update re-registers, so existing installs get the new types. "Make Firn default…" now runs the registry writes (about 25) without holding Firn up. To be checked on David's Windows PC: Default apps > Firn lists the new types; a PDF opened "with Firn" opens in a tab.
  - **Ad and tracker blocking, for 0.2.0 ("Firn now blocks ads and trackers."):** `src/adblock.ts`, with Ghostery's core `@ghostery/adblocker` (David approved; MPL 2.0). Not the `-electron` package: it would take over the session's one request hook (Safe Browsing's) and add a helper inside pages. Network blocking only (nothing runs in pages): the engine's request hook (`setRequestBlocker`, beside the navigation guard) asks it about everything a page loads. Lists: EasyList, EasyPrivacy, and uBlock Origin's from Ghostery's GitHub, fetched about daily and kept prepared in `ad-block-lists.bin`. On by default (Settings > Block ads and trackers); "Allow ads on this site" / "Block ads on this site" in the page's right-click menu, also in the address bar's site button (`adsAllowedSites`, by host without "www."). Later, maybe: hiding the empty spaces (cosmetic filtering, would need a helper inside pages: ask first), and preparing the lists off the main thread (about 0.7 s once a day).
  - **0.1.1 published** (What's new, the fixed-name Mac zip); checked updating from 0.1.0 on Windows. **0.1.2:** Electron 44.5.1 → 44.7.0 (Chrome security fixes).
  - **0.1.0 published** on GitHub (Windows installer, Windows update files, and the notarized Mac zip). The website's download buttons belong to the website session.
  - What's new (`src/ui/WhatsNew.tsx`), for 0.1.1: the first start after an update shows the release notes since the version that ran before (`lastVersion` in settings), once, in Settings' sheet style; never on a fresh install (the welcome instead); also in the Firn menu, the command bar, and the Mac Help menu. The notes are `CHANGELOG.md`, built into Firn (nothing fetched). Releases also attach the Mac zip as `Firn.for.Mac.zip`, so `releases/latest/download/Firn.for.Mac.zip` is always the newest (no dash before "Mac", so the update service ignores it).
  - Hover labels (`src/ui/tooltips.ts`): Firn's own small rounded label instead of the system's tooltips (Windows' square boxes), after about half a second, below what's hovered, and inside the sidebar there (it can't draw over the page; long names wrap to two lines). Code keeps writing `title="…"`; it's moved to `data-tip` (plus an aria-label for icon-only buttons), so checks look buttons up by `data-tip`. A tab's label shows only when its name is cut off. The top bar is too short to hold a label, so it asks the main process (`showTip`), and the floating layer draws it in a small box of its own just below the bar (only while the floating layer is free; a panel opening takes over). **On a Mac (for 0.7.0, David: tuck it away): the system's own tooltips instead** (they belong there, and a system tooltip isn't held inside the sidebar or the bar): titles stay (with `data-tip` and the aria-label too), Firn draws no label, and a tab whose name is fully shown loses its title while hovered, so only cut-off names show. `?tips=native` (`FIRN_NATIVE_TIPS_TEST=1`) pretends for the `mactips` check. To be checked on David's Mac: the system's tooltips appear, and a fully shown tab name never gets one.
  - **Archiving old tabs, for 0.7.0** (`src/archive.ts`, `archiveOld` in `src/tabs.ts`): everyday tabs not looked at for a while go to the Archive. Settings > Tabs, "Archive tabs you haven't used for": 1 day, 7 days (default; David: Arc and Zen's 12 hours is for power users, 30 days of use was too long to ever be seen working), 30 days, or Never. Days are days Firn was used (`daysUsed` in the session, one per day it's open), not calendar days. A first look 8 seconds after Firn opens, then hourly (and when the setting changes). Never archived: pinned and Basecamp tabs, the tab on screen (both halves of a split), any tab in split view, a tab playing sound, and each space's current and most recent tab (no space is left empty). The Archive (`archive` in the session, the newest 200; a tab is forgotten after 30 days of use there, still in History) opens from the **archive box** (always there, at the bottom right of the sidebar, in the spot that kept the spaces centered; right-click: "Show archived tabs" and how long), the Firn menu ("Archived tabs"), the command bar, and Settings ("Show…"): a sheet like History's, grouped by space; click a tab to bring it back in its space, × to forget it. When Firn tidies tabs away, the box gives a little pulse (David: polished, subtle animations are calming): its lid lifts and closes, and a soft ring in the space's color spreads and fades (`ArchiveBox` in `src/ui/Sidebar.tsx`, `.archive-button` in styles.css). Checked on David's Windows PC and Mac. The box is the space icons' size (16px), at 75% strength (full on hover), so the bottom row reads as one even line. Closing a tab with × still closes it (not archived, unlike Arc): the Archive only holds what Firn put away. The `archive` check starts Firn plainly and looks over CDP (Playwright's launcher hangs on restored tabs that haven't loaded).
  - **No desktop shortcut on Windows, for 0.7.0** (`src/installer.ts`, David: tuck it away): the first install makes a Start menu entry only; updates never touch shortcuts (one someone deleted or moved stays that way); uninstalling removes the Start menu entry and any desktop shortcut older versions made. Firn handles the installer's events itself (asking the installer's Update.exe with `--shortcut-locations`), instead of electron-squirrel-startup, which made desktop and Start menu shortcuts on every install and update. `installerSteps` is plain logic, checked by `installer` without Windows. Checked on David's Windows PC: a deleted desktop shortcut doesn't come back with updates, a fresh install has none, and uninstalling leaves nothing behind.
  - **0.7.1 prepared** ("Firn can now open your PDFs and saved pages."): Firn offered for PDFs, more web pages, and web images (under Default browser), the blank page after minimizing, and the archive box at the space icons' size.
  - **Blank page after minimizing** (David, on Windows: the page stayed blank after restoring the window until something changed, e.g. the top bar sliding in; a known Electron problem, more sites than YouTube): on the window's `restore` and `show`, Firn asks the pages on screen and its own layers to draw again, right away and 150ms later (`Page.repaint`, `repaintAll` in `src/main.ts`; the `restore` check). To be checked on David's Windows PC; if a page still stays blank, next try a 1px size nudge of the page on restore (what resizing the window does).
  - **0.7.0 published** ("Tabs you're done with now tidy themselves away."): archiving old tabs and the archive box, no desktop shortcut on Windows, and the Mac's own hover labels (each below).
  - **0.6.1 published** ("Firn on a Mac now keeps itself up to date."): the release also attaches the Mac zip under arm64 and x64 names, so Macs on 0.5.0/0.6.0 update to it. Checked: Firn updates itself on David's Mac mini and Windows PC.
  - **0.6.0 published** ("Learn Firn's keyboard shortcuts."): Settings > Keyboard (also the command bar, "shortcuts") opens a sheet listing every shortcut, grouped (Tabs, Spaces, Pages, Firn), keys as key caps (Ctrl on Windows, ⌘ on a Mac). Read only (David: no editing). One list, `src/shortcuts.ts`: the main process matches keys against it (`matchShortcut` in `handleShortcut`) and the page shows it (`src/ui/Shortcuts.tsx`), so they can't drift; the `shortcuts` check presses every key on the page (in pretend) for Windows and Mac. Also fixed: long hover labels end after two lines (the words in a box of their own, `.firn-tip-text`).
  - **0.5.0 published** ("Drag a tab onto the page to see two side by side."): drag a tab into split view, the carried tab, and the split view's handles. Checked on Windows.
  - **0.4.0 published** ("See what's playing, and pause it from anywhere."): sound in tabs, the speaker and the mini player. Checked on David's Windows PC and Mac with real sites.
  - **Sound in tabs, step one:** a small speaker at the end of any tab playing sound (`TabSound` in `src/ui/TabList.tsx`; also in split view's halves, and as a small badge in a Basecamp tile's corner). Click it to mute the tab; muted, it stays (crossed out, a little quieter) to turn the sound back on. On hover it steps aside for the close button. Also "Mute tab" / "Unmute tab" at the top of the tab's right-click menu while there's sound. The engine reports it (`Page.audible`, `muted`, `setMuted`); muting isn't saved across restarts.
  - **Sound in tabs, step two: the mini player** (`src/ui/MiniPlayer.tsx`), for 0.4.0 together with the speaker. A soft card just above the Firn button while a tab that isn't on screen (in any space) plays sound; the one that started last, never a tab muted on purpose. Shows the tab's icon, name, and site; click it to go to the tab (switching spaces); its button pauses or plays. Pausing runs a tiny script that pauses the page's playing video and audio elements and later plays just those (`Page.pauseMedia` / `playMedia`; the page itself in an isolated world, embedded frames in their own world, sending back only a count). Sound it can't pause (made by the page's own code) is muted instead, and unmuted on Play. A paused player stays (offering Play) until you play it, go to the tab, or close it.
  - **Drag a tab into split view, step one** (David's call: every tab can be dragged in): drag a tab (or a Basecamp tile) from the sidebar out over the page; past the sidebar's edge, the page moves to one half and the other half shows a soft card in the space's color with the tab's icon and name ("Let go to open it here"); which half follows the pointer. Back over the sidebar, nothing changes; let go over the page, and the two open side by side (on a split view, the tab takes that side's place, and the one there carries on as an ordinary tab). Basecamp tiles and pinned tabs stay where they are: a copy of them joins the split among the everyday tabs (so is a Basecamp or pinned page on screen). The right-click menu's "Split view with…" still works. Tabs now open on a click (press and let go without dragging), not on the press, so a drag leaves the page on screen as it is. Code: `previewDrop` / `dropToSplit` in `src/tabs.ts`, `src/ui/splitDrag.ts`, `DropCard` in `src/ui/App.tsx`; drags follow the pointer on the window (`src/ui/followPointer.ts`). **Step two:** the page glides (200ms, easing out) to its half, between halves, and back, instead of jumping (`put` / glides in `src/tabs.ts`, the site's layout held meanwhile). From the peeking sidebar (sidebar hidden): it stays out while the mouse button is held (`setPeekHolding`), steps aside (slides out of view, its layer staying to finish the drag) while the tab is over the page, comes back if the tab goes back over it, and goes once the tab is dropped. **The carried tab** (David: the tab must stay attached to the mouse until it's let go, never go behind the page): pulled sideways out of its place (16px, `CARRY_AFTER` in `src/ui/splitDrag.ts`; a Basecamp tile once the pointer passes Basecamp's right edge), the tab is drawn by the floating layer, across the window and in front of the page (`carryTab` → `'tabs:carry'` in `src/main.ts` → `CarriedTab` in `src/ui/Floating.tsx`): it glides from where it was to the pointer (120ms), then follows it exactly, with the spot it was grabbed under the pointer; its place in the sidebar waits, faded. Let go, it fades and the layer goes. The drop card in the page's free half only says "Let go to open it here", low down. Checked with a real system mouse too (`realdrag`, through X's test extension, `tests/e2e/xmouse.py`). **Handles** (after Zen's, in Firn's look): near the top middle of a split view's side (within 130px of its middle, 48px of its top), once the mouse rests there a moment (350ms, so it doesn't get in the way of a site's own logo, search, or menu up there), a soft frosted pill slides down: a grip (drag it over the other side and the two glide past each other to swap, kept on letting go, undone if brought back) and a × that takes that side out of the split (the tab stays, as an ordinary tab; the other side fills the page). Drawn by the floating layer in a small box of its own (`splitHandle` / `watchSplitHandle` in `src/main.ts`, checked in the edge watch; `SplitHandle` in `src/ui/Floating.tsx`); `splitOnScreen` / `previewSwap` / `swapSides` / `takeOutOfSplit` in `src/tabs.ts`. Checked on David's Windows PC.
  - Basecamp tiles drag to reorder (`src/ui/Basecamp.tsx`): the tile lifts a little (keeping its glow) and follows the pointer, the others glide aside, and the order is saved. Within Basecamp only; dragging a tab into Basecamp or a tile out of it can come later.
  - "At the top" redone (one bar across the window, the top row's buttons in exactly the sidebar's spot) and a calmer welcome finish (about 2.4s, the rising browser in Glacier): checked on Windows. Checked on David's Mac too: the traffic lights stay still, switching looks moves only the address bar, the rising browser is Glacier.
  - **Apple notarization: done** (checked on David's Mac: opens with no "Open Anyway"; the first notarization took about 37 minutes). David made the Developer ID Application certificate and the App Store Connect API key, and added the six GitHub secrets (`MAC_CERTIFICATE_P12` as base64, `MAC_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`; never pasted to Claude). GitHub's Mac build imports the certificate into a keychain of its own, signs with the hardened runtime and osx-sign's default (Chrome-like) entitlements, notarizes with the API key, staples, and checks the result (`codesign`, `stapler`, `spctl`, the team ID). Without the secrets a push falls back to the ad-hoc signature; a release fails. Camera, microphone, and location have plain usage texts (`extendInfo` in `forge.config.mts`). Later: Windows code signing (optional).
- **Demo recorder** (`demo/`, see `demo/README.md`), for marketing clips and stills: `npm run demo` (or `-- --clip lookout`) builds Firn from source, seeds a throwaway profile in Firn's own formats (Personal/Glacier, Work/Sage, Weekend/Sand, three tabs each, and Basecamp), warms it up off camera, and records each clip on a Mac with ffmpeg's screen capture (AVFoundation, cropped to the window, Retina 2880×1800, 60 fps, H.264 CRF 14), plus `screencapture` stills. Web pages are separate views, so Playwright's own video would miss them. A soft demo cursor (a transparent, click-through window) glides to each target. Firn is driven through its main process (Electron's `executeJavaScript` and `sendInputEvent`), not Playwright, whose Electron launch can hang on Firn's not-yet-loaded tabs. Firn's side is demo mode (`src/demo.ts`), only with `FIRN_DEMO=1`: the profile folder `FIRN_DEMO_PROFILE`, a fixed 1440×900 window centered on the main screen, always light, no update checks, no Safe Browsing calls, permission questions refused, and a hook to pick an item from a right-click menu it opened. Clips find things by `data-testid`. Each clip opens on its own space and page (`start`), so they don't all begin on the same picture (they sit together on the website's landing page); `--no-stills` records clips only. Demo pages are David's picks from `npm run demo:try-pages` (a contact sheet of candidate pages, with a pop-up check): colorful, image-led sites, no Wikipedia white; demo mode hides Wikipedia's banners, the usual cookie boxes, and MDN's, and the recorder warns of anything big stuck over a page. Recorded on David's Mac: tabs-overview, spaces, basecamp, and split-view (dragging a tab in), done.
- **Release notes:** `CHANGELOG.md`. 0.1.0 is the first public release, written as an introduction ("Meet Firn, a calm browser for everyone."); David publishes it on GitHub once notarization and Mac auto-updates are done (its notes say Firn keeps itself up to date on Windows and Mac), and only then starts sharing the link. From the next version on, each release gets a one-line headline, a sentence or two on the biggest change, and short New / Better / Fixed lists in plain words (new features = next minor version, fixes only = next patch). Keep CHANGELOG.md's shape (`## Firn X.Y.Z`, the headline in bold on its own line, then paragraphs and `### New` / `### Better` / `### Fixed` lists): Firn's What's new reads it.
- **Not shared yet:** personal use and a few friends first. See "Decided: coming later" below for what's queued.

## Decided: coming later

Agreed with David; not started yet. Build them one at a time, in small steps like everything else.

- **Sound in tabs:** first a small speaker icon on any tab playing sound (click to mute; done); then a mini player (done) at the bottom of the sidebar, above the Firn button, shown only while audio plays in a tab that isn't on screen (title, play/pause, click to go to the tab).
- **Drag a tab into split view:** done, including the demo's split-view clip.
- **Archiving old tabs:** built for 0.7.0 (see "Where we are"). Everyday tabs not looked at for a while tidy themselves away. Options in Settings: 1 day, **7 days (default)**, 30 days, Never. Never archived: pinned and Basecamp tabs, the tab on screen, a tab playing sound, a tab in split view. Archived isn't deleted: an Archive list (Firn menu, command bar) brings any of them back, and they stay in History. Count days Firn was used, not calendar days (a vacation doesn't empty the sidebar).
- **Import passwords from another browser:** from the export file every browser and password manager can make (Chrome, Edge, Firefox, Safari, Bitwarden, 1Password), with short plain steps for each browser; imported passwords are encrypted like Firn's own, and Firn offers to delete the export file afterwards (it holds every password as plain text). In Settings > Saved passwords ("Import…") and as an optional welcome step. Reading them straight from Chrome or Edge isn't possible on Windows (they lock their passwords to themselves since 2024). Open question, decide separately: bookmarks and history. They can be read directly, but Firn has no bookmarks (pins and Basecamp instead), so they probably belong in what the command bar can search, not in the sidebar.
- **Extension support: researched, postponed** (David: not worth the hassle for now). Electron supports only a small part of Chrome's extension APIs (no toolbar popups, native messaging, or declarativeNetRequest); the add-on that fills most gaps, electron-chrome-extensions, is GPL-3 unless you buy its patron license (electron-chrome-web-store, for Web Store installs, is MIT). Ad-blocking extensions can't work beside Firn's own blocker (Electron's webRequest hook always wins, and today's blockers need declarativeNetRequest), and Firn's blocker covers that need anyway. Password managers might work (1Password's link to its desktop app won't: Firn isn't on its list of browsers); untested. If it comes back: a throwaway test build with Bitwarden, 1Password, and a few everyday extensions, after deciding the license. Full support would come with a Chromium fork.

## Deliberately not doing

The "guts to say no" list. Don't add these without David asking again.

- **A separate mini-window for links from other apps** (Arc's "Little Arc"): links open in the normal window, as people expect.
- **Easels** (Arc's canvases of clippings): niche.
- **Boosts** (restyling websites, forcing dark mode): bloat; even tinkerers rarely use them.
- **A developer mode:** F12 already opens the developer tools; that's enough.
- **Tab folders:** not now. Spaces, pins and Basecamp already organize tabs, and folders would add a fourth layer to explain. If testers ask (e.g. "my pinned list is too long"), consider simple one-level folders inside a space's pinned tabs only.

## How to work on this project (instructions for Claude)

- **Only work in dwurgy/firn.** The website (dwurgy/firn-site) has its own separate Claude Code session. Never attach, clone, or change another repository; if a task touches the website, tell David so he can take it there.
- Work in **small steps**: one feature at a time, then stop so David can run the app and look at it.
- After each step, say in plain words what changed and how to test it.
- **Design is half the job.** When building UI, follow the design principles and tokens above. If something would look cramped or loud, flag it.
- Ask before adding new dependencies; prefer few, well-maintained ones.
- Never weaken the security defaults above.
- **Keep Electron current.** Its updates carry Chrome's security fixes, the most important upkeep a browser has. About monthly, update to the newest patch of the current major (`npm install --save-dev --save-exact electron@<version>`), run every check, and release it as a patch version ("Safer under the hood."). Move to a new major version as its own step, tested on both computers. (`npm audit --omit=dev` should stay at 0; the dev-only `tinypool` warning comes from the oxfmt formatter and never ships.)
- Before committing, run `npm run lint`, `npm run typecheck` and the end-to-end checks (`bash tests/e2e/run.sh`, see `tests/e2e/README.md`); add or update a check for what changed.
- Commit to Git after each working step with a clear message.
- **Every so often, a look back** (David): a review of what's been built, for bugs and for places to make Firn faster or lighter, then fixes in small steps like everything else.
- Primary platform for now: **Windows**. Keep code cross-platform anyway.
