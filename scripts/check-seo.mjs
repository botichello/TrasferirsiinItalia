#!/usr/bin/env node
/**
 * SEO regression gate — runs over dist/ after every build (npm run build),
 * so the findability plumbing gets the same mechanical enforcement as the
 * citability contract. It fails the build on:
 *
 *   - a page without exactly one canonical, or a canonical that is off-site,
 *     relative, or trailing-slashed;
 *   - hreflang pairs that don't reciprocate (A declares B but B doesn't
 *     declare A), or alternates declared on a page that canonicalizes
 *     elsewhere (those must stay silent);
 *   - sitemap URLs whose page is missing, not self-canonical, or noindex, or
 *     whose <lastmod> disagrees with the verification date the page states;
 *   - JSON-LD that doesn't parse;
 *   - a missing/empty <title> or meta description, or a missing og:image
 *     (and the image file itself must exist in dist/);
 *   - on indexable pages, a <title> past the length a result snippet shows, a
 *     title shared with another indexable page, or a meta description outside
 *     the length a snippet shows / disagreeing with og: and twitter:;
 *   - internal links that resolve to nothing: a root-relative href with no
 *     built page or asset behind it, or a #fragment that matches no id on
 *     the target page;
 *   - an indexable page missing the crawler directives that opt an EU
 *     publisher out of shortened snippets and thumbnail previews;
 *   - JSON-LD split across blocks, a node with no @id, a duplicate @id, or an
 *     @id pointer that resolves to no node in the same graph;
 *   - llms.txt / llms-full.txt / updates.xml pointing at a URL that does not
 *     exist, or omitting a guide or orientation page that does;
 *   - a source cited on any page but missing from the /sources index, which
 *     claims to list every one.
 *
 * "Private mode" (the SEARCH_INDEXING switch) is detected from dist/robots.txt:
 * when the site is a blanket Disallow, every page is intentionally noindex and
 * the noindex-vs-sitemap check is relaxed to the switch-independent invariants.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Defaults to dist/; overridable so scripts/test-gates.mjs can run this gate
// against a deliberately broken copy of the build and assert each rule fires.
const DIST = process.env.CHECK_SEO_DIST ?? new URL('../dist/', import.meta.url).pathname;
const errors = [];
const err = (page, msg) => errors.push(`  ${page}: ${msg}`);

if (!existsSync(DIST)) {
  console.error('check-seo: dist/ not found — run the build first.');
  process.exit(1);
}

const privateMode = /^Disallow: \/$/m.test(readFileSync(join(DIST, 'robots.txt'), 'utf8'));

/** Recursively collect all built HTML pages. */
function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    // Search-engine verification tokens (e.g. googleXXXX.html) are not pages.
    if (/^google[0-9a-f]+\.html$/.test(name)) return [];
    return name.endsWith('.html') ? [p] : [];
  });
}

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

/** Length limits are about what a person sees, so measure decoded text: the
 *  serialized `Italy&#39;s` is 11 characters of HTML and 8 of title. */
const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e],
    );

// ---- Parse every page once -------------------------------------------------
const pages = new Map(); // canonical-path key ("/about") -> page record
let site;

