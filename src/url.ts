// Turns whatever was typed in the address bar into a URL to load.

// The search engines to choose from in settings (DuckDuckGo by default:
// it doesn't track you).
// `suggest`: where the engine offers suggestions as you type (only asked
// with "Search suggestions" on; see suggestSearches in src/main.ts). Each
// answers in the OpenSearch shape: ["what was typed", ["suggestion", …]].
export const SEARCH_ENGINES = {
  duckduckgo: {
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q=',
    suggest: 'https://duckduckgo.com/ac/?type=list&q=',
  },
  google: {
    name: 'Google',
    url: 'https://www.google.com/search?q=',
    suggest:
      'https://suggestqueries.google.com/complete/search?client=firefox&q=',
  },
  bing: {
    name: 'Bing',
    url: 'https://www.bing.com/search?q=',
    suggest: 'https://api.bing.com/osjson.aspx?query=',
  },
  ecosia: {
    name: 'Ecosia',
    url: 'https://www.ecosia.org/search?q=',
    suggest: 'https://ac.ecosia.org/autocomplete?type=list&q=',
  },
  startpage: {
    name: 'Startpage',
    url: 'https://www.startpage.com/do/search?q=',
    suggest: 'https://www.startpage.com/suggestions?format=opensearch&q=',
  },
} as const;
export type SearchEngine = keyof typeof SEARCH_ENGINES;

let SEARCH_URL: string = SEARCH_ENGINES.duckduckgo.url;

// Which engine searches use (see src/settings.ts).
export function setSearchEngine(engine: SearchEngine) {
  SEARCH_URL = SEARCH_ENGINES[engine]?.url ?? SEARCH_ENGINES.duckduckgo.url;
}

const ALLOWED_SCHEMES = /^(https?|file|about|view-source):/i;

// Whether typed text will run a search or open an address.
export function isSearch(url: string): boolean {
  return Object.values(SEARCH_ENGINES).some((e) => url.startsWith(e.url));
}

// A web search for `text`.
export function searchUrl(text: string): string {
  return SEARCH_URL + encodeURIComponent(text.trim());
}

export function toNavigableUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  // Already a full URL, e.g. "https://example.com".
  if (ALLOWED_SCHEMES.test(text)) return text;

  // Looks like an address, e.g. "example.com/page" or "localhost:3000".
  const looksLikeHost =
    !/\s/.test(text) &&
    (/^[^/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(text) ||
      /^localhost(:\d+)?(\/.*)?$/i.test(text) ||
      /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text));
  if (looksLikeHost) {
    const local = /^(localhost|127\.|\d{1,3}(\.\d{1,3}){3})/i.test(text);
    return `${local ? 'http' : 'https'}://${text}`;
  }

  // Anything else is a search.
  return SEARCH_URL + encodeURIComponent(text);
}
