# What's new in Firn

## Firn 0.9.1

**Search the Azure portal, a steady speaker, and panels in your space's color.**

A few websites mark their top bar as a place to drag the window, meant for their own desktop apps. Firn now ignores that, so their search boxes and menus work as they do in Chrome. And the speaker on a tab now stays for as long as its podcast or song plays.

### Fixed

- **The Azure portal's search box** (and anything else in a site's top bar that wouldn't respond) now works, and right-clicking there no longer opens the window's menu.
- **Basecamp tiles come out more easily.** A tile leaves Basecamp as soon as you drag it past the bottom edge, and letting go just below Basecamp makes it your first pinned tab instead of sending it back.
- **A double-click on a pinned tab's button** lets it rest, without opening it again.
- **The speaker on a tab playing a podcast or song** stays while it plays, instead of flickering off whenever it goes quiet. The mini player stays too.
- **The speaker on a Basecamp tile** is clearer and sits centered in its circle.

### Better

- **The command bar, Settings, and other panels** take a faint touch of your space's color.

## Firn 0.9.0

**Drag your favorite sites into Basecamp.**

Drag any tab up into Basecamp to keep it there, or drag a tile down into your tabs. And a pinned tab you no longer need can now be removed.

### New

- **Drag into and out of Basecamp.** Drag a tab up into Basecamp and a spot opens where it will land. Drag a tile down into your tabs: above the line it becomes a pinned tab, below it an everyday tab.
- **Remove a pinned tab.** A pinned tab's button first lets it rest. Once it's resting, move the mouse away and back, and an × removes it. Changed your mind? Ctrl+Shift+T (⌘+Shift+T on a Mac) brings it back, in its old place.

### Fixed

- **A page staying blank after minimizing**, on Windows: Firn now puts the page back on screen the way switching tabs does.

## Firn 0.8.0

**A friendlier welcome, and a Basecamp that lines up.**

The welcome now shows how Firn's sidebar works, Basecamp, pinned tabs, and everyday tabs, and lets you pick your search engine. Basecamp's tiles now always sit in even rows.

### New

- **How your sidebar works.** A new welcome step draws the sidebar and explains its three parts: Basecamp for your everyday sites, pinned tabs for each space, and the rest of your tabs, which tidy themselves away. Right-click any tab to add it to Basecamp or pin it.
- **Choose your search.** The welcome asks which search you like: Google, DuckDuckGo, or Bing. More choices are in Settings.

### Better

- **Google is now the starting search** for new installs. If you already use Firn, nothing changes.
- **Basecamp's tiles sit in even rows**: five tiles make a row of 3 and a row of 2, six make two rows of 3, and a tile is never left alone on a row.
- **Downloads are easier to notice.** A new download rises in with a soft wash of your space's color, and a gentle ring marks the moment it's finished. The flake from 0.7.5 is gone.
- **Websites see Firn as Chrome**, the browser it's built on, so sites that acted strangely in Firn may now work as they do in Chrome.

### Fixed

- **Long download names** no longer push the download, and its buttons, under the page.
- **A page staying blank after minimizing**, on Windows: another fix, this time for how Windows decides what needs drawing.

## Firn 0.7.5

**Watch your downloads land.**

Clicking Download now shows you where your file went: a small Firn flake drifts from where you clicked down to the bottom of the sidebar, and the download settles in with a soft glow.

### Better

- **Downloads you can follow.** A Firn flake carries each download from the page to the sidebar, the download rises into place with a soft wash of your space's color, and a gentle ring marks the moment it's finished. With "reduce motion" on, it simply fades in.

## Firn 0.7.4

**Tabs you're not using now rest, so Firn stays light.**

A tab you haven't looked at for an hour now goes to sleep, giving back the memory its page was using. It keeps its place in the sidebar, and wakes up right where you left it when you click it.

### Better

- **Sleeping tabs.** After an hour out of sight, a tab rests a little quieter in the sidebar and stops using memory. Click it and it loads again, on the same page, with Back still working. Your Basecamp sites never sleep, so once you've opened them they're ready all day. A tab playing sound, one you've muted or paused, and one where you've started typing something stay awake too.