for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  const rel = '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
  const urlPath = rel === '/' || rel === '' ? '/' : rel;

  const canonicals = [...html.matchAll(/<link rel="canonical"[^>]*>/g)].map((m) => m[0]);
  if (canonicals.length !== 1) {
    err(urlPath, `${canonicals.length} canonical tags (want exactly 1)`);
    continue;
  }
  const canonical = attr(canonicals[0], 'href') ?? '';
  // The checks below parse the canonical as a URL, so a relative one has to
  // stop here: previously `new URL('/')` threw and the gate died with a stack
  // trace instead of reporting the problem it had just detected (test-gates).
  const absolute = /^https:\/\//.test(canonical);
  if (!absolute) {
    err(urlPath, `canonical not absolute: ${canonical}`);
  } else {
    if (canonical !== 'https://' + new URL(canonical).host + '/' && canonical.endsWith('/'))
      err(urlPath, `canonical has trailing slash: ${canonical}`);
    site ??= new URL(canonical).origin;
    if (!canonical.startsWith(site)) err(urlPath, `canonical off-site: ${canonical}`);
  }

  const alternates = Object.fromEntries(
    [...html.matchAll(/<link rel="alternate" hreflang="[^"]*"[^>]*>/g)].map((m) => [
      attr(m[0], 'hreflang'),
      attr(m[0], 'href'),
    ]),
  );

  const schemaNodes = [];
  const schemaBlocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  // One script, one @graph. Split across several blocks, the nodes cannot
  // reference each other by @id and a consumer has to guess how they relate.
  if (schemaBlocks.length > 1)
    err(urlPath, `${schemaBlocks.length} JSON-LD blocks (want 1 holding a single @graph)`);
  for (const [, block] of schemaBlocks) {
    try {
      const parsed = JSON.parse(block);
      schemaNodes.push(...(parsed['@graph'] ?? [parsed]));
    } catch {
      err(urlPath, 'JSON-LD does not parse');
    }
  }

  if (!/<title>[^<]+<\/title>/.test(html)) err(urlPath, 'missing or empty <title>');
  if (!attr(html.match(/<meta name="description"[^>]*>/)?.[0] ?? '', 'content'))
    err(urlPath, 'missing or empty meta description');
  const metaDescription = attr(html.match(/<meta name="description"[^>]*>/)?.[0] ?? '', 'content') ?? '';
  const ogDescription = attr(html.match(/<meta property="og:description"[^>]*>/)?.[0] ?? '', 'content') ?? '';
  const twitterDescription = attr(html.match(/<meta name="twitter:description"[^>]*>/)?.[0] ?? '', 'content') ?? '';
  const ogImage = attr(html.match(/<meta property="og:image"[^>]*>/)?.[0] ?? '', 'content');
  if (!ogImage) err(urlPath, 'missing og:image');
  // Vercel Web Analytics is emitted by BaseLayout, so it should be on every
  // page; a page that renders without the layout would silently go unmeasured.
  if (!html.includes('<vercel-analytics')) err(urlPath, 'missing Vercel Analytics element');

  pages.set(urlPath, {
    urlPath,
    title: decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
    canonical,
    selfCanonical: canonical === site + (urlPath === '/' ? '/' : urlPath),
    alternates,
    description: decodeEntities(metaDescription),
    ogDescription: decodeEntities(ogDescription),
    twitterDescription: decodeEntities(twitterDescription),
    robots: attr(html.match(/<meta name="robots"[^>]*>/)?.[0] ?? '', 'content') ?? '',
    noindex: /<meta name="robots" content="noindex[^"]*">/.test(html),
    // The date the page itself claims to have been verified (FreshnessBadge).
    // Pages print other dates too — a source's `accessed`, the verification
    // history — so this is the marked one, not merely the first.
    verified: html.match(/data-verified="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? null,
    ogImage,
    schemaNodes,
    // Kept as a list as well as a set: the set answers "does #anchor exist",
    // the list is the only place a *duplicate* id is still visible.
    idList: [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]),
    ids: new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])),
    // Root-relative internal links (skip protocol/mailto/anchor-only).
    links: [...html.matchAll(/ href="(\/[^"]*)"/g)].map((m) => m[1]),
    // External links inside the page's own "Sources" / "Fonti" section, for the
    // /sources completeness check below. Captured here rather than re-read
    // later: the file path is known now, and deriving it back from the URL key
    // gets /404 wrong (it is 404.html, not 404/index.html).
    sourceLinks: (() => {
      // `data-sources` is emitted by the two components that render a citation
      // list (SourceList for guides, PageSources for orientation pages). It
      // replaced an anchor on the visible "Sources"/"Fonti" heading, which was
      // all there was to grab when the orientation markup existed in 32 copies.
      const at = html.indexOf('data-sources>');
      if (at === -1) return [];
      const section = html.slice(at, html.indexOf('</section>', at) + 1);
      return [...section.matchAll(/href="(https?:\/\/[^"]+)"/g)]
        .map((m) => m[1])
        .filter((href) => !href.startsWith('https://web.archive.org/')); // the archived copy, not the citation
    })(),
  });
}

// A gate that scanned almost nothing must fail, not pass: an empty or
// half-written dist/, a wrong env override, or a moved output directory would
// otherwise turn every rule below into silent false comfort. The floor sits far
// under the real size (~1,600 pages), so it only fires on broken input.
if (pages.size < 500) {
  console.error(`✗ check-seo: only ${pages.size} page(s) found under ${DIST} — dist/ is empty or wrong.`);
  process.exit(1);
}

