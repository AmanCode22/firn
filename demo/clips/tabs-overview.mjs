// Personal space: the pointer runs down the vertical tabs, opens a new tab,
// types "nts", and picks NTS Radio (open in Weekend) from the command
// bar's suggestions, which goes there (not a web search: a search page can
// show ads for other browsers).
import { floating, ui } from '../lib/director.mjs';

const tab = (nth) =>
  ui('[data-testid="tab"][data-kind="everyday"]', { nth, at: [0.4, 0.5] });

export default {
  name: 'tabs-overview',
  seed: 'tabs',
  // Opens on Things.
  start: { space: 'Personal', tab: 2 },
  async setup(d) {
    await d.placeCursor(150, 640);
  },
  async run(d) {
    for (let i = 0; i < 3; i++) {
      await d.hover(tab(i));
      await d.pause(300);
    }
    await d.click(ui('[data-testid="new-tab"]'));
    await d.waitFor(floating('[data-testid="command-input"]'));
    await d.step();
    await d.type(floating('[data-testid="command-input"]'), 'nts');
    await d.step();
    // The first open tab it found (the search row comes first).
    await d.click(floating('[data-testid="command-result"].is-tab'));
    await d.pause(500);
    await d.settle(2500);
    await d.still();
  },
};
