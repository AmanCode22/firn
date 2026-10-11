// The First light welcome on a fresh profile: hello, the address bar's
// place, the first space, an everyday site, tips, and "Welcome in."
import { floating } from '../lib/director.mjs';

const next = floating('[data-testid="welcome-next"]');

export default {
  name: 'welcome',
  seed: 'welcome',
  async setup(d) {
    await d.waitFor(next, 30_000);
    await d.placeCursor(900, 760);
  },
  async run(d) {
    await d.click(next); // hello
    await d.step();
    await d.click(next); // where the address bar goes
    await d.step();
    await d.still();
    await d.click(next); // your first space
    await d.step();
    await d.click(floating('[data-testid="welcome-site"]', { nth: 0 }));
    await d.step();
    await d.click(next); // everyday sites
    await d.step();
    await d.click(next); // tips: Start browsing
    await d.pause(1200);
    await d.still(); // "Welcome in."
    await d.pause(1600);
  },
};