// ---- Cross-page invariants ---------------------------------------------------
const ALLOWED_HREFLANG = new Set(['en', 'it', 'x-default']);
/** Canonical string form of an hreflang map, for comparing the two twins. */
const hreflangSet = (map) =>
  Object.entries(map)
    .map(([lang, href]) => `${lang}=${new URL(href).pathname.replace(/\/$/, '') || '/'}`)
    .sort()
    .join(',');

for (const page of pages.values()) {
  const langs = Object.keys(page.alternates);
  if (langs.length > 0) {
    // Alternates only belong on self-canonical pages.
    if (!page.selfCanonical) err(page.urlPath, 'declares hreflang but canonicalizes elsewhere');
    for (const [lang, href] of Object.entries(page.alternates)) {
      // The site is bilingual EN/IT: any other code is a typo, and a typo'd
      // code is invisible to a URL-only reciprocity test (found by test-gates).
      if (!ALLOWED_HREFLANG.has(lang)) err(page.urlPath, `unexpected hreflang code: ${lang}`);
      if (lang === 'x-default') continue;
      const targetPath = new URL(href).pathname === '/' ? '/' : new URL(href).pathname.replace(/\/$/, '');
      const target = pages.get(targetPath);
      if (!target) {
        err(page.urlPath, `hreflang ${lang} points to missing page ${targetPath}`);
      } else if (targetPath !== page.urlPath) {
        // Reciprocity, by lang→URL pair rather than URL alone: both twins must
        // advertise the identical hreflang set, which is what BaseLayout emits.
        if (hreflangSet(target.alternates) !== hreflangSet(page.alternates))
          err(
            page.urlPath,
            `hreflang set not reciprocated by ${targetPath} ` +
              `(${hreflangSet(page.alternates)} vs ${hreflangSet(target.alternates)})`,
          );
      }
    }
  }
}

// og:image files must exist.
for (const page of pages.values()) {
  if (page.ogImage?.startsWith(site)) {
    const imgPath = join(DIST, new URL(page.ogImage).pathname);
    if (!existsSync(imgPath)) {
      err(page.urlPath, `og:image file missing from dist: ${page.ogImage}`);
      break; // same default image everywhere — one report is enough
    }
  }
}

// ---- Titles --------------------------------------------------------------
// Only pages that can actually appear in a result list are held to this: a page
// that canonicalizes elsewhere never shows its own title, and a noindex page
// never shows at all. On the ones that do appear, the title must fit the
// snippet and must not be shared with another page.
//
// It exists because the title read `Registering your residency (anagrafe) —
// Bolzano · Trentino-Alto Adige · Trasferirsi in Italia` — 93 characters, of
// which the first 37 were identical across every city, so the part a searcher
// was looking for sat exactly where the snippet stops.
const MAX_TITLE = 60;
const indexable = [...pages.values()].filter((p) => p.selfCanonical && !p.noindex);
const titleOwners = new Map();
for (const page of indexable) {
  if (page.title.length > MAX_TITLE)
    err(page.urlPath, `title is ${page.title.length} chars (max ${MAX_TITLE}): ${page.title}`);
  titleOwners.set(page.title, [...(titleOwners.get(page.title) ?? []), page.urlPath]);
}
for (const [title, owners] of titleOwners) {
  if (owners.length > 1)
    errors.push(`  ${owners.slice(0, 3).join(', ')}${owners.length > 3 ? ', …' : ''}: ${owners.length} indexable pages share the title "${title}"`);
}

// ---- Structured-data graph integrity --------------------------------------
// Every top-level node must be addressable, ids must be unique within a page,
// and every `{"@id": …}` pointer must land on a node that is actually in the
// same graph. A pointer into nothing is the failure mode that matters: the
// JSON still parses, every validator that only checks syntax still passes, and
// the consumer silently loses the link between the page and its publisher.
for (const page of pages.values()) {
  const declared = new Set();
  for (const node of page.schemaNodes) {
    const id = node['@id'];
    if (!id) {
      err(page.urlPath, `JSON-LD node of type ${node['@type']} has no @id`);
      continue;
    }
    if (declared.has(id)) err(page.urlPath, `duplicate JSON-LD @id: ${id}`);
    declared.add(id);
  }
  // A reference is an object whose only key is @id; anything else is a node.
  const dangling = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '@id') {
      if (!declared.has(value['@id'])) dangling.add(value['@id']);
      return;
    }
    Object.values(value).forEach(walk);
  };
  walk(page.schemaNodes);
  for (const id of dangling) err(page.urlPath, `JSON-LD @id reference resolves to no node: ${id}`);

  // The structured date and the printed date are the same claim in two formats.
  // A reader sees one, a crawler reads the other, and only a gate ever sees
  // both — so this is the only place the two can be held together.
  if (page.verified) {
    for (const node of page.schemaNodes) {
      if (node.dateModified && node.dateModified !== page.verified)
        err(
          page.urlPath,
          `${node['@type']} dateModified ${node.dateModified} != the date the page prints (${page.verified})`,
        );
    }
  }
}

