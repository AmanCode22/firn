# Firn's end-to-end checks

These start the real Firn and click through it like a person would, then
say PASS or FAIL for each thing they check (about 200 in all). Run them
after every change, before committing.

```
bash tests/e2e/run.sh              # every check (about 10 minutes)
bash tests/e2e/run.sh settings     # just one, or a few: run.sh perm lookout
```

## Where they run

In Claude's cloud workspace (Linux). They need what it already has: a
virtual screen (`Xvfb`), ImageMagick's `import` for screenshots, Python 3,
and Playwright installed globally. They also assume Firn keeps its data in
`/root/.config/Firn`, as it does there. They won't run on Windows or a Mac
as they are.

Each check starts from a clean slate (no saved tabs, the welcome already
done), so they never touch anyone's real Firn data, only the workspace's.
Screenshots and logs land in `tests/e2e/out/` (not saved in Git).

## What's here

| Check          | What it covers                                                        |
| -------------- | --------------------------------------------------------------------- |
| `all`          | The basics: tabs, the sidebar, hiding and peeking, the top bar        |
| `settings`     | Settings: every option, saved and applied                             |
| `perm`         | Site permissions (camera, location…): the question and the answer     |
| `ctxmenu`      | Right-click menus on pages, links, images and text                    |
| `lookout`      | Lookout: opening, closing, promoting to a tab                         |
| `addrtop`      | The address bar "At the top"                                          |
| `downloads`    | Downloads: saving, progress, opening, the list                        |
| `passwords`    | Saved passwords: offering to save, filling in, the list               |
| `safebrowsing` | Scam and malware warnings (against a pretend Google list)             |
| `welcome`      | The welcome, the first time Firn opens                                |
| `brand`        | The Fraunces headings                                                 |
| `bottom`       | The bottom row of the sidebar (the Firn button, spaces)               |
| `updates`      | Automatic updates stay off on a copy that isn't installed on Windows  |
| `macmenu`      | The Mac menu bar (shown on Linux for the check): menus and choices    |
| `basecamp`     | Basecamp: dragging tiles to reorder them                              |
| `whatsnew`     | What's new: after an update, from the menus, never on a fresh install |
| `adblock`      | Blocking ads and trackers, "Allow ads on this site", the switch       |
| `defaultbrowser` | Links from other apps open as tabs; the Settings row where it applies |
| `tooltips`     | Firn's own hover labels, in the sidebar and the top bar               |
| `sound`        | The speaker on tabs playing sound: muting and unmuting               |
| `player`       | The mini player: shown for sound off screen, pause and play, going there |
| `demo`         | Demo mode for the demo recorder: its own data folder, 1440×900, light; a normal start unchanged |
| `splitdrag`    | Dragging a tab (or a Basecamp tile or pin) onto the page opens it in split view (the page glides aside; also from the peeking sidebar); a tab opens on click |
| `realdrag`     | The same drags with a real system mouse (through the window system): the carried tab stays under the mouse, in front of the page |
| `splithandle` | A split view's handle (real mouse): it comes out near the top middle of a side; drag it to swap the sides, × takes a side out |
| `shortcuts`   | Settings > Keyboard shortcuts: the page, its key caps, every key on it does what it says (Windows and Mac), and a few pressed for real |
| `archive`     | Archiving old tabs: an everyday tab unused for the chosen days of use goes to the Archive (pinned, Basecamp, the current tab, and each space's latest stay), the archive box (bottom right, its pulse), the Archive panel by space, forgetting after 30 days of use, bringing one back, Settings, and a restart |
| `installer`   | Windows installer events (plain logic, no Windows needed): a Start menu entry only on install, nothing on updates, Start menu and desktop shortcuts removed on uninstall, and Firn listed among the browsers |
| `mactips`     | Hover labels on a Mac (pretended): the system's own tooltips (titles kept, no label of Firn's), a tab's name only when cut off, the top bar's buttons too |
| `restore`     | Back from minimized: the page on screen (and Firn's own layers) drawn again, pages out of sight left alone |
| `splitpin`    | Leaving a split view by pinning a tab or adding it to Basecamp: only the tab you're on stays on the page; a link from a split's side opens below its row; switching spaces mid-drag cancels the drag |
| `updatestatus` | Settings > Updates: the version and where updates are, "Check for updates", "Restart now" once a new version is ready (pretended), and a copy that can't update itself saying why |
| `topedge` | The top edge (Windows/Linux, "In the sidebar"): a site's own search box at the very top keeps its clicks (no top bar), a flick past the edge brings nothing, resting at the very top brings the bar, and a setting changing as it slides away doesn't leave it behind |
| `sleep` | Sleeping tabs (pretended: 3 seconds): a tab not on screen for a while is set aside and rests quieter; the tab on screen, one playing sound, and one with typed text stay awake; clicking a sleeping tab brings it back with its history; a tab just left stays awake the full time |
| `downloadfx` | A download's small moments in the sidebar: the new row rises in with a wash of color and a soft ring, the file settles in when done, a very long name keeps the row (and its ×) inside the sidebar, and rows already there at start are simply there |
| `useragent` | Websites see Firn as plain Chrome (no "Firn" or "Electron" in the browser's name), both what pages read and what they're sent |
| `basecampdrag` | Dragging between Basecamp and the tabs: a tab dragged up opens a spot in Basecamp and joins it; a tile dragged down opens a gap and becomes an everyday tab, or a pinned tab above the divider |
| `pinclose`  | Closing a pinned tab: the first click unloads it; once it rests (mouse away and back), an × removes it; Ctrl+Shift+T puts it back in its old place; unloading a space's only tab leaves the empty page |
| `appregion` | A website can't mark part of itself as a "drag the window here" area (the Azure portal's top bar did); Firn's own sidebar top row still can |
| `soundgaps` | A podcast going quiet between sentences keeps its speaker and mini player; pausing it takes them away at once |
| `paneltint` | The command bar, Settings, and other panels take a faint touch of the space's color (the picked result a soft wash); another space's color changes them |
| `fullscreen` | A page going fullscreen fills the screen and leaves it with the page, or when its tab is closed while fullscreen |
| `glides` | Two glides at once (hiding the sidebar while the address bar moves to the top): the site keeps one layout until both end, then fits |

`site/` is a tiny test website the checks visit (served on this computer
only). `cdp.cjs`, `playwright.cjs` and `warp.py` are small helpers.

## Known flaky checks

These sometimes fail without anything being wrong; run them again before
worrying:

- `ctxmenu`: "Search opens a search for it in a new tab" needs the real
  internet, which the workspace may block.
- `all`: "on the way up, bar is covered in step with the page" and "bar
  edge matches page edge while gliding" are timing-sensitive by a frame.
