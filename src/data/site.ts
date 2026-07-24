/**
 * Global site switches.
 *
 * SEARCH_INDEXING — the "not ready yet" switch. While false:
 *   - robots.txt disallows all crawling (search engines and AI crawlers alike),
 *   - every page carries <meta name="robots" content="noindex">.
 *
 * When ready to go public: flip to true, deploy, then submit the sitemap in
 * Google Search Console and re-run `npm run submit:indexnow` for Bing & co.
 */
export const SEARCH_INDEXING = true;