// ---- Crawler directives ---------------------------------------------------
// Google's defaults are not neutral for an EU publisher: without an explicit
// opt-in it shows a shortened snippet and a thumbnail preview. Both are wrong
// for pages whose value is one specific dated fact, so the opt-in is asserted
// rather than assumed. A `noindex` page must still say `follow`, or the crawler
// eventually stops following links out of a page that exists to lead onward.
const REQUIRED_DIRECTIVES = ['max-image-preview:large', 'max-snippet:-1'];
if (!privateMode) {
  for (const page of pages.values()) {
    if (page.noindex) {
      if (!/\bfollow\b/.test(page.robots))
        err(page.urlPath, `noindex page does not say follow: robots="${page.robots}"`);
      continue;
    }
    if (!page.selfCanonical) continue;
    for (const directive of REQUIRED_DIRECTIVES) {
      if (!page.robots.includes(directive))
        err(page.urlPath, `robots meta missing ${directive}: robots="${page.robots}"`);
    }
  }
}

// ---- Meta descriptions -----------------------------------------------------
// A snippet Google decides not to rewrite is shown to about 155-160 characters;
// past that the tail is dropped, which is why the last clause of 187 of these
// pages used to be written for nobody. The floor is here for the opposite
// failure — a description too thin to say what the page is — and the three
// copies must agree, because a page that says one thing in search results and
// another when shared is describing itself twice.
//
// Guides keep a separate `metaDescription` in frontmatter: the visible lede is
// written for a reader who has already arrived, and squeezing both jobs into
// one string makes one of them worse.
const MIN_DESCRIPTION = 70;
const MAX_DESCRIPTION = 160;
for (const page of indexable) {
  const len = page.description.length;
  if (len < MIN_DESCRIPTION || len > MAX_DESCRIPTION)
    err(page.urlPath, `meta description is ${len} chars (want ${MIN_DESCRIPTION}-${MAX_DESCRIPTION}): ${page.description}`);
  if (page.ogDescription !== page.description)
    err(page.urlPath, 'og:description differs from meta description');
  if (page.twitterDescription !== page.description)
    err(page.urlPath, 'twitter:description differs from meta description');
}

// ---- Duplicate ids ------------------------------------------------------
// An id must be unique per document. Two entries sharing one made
// /glossary#conto-di-base ambiguous: the browser jumps to whichever came first,
// and the guide term-chips deep-linking to it could not say which definition
// they meant. axe does not flag this (the duplicate-id rule was retired for
// non-ARIA ids), and nothing else looked.
for (const [urlPath, p] of pages) {
  const seen = new Set();
  const dupes = new Set();
  for (const id of p.idList) (seen.has(id) ? dupes : seen).add(id);
  if (dupes.size > 0)
    errors.push(`${urlPath}: duplicate id(s) — ${[...dupes].sort().join(', ')}`);
}

// ---- Internal links ------------------------------------------------------
// Every root-relative link must land on a built page or asset, and a
// #fragment must match an id on the target page. Deduplicate identical
// (page-template) errors by reporting each broken href once.
const seenLink = new Set();
for (const page of pages.values()) {
  for (const raw of page.links) {
    const [pathPart, fragment] = raw.split('#');
    const path = pathPart === '' ? page.urlPath : pathPart.replace(/\/$/, '') || '/';
    const key = `${path}#${fragment ?? ''}`;
    if (seenLink.has(key)) continue;
    const target = pages.get(path);
    if (!target) {
      // Not a page — accept real files in dist (assets, txt/xml/json routes).
      if (!existsSync(join(DIST, path))) {
        seenLink.add(key);
        err(page.urlPath, `internal link to nothing: ${raw}`);
      }
      continue;
    }
    if (fragment && !target.ids.has(fragment)) {
      seenLink.add(key);
      err(page.urlPath, `broken fragment: ${raw} (no id="${fragment}" on ${path})`);
    }
  }
}