### Fixed

- **A page staying blank after minimizing**, on Windows. Firn now gently nudges the page when you bring it back from the taskbar, which is what it needed to show up again.
- **A tab paused from the mini player** is no longer tidied away into the Archive.

## Firn 0.7.3

**Check for updates yourself, and a signed Firn for Windows.**

Settings now shows which version of Firn you have and whether a newer one is on its way, with a button to check right now. And Firn for Windows now carries a digital signature with its maker's name, so Windows knows where it came from.

### New

- **Settings > Updates** shows your version and where updates are: up to date, downloading, or ready. **Check for updates** looks right away, and **Restart now** finishes an update that's waiting.

### Better

- **Firn for Windows is now signed.** The installer and Firn itself carry a digital signature, so Windows shows who made them instead of "Unknown publisher". Its warnings about new downloads should ease off over time.
- **The sidebar is lighter.** When something changes in one tab, Firn now redraws just that tab, not the whole list.

### Fixed

- **A search box at the very top of a website** (like the Azure portal's) works again. On Windows, the slim bar with the window buttons used to slide down over it and push the page away from your mouse. Now the bar comes down only when you rest the mouse against the very top edge of the screen or window.
- **On Windows, a taskbar pin** made from a running Firn could keep opening an old version after an update. New pins always open the newest Firn.

## Firn 0.7.2

**Safer passwords, and a lighter Firn.**

We looked back over everything Firn does and tightened it up: your saved passwords are better protected, and Firn now uses far less of your computer while it sits open in the background.

### Better

- **Saved passwords fill in only when you click into a login**, or tab to it. A website's own code can no longer make Firn fill in a password on its own.
- **Much lighter when idle.** Firn now uses about a fifth of the processor it did while sitting open, which is kinder to laptop batteries.
- **Your tabs are saved within a couple of seconds**, even while a busy page keeps changing its title.

### Fixed

- **Pinning or adding to Basecamp from split view** now leaves just your page on screen, instead of both halves.
- **A site asking twice** for your camera or notifications now asks you only once.
- **On Windows, an update finishing in the background** no longer brings Firn to the front.

## Firn 0.7.1

**Firn can now open your PDFs and saved pages.**

Firn can now be your choice for PDFs, saved web pages, and web images too, the way other browsers can, and a page no longer goes blank after you bring Firn back from the taskbar.

### Better

- **More things open in Firn.** PDFs, saved web pages, and .svg and .webp images can now open in Firn when you choose it in Windows' Default apps or a Mac's "Open With". Nothing changes unless you pick Firn.
- **The archive box** is now the same size as the space icons beside it, so the bottom of the sidebar looks even.

### Fixed

- **A blank page after minimizing.** Bringing Firn back from the taskbar no longer leaves the page blank until you move the mouse over something.

## Firn 0.7.0

**Tabs you're done with now tidy themselves away.**

Everyday tabs you haven't looked at for a week of using Firn quietly move into the archive box at the bottom of the sidebar, so your tabs stay calm without you closing them. Nothing is lost: click the box to bring any of them back.

### New

- **Archived tabs.** Tabs you haven't used for 7 days of using Firn move to the archive box (days you don't open Firn don't count, so a vacation won't empty your sidebar). Pinned tabs, Basecamp, the page you're on, split views, and anything playing sound always stay. Choose 1 day, 7 days, 30 days, or Never in Settings, or by right-clicking the box.
- **The archive box,** at the bottom right of the sidebar. It gives a little nod when it tidies something away. Click it to see your archived tabs by space, and click one to bring it back. Archived tabs are also in your history.

### Better

- **On a Mac, hover labels are the Mac's own,** the same ones your other Mac apps show.
- **On Windows, no more desktop shortcut.** New installs put Firn in the Start menu only, and updates no longer bring back a desktop shortcut you've deleted.

## Firn 0.6.1

**Firn on a Mac now keeps itself up to date.**

Updates now reach Macs the way they already reach Windows: quietly in the background, ready the next time you open Firn.

### Fixed

- **Automatic updates on a Mac.** Firn on a Mac wasn't finding new versions. From this one on, it updates itself like it does on Windows (when it's in your Applications folder).

