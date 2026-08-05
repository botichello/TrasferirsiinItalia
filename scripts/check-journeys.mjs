#!/usr/bin/env node
/**
 * Journey gate: can a *human* actually get there?
 *
 * Every other gate checks what a page contains. None checked whether a reader
 * can reach it. That gap let /from/united-states ship reachable only from the
 * footer — correct canonicals, valid schema, in the sitemap, in llms.txt, link-
 * checked, and effectively invisible to a person. Machine discoverability was
 * thoroughly instrumented; human discoverability was not instrumented at all.
 *
 * So this walks the site the way a reader does: links inside <main> only,
 * ignoring the header and footer chrome that appears on every page and would
 * make everything trivially "reachable". It then asserts
 *
 *   1. no orphans   — every page is reachable from its OWN locale's homepage,
 *                     which is what catches an Italian page linked only from
 *                     the English tree, and
 *   2. no dead ends — every page offers at least one onward link, so a reader
 *                     is never stranded.
 *
 * Fragments count as reaching the base page (a reader does land there), but a
 * page reachable ONLY via a fragment link is reported, because it usually means
 * nothing links to the page as a destination in its own right.
 *
 * Usage: node scripts/check-journeys.mjs   (needs a completed build in dist/)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = process.env.CHECK_JOURNEYS_DIST ?? fileURLToPath(new URL('../dist/', import.meta.url));

if (!existsSync(DIST)) {
  console.error('check-journeys: dist/ not found — run the build first.');
  process.exit(1);
}

/**
 * Pages a reader can only reach from the header or footer, by design. Each needs
 * a reason: the point is to make "nav-only" a deliberate decision rather than an
 * accident nobody noticed.
 */
const NAV_ONLY = new Map([
  ['/search', 'search UI, reached from the header on every page; deliberately noindex'],
  ['/it/search', 'as /search'],
]);
/** Pages that are not part of any journey. */
const NOT_A_PAGE = new Set(['/404.html']);
/** Pages with no onward links by design. */
const DEAD_END_OK = new Map([
  ['/search', 'results are generated client-side'],
  ['/it/search', 'as /search'],
  ['/404.html', 'error page; its links live in the layout chrome'],
]);

const errors = [];
const warnings = [];

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    if (/^google[0-9a-f]+\.html$/.test(name)) return [];
    return name.endsWith('.html') ? [p] : [];
  });
}

const urlOf = (file) => {
  const rel = '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\/+$/, '');
  return rel === '' ? '/' : rel;
};
const normalize = (href) => {
  const path = href.split('#')[0].split('?')[0].replace(/\/+$/, '');
  return path === '' ? '/' : path;
};

// ---- Parse: body links only --------------------------------------------------
const pages = new Map(); // url -> { links:Set, fragmentOnly:Set, isFile:boolean }
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  const body = html.includes('<main') ? html.split('<main')[1].split('</main>')[0] : '';
  const links = new Set();
  // Bare links are tracked separately rather than as "not fragment": a page
  // often links a target both ways (glossary chips point at /glossary#term while
  // the same section links /glossary itself), and a per-page fragment flag would
  // hide the bare link and report a false positive.
  const bare = new Set();
  for (const [, href] of body.matchAll(/href="(\/[^"]*)"/g)) {
    const target = normalize(href);
    links.add(target);
    if (!href.includes('#')) bare.add(target);
  }
  pages.set(urlOf(file), { links, bare });
}

// Same floor logic as the other gates: a walk over a near-empty tree proves
// nothing. Real size is ~1,600 pages.
if (pages.size < 500) {
  console.error(`✗ check-journeys: only ${pages.size} page(s) found under ${DIST} — dist/ is empty or wrong.`);
  process.exit(1);
}

const localeOf = (url) => (url === '/it' || url.startsWith('/it/') ? 'it' : 'en');

/**
 * Reachable set from a root, following body links, staying inside one locale.
 *
 * The confinement matters: a single cross-locale body link would otherwise let
 * the walk hop into the other tree and come back, making every page mutually
 * "reachable" and hiding exactly the asymmetry this is looking for. The question
 * being asked is "can a reader who stays in their own language get here?".
 */
function reach(root, locale) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || !pages.has(cur) || localeOf(cur) !== locale) continue;
    seen.add(cur);
    for (const next of pages.get(cur).links) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

const roots = { en: '/', it: '/it' };
const reachable = { en: reach('/', 'en'), it: reach('/it', 'it') };

// ---- 1. Orphans: unreachable from the page's own locale homepage -------------
for (const url of [...pages.keys()].sort()) {
  if (NOT_A_PAGE.has(url) || NAV_ONLY.has(url)) continue;
  const locale = localeOf(url);
  if (!reachable[locale].has(url)) {
    // Since each walk is confined to its own locale, "reachable in the other
    // tree" is impossible by construction. The signal for an asymmetry is an
    // inbound link that comes from the other language: something does point
    // here, just never from the reader's own side of the site.
    const otherLocale = locale === 'en' ? 'it' : 'en';
    const crossLinked = [...pages].some(
      ([from, page]) => localeOf(from) === otherLocale && page.links.has(url),
    );
    errors.push(
      `${url}: not reachable from ${roots[locale]} by following links in page bodies` +
        (crossLinked ? ` — linked only from the ${otherLocale.toUpperCase()} tree, a locale asymmetry` : ''),
    );
  }
}

// ---- 2. Reachable only through a fragment link -------------------------------
// Nothing links to it as a destination in its own right, which is usually an
// oversight rather than a decision.
for (const url of [...pages.keys()].sort()) {
  if (NOT_A_PAGE.has(url) || NAV_ONLY.has(url)) continue;
  let linkedAtAll = false;
  let linkedBare = false;
  for (const [from, page] of pages) {
    if (from === url) continue;
    if (page.links.has(url)) linkedAtAll = true;
    if (page.bare.has(url)) linkedBare = true;
  }
  if (linkedAtAll && !linkedBare)
    warnings.push(`${url}: linked only via a #fragment, never as a destination`);
}

// ---- 3. Dead ends ------------------------------------------------------------
for (const url of [...pages.keys()].sort()) {
  if (DEAD_END_OK.has(url) || NOT_A_PAGE.has(url)) continue;
  const onward = [...pages.get(url).links].filter((l) => l !== url);
  if (onward.length === 0) errors.push(`${url}: dead end — no onward links in the page body`);
}

for (const w of warnings) console.warn(`⚠️  ${w}`);

if (errors.length > 0) {
  console.error(`\n✗ check-journeys: ${errors.length} problem(s):\n`);
  console.error(errors.slice(0, 40).map((e) => `  ${e}`).join('\n'));
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  process.exit(1);
}
console.log(
  `✓ check-journeys: ${pages.size} pages — all reachable from their own locale's homepage ` +
    `via body links, no dead ends` +
    (warnings.length ? `, ${warnings.length} fragment-only warning(s)` : '') +
    ` (${NAV_ONLY.size} nav-only by design).`,
);