// ---- Orientation-page structured data ----------------------------------------
// Every registered orientation page (both languages) must emit an Article whose
// dateModified equals the registry's lastVerified — the same date the page
// prints and check-freshness asserts — plus a BreadcrumbList. Without this the
// schema could silently disappear or drift from the visible date.
const { orientationPages, orientationUrl } = await import(
  new URL('../src/data/orientation-pages.mjs', import.meta.url)
);
let orientationChecked = 0;
for (const entry of orientationPages) {
  const enPath = orientationUrl(entry);
  for (const urlPath of [enPath, `/it${enPath}`]) {
    const page = pages.get(urlPath);
    if (!page) {
      err(urlPath, 'registered orientation page was not built');
      continue;
    }
    orientationChecked++;
    if (!page.schemaNodes.some((n) => n['@type'] === 'Article'))
      err(urlPath, 'orientation page missing Article JSON-LD');
    // Every dated node, not just the Article: the graph now carries the date on
    // the WebPage as well, and a rule that checks one node while another drifts
    // is the kind of half-cover this suite exists to prevent.
    for (const node of page.schemaNodes) {
      if (node.dateModified && node.dateModified !== entry.lastVerified)
        err(
          urlPath,
          `${node['@type']} dateModified ${node.dateModified} != registry lastVerified ${entry.lastVerified}`,
        );
    }
    if (!page.schemaNodes.some((n) => n['@type'] === 'BreadcrumbList'))
      err(urlPath, 'orientation page missing BreadcrumbList JSON-LD');
  }
}