## Firn 0.6.0

**Learn Firn's keyboard shortcuts.**

Settings now has a page that lists every keyboard shortcut, grouped and in plain words, for anyone who likes to keep their hands on the keys.

### New

- **Keyboard shortcuts** in Settings, also from the command bar (type "shortcuts"). On a Mac it shows ⌘ where Windows shows Ctrl.

### Fixed

- **Long hover labels** now end neatly after two lines, instead of a third line peeking out at the bottom.

## Firn 0.5.0

**Drag a tab onto the page to see two side by side.**

Pick up any tab and pull it out over the page: the page makes room, and when you let go, the two sit side by side. It works with pinned tabs and Basecamp too, which stay right where they are.

### New

- **Drag a tab into split view.** The tab stays under your pointer as you carry it, and the page shows where it will open. Let go on the left or the right half, or go back to the sidebar to change your mind.
- **Swap sides, or take one out.** Rest your pointer near the top of a page in split view and a small handle appears. Drag it to the other side to swap the two, or click its × to take that page out of split view (the tab stays in your sidebar).

### Better

- **Tabs open when you let go** of the click, so you can pick one up to move it without switching to it.
- **Works with the sidebar hidden**, too: bring it out at the left edge and drag from there.

## Firn 0.4.0

**See what's playing, and pause it from anywhere.**

Tabs that play sound now show a small speaker, so you always know where that music or video is coming from. And when it's playing in a tab you can't see, a little player at the bottom of the sidebar lets you pause it without going looking.

### New

- **A speaker on tabs playing sound.** Click it to mute the tab, and again to turn the sound back on. You'll also find Mute tab in the tab's right-click menu.
- **A mini player** appears above the Firn button while a tab you can't see is playing, even in another space. Pause or play it right there, or click it to go to the tab.

## Firn 0.3.1

**Little labels, in Firn's own style.**

The small labels that appear when you rest the pointer on a button now look like the rest of Firn: soft, rounded, and calm, instead of the system's plain boxes.

### Better

- **Hover labels** fade in gently below buttons, tiles, and tabs, in the sidebar and the top bar.
- **Tabs** only show their label when the name is cut off, so nothing repeats what you can already read.

## Firn 0.3.0

**Make Firn your default browser.**

Links you click in other apps, like mail and chat, can now open in Firn, as new tabs in your usual window.

### New

- **Make Firn default** in Settings, or while setting up Firn. On Windows it opens the system's Default apps settings, where you choose Firn; on a Mac, your Mac asks you to confirm.
- **Links from other apps** open as new tabs in Firn, and start Firn if it isn't open.

## Firn 0.2.0

**Firn now blocks ads and trackers.**

Pages are calmer and faster, and fewer companies can follow you from site to site. It's on from the start, using the same public block lists as popular ad blockers, and it all happens on your computer.

### New

- **Ads and trackers are blocked** on every site.
- **If a site doesn't work right,** right-click the page and choose **Allow ads on this site**.
- **Turn it off** anytime in Settings.

## Firn 0.1.2

**Safer under the hood.**

Firn now runs on the newest version of its Chrome engine, with the latest security fixes.

### Better

- **Security fixes** from the Chrome engine Firn is built on.
- **Text and buttons** are a little easier to read.

## Firn 0.1.1

**Updates now tell you what's new.**

The first time Firn opens after an update, a short note shows what changed, in plain words. You can read it again anytime.

### New

- **What's new** appears once after each update, and anytime from the Firn menu or the command bar.

## Firn 0.1.0

**Meet Firn, a calm browser for everyone.**

Firn keeps your tabs in a quiet sidebar and lets the page be the star. It's built on the same engine as Chrome, so the web works as you'd expect, just calmer.

- **Spaces** keep work, home, and anything else apart, each with its own color.
- **Basecamp** holds your everyday sites, one click away.
- **Lookout** previews a link without leaving your page.
- **Split view** puts two tabs side by side.
- **Private by default:** no tracking. Your passwords and history stay on your computer.
- **Keeps itself up to date** on Windows and Mac.

For Windows and Mac.
