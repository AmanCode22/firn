// Every clip, in the order `npm run demo` records them. To add one, make a
// file like the others and list it here (see demo/README.md).

import basecamp from './basecamp.mjs';
import emptyPage from './empty-page.mjs';
import hero from './hero.mjs';
import lookout from './lookout.mjs';
import spaces from './spaces.mjs';
import splitView from './split-view.mjs';
import tabsOverview from './tabs-overview.mjs';
import welcome from './welcome.mjs';

export const CLIPS = [
  tabsOverview,
  spaces,
  basecamp,
  splitView,
  lookout,
  welcome,
  emptyPage,
  hero,
];