// ---- Sitemap invariants ------------------------------------------------------
const sitemapIndex = readFileSync(join(DIST, 'sitemap-index.xml'), 'utf8');
const parts = [...sitemapIndex.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
// A crawler schedules its next visit from <lastmod>, and Google only honours it
// while it stays consistent with the page. So every URL that can be dated must
// carry one, it must equal the date the page states, and a URL the site cannot
// date must not invent one. Dates come from two places: content pages mark
// theirs in the HTML (`data-verified`), orientation pages keep theirs in the
// registry. This is what caught the sitemap going out with a freshness signal
// on 166 of its 218 URLs and nothing on the other 52.
const orientationLastVerified = new Map();
for (const entry of orientationPages) {
  const p = orientationUrl(entry);
  orientationLastVerified.set(p, entry.lastVerified);
  orientationLastVerified.set(`/it${p}`, entry.lastVerified);
}

let sitemapUrls = 0;
let datedUrls = 0;
for (const part of parts) {
  const xml = readFileSync(join(DIST, new URL(part).pathname), 'utf8');
  for (const [, loc, body] of xml.matchAll(/<url><loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)) {
    sitemapUrls++;
    const p = new URL(loc).pathname === '/' ? '/' : new URL(loc).pathname.replace(/\/$/, '');
    const page = pages.get(p);
    if (!page) err(p, 'in sitemap but no page built');
    else {
      if (!page.selfCanonical) err(p, 'in sitemap but canonicalizes elsewhere');
      // In private mode every page is noindex by design; outside it, a
      // noindexed page must not be advertised in the sitemap.
      if (!privateMode && page.noindex) err(p, 'in sitemap but noindex');
    }
    const lastmod = body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.slice(0, 10) ?? null;
    const expected = page?.verified ?? orientationLastVerified.get(p) ?? null;
    if (expected) {
      datedUrls++;
      if (!lastmod) err(p, `page is verified ${expected} but the sitemap gives it no <lastmod>`);
      else if (lastmod !== expected)
        err(p, `sitemap <lastmod> ${lastmod} != the date the page states (${expected})`);
    } else if (lastmod) {
      err(p, `sitemap <lastmod> ${lastmod} but the page states no verification date`);
    }
  }
}

// ---- /sources completeness --------------------------------------------------
// /sources says "every one is listed here". That sentence is a claim about the
// site, so it gets checked like one. Citations live in three places — the
// content collections, the `sources` arrays inside the orientation pages, and
// the source-country notes — and an index built from only the first was missing
// 126 URLs while still making the claim. check-links had already been bitten by
// exactly this and fixed; the audit page had not.
//
// Anchored on the `data-sources` attribute the two citation components emit,
// with a floor underneath: if that attribute is ever dropped the count
// collapses and this fails loudly instead of quietly checking nothing.
const sourcesIndex = { '': null, '/it': null };
for (const locale of ['', '/it']) {
  const page = pages.get(`${locale}/sources`);
  if (!page) errors.push(`  ${locale}/sources: not built`);
  else sourcesIndex[locale] = readFileSync(join(DIST, `${locale}/sources/index.html`), 'utf8');
}

let pagesWithSources = 0;
const missingFromIndex = new Map(); // url -> first page that cites it
for (const [urlPath, page] of pages) {
  if (/\/sources$/.test(urlPath)) continue;
  if (page.sourceLinks.length === 0) continue;
  pagesWithSources++;
  const index = sourcesIndex[urlPath.startsWith('/it/') || urlPath === '/it' ? '/it' : ''];
  if (!index) continue;
  for (const href of page.sourceLinks)
    if (!index.includes(href) && !missingFromIndex.has(href)) missingFromIndex.set(href, urlPath);
}
if (pagesWithSources < 200) {
  console.error(
    `✗ check-seo: only ${pagesWithSources} page(s) carry a data-sources section — the hook this scan anchors on has gone.`,
  );
  process.exit(1);
}
for (const [href, from] of missingFromIndex)
  errors.push(`  /sources: does not list ${href} (cited by ${from})`);

// ---- Machine-readable surfaces ---------------------------------------------
// llms.txt, llms-full.txt and the RSS feed are the site's other front doors,
// and unlike the sitemap they are hand-composed prose: a new orientation page
// enters the sitemap automatically and llms.txt not at all. So both directions
// are asserted — nothing listed may 404, and nothing indexable may be missing
// from the list an assistant reads instead of crawling.
const surfaces = ['llms.txt', 'llms-full.txt', 'updates.xml'];
let surfaceUrls = 0;
const llms = existsSync(join(DIST, 'llms.txt')) ? readFileSync(join(DIST, 'llms.txt'), 'utf8') : '';

for (const name of surfaces) {
  const file = join(DIST, name);
  if (!existsSync(file)) {
    errors.push(`  /${name}: not built`);
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const seen = new Set();
  for (const [, href] of text.matchAll(new RegExp(`${site}([^\\s)<>"]*)`, 'g'))) {
    const p = href.replace(/[.,;]+$/, '').replace(/\/$/, '') || '/';
    if (seen.has(p)) continue;
    seen.add(p);
    surfaceUrls++;
    if (!pages.has(p) && !existsSync(join(DIST, p)))
      errors.push(`  /${name}: links to nothing: ${site}${p}`);
  }
}

// Everything a reader can reach as a journey step or an orientation page has to
// be in llms.txt. The city and region variants are described there by pattern
// rather than enumerated, which is deliberate — 1,386 URLs would drown it.
const mustBeListed = [
  ...orientationLastVerified.keys(),
  ...[...pages.keys()].filter((p) => /^(\/it)?\/eu-citizens\/residency\/[^/]+$/.test(p)),
].filter((p) => !p.startsWith('/it/') || pages.has(p));
for (const p of mustBeListed) {
  if (!llms.includes(`${site}${p})`) && !llms.includes(`${site}${p} `) && !llms.includes(`${site}${p}\n`))
    errors.push(`  /llms.txt: does not list ${p}`);
}

const rss = existsSync(join(DIST, 'updates.xml')) ? readFileSync(join(DIST, 'updates.xml'), 'utf8') : '';
if (rss && !rss.includes('rel="self"'))
  errors.push('  /updates.xml: no <atom:link rel="self"> — the feed does not state its own address');

// ---- Report ------------------------------------------------------------------
if (errors.length > 0) {
  console.error(`✗ check-seo: ${errors.length} problem(s) across ${pages.size} pages:\n`);
  console.error(errors.slice(0, 50).join('\n'));
  if (errors.length > 50) console.error(`  … and ${errors.length - 50} more`);
  process.exit(1);
}
console.log(
  `✓ check-seo: ${pages.size} pages OK — canonicals, hreflang reciprocity, ` +
    `JSON-LD, og:image, ${indexable.length} indexable titles unique and ≤ ${MAX_TITLE} chars, ` +
    `descriptions ${MIN_DESCRIPTION}-${MAX_DESCRIPTION} chars and identical across og/twitter, ` +
    `${orientationChecked} orientation schemas, ` +
    `${sitemapUrls} sitemap URLs self-canonical (${datedUrls} with a <lastmod> matching the page), ` +
    `${surfaceUrls} links across llms.txt/llms-full.txt/updates.xml, ` +
    `every citation on ${pagesWithSources} pages present on /sources` +
    (privateMode ? ' (private mode: site-wide noindex expected)' : ''),
);
