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
 *   - sitemap URLs whose page is missing, not self-canonical, or noindex;
 *   - JSON-LD that doesn't parse;
 *   - a missing/empty <title> or meta description, or a missing og:image
 *     (and the image file itself must exist in dist/);
 *   - internal links that resolve to nothing: a root-relative href with no
 *     built page or asset behind it, or a #fragment that matches no id on
 *     the target page.
 *
 * "Private mode" (the SEARCH_INDEXING switch) is detected from dist/robots.txt:
 * when the site is a blanket Disallow, every page is intentionally noindex and
 * the noindex-vs-sitemap check is relaxed to the switch-independent invariants.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
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
    return name.endsWith('.html') ? [p] : [];
  });
}

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

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
  if (!/^https:\/\//.test(canonical)) err(urlPath, `canonical not absolute: ${canonical}`);
  if (canonical !== 'https://' + new URL(canonical).host + '/' && canonical.endsWith('/'))
    err(urlPath, `canonical has trailing slash: ${canonical}`);
  site ??= new URL(canonical).origin;
  if (!canonical.startsWith(site)) err(urlPath, `canonical off-site: ${canonical}`);

  const alternates = Object.fromEntries(
    [...html.matchAll(/<link rel="alternate" hreflang="[^"]*"[^>]*>/g)].map((m) => [
      attr(m[0], 'hreflang'),
      attr(m[0], 'href'),
    ]),
  );

  for (const [, block] of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(block);
    } catch {
      err(urlPath, 'JSON-LD does not parse');
    }
  }

  if (!/<title>[^<]+<\/title>/.test(html)) err(urlPath, 'missing or empty <title>');
  if (!attr(html.match(/<meta name="description"[^>]*>/)?.[0] ?? '', 'content'))
    err(urlPath, 'missing or empty meta description');
  const ogImage = attr(html.match(/<meta property="og:image"[^>]*>/)?.[0] ?? '', 'content');
  if (!ogImage) err(urlPath, 'missing og:image');

  pages.set(urlPath, {
    urlPath,
    canonical,
    selfCanonical: canonical === site + (urlPath === '/' ? '/' : urlPath),
    alternates,
    noindex: /<meta name="robots" content="noindex">/.test(html),
    ogImage,
    ids: new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])),
    // Root-relative internal links (skip protocol/mailto/anchor-only).
    links: [...html.matchAll(/ href="(\/[^"]*)"/g)].map((m) => m[1]),
  });
}

// ---- Cross-page invariants ---------------------------------------------------
for (const page of pages.values()) {
  const langs = Object.keys(page.alternates);
  if (langs.length > 0) {
    // Alternates only belong on self-canonical pages.
    if (!page.selfCanonical) err(page.urlPath, 'declares hreflang but canonicalizes elsewhere');
    for (const [lang, href] of Object.entries(page.alternates)) {
      if (lang === 'x-default') continue;
      const targetPath = new URL(href).pathname === '/' ? '/' : new URL(href).pathname.replace(/\/$/, '');
      const target = pages.get(targetPath);
      if (!target) {
        err(page.urlPath, `hreflang ${lang} points to missing page ${targetPath}`);
      } else if (targetPath !== page.urlPath) {
        // Reciprocity: the twin must declare the same pair back.
        const back = Object.values(target.alternates).map((h) => new URL(h).pathname.replace(/\/$/, '') || '/');
        if (!back.includes(page.urlPath))
          err(page.urlPath, `hreflang not reciprocated by ${targetPath}`);
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

// ---- Sitemap invariants ------------------------------------------------------
const sitemapIndex = readFileSync(join(DIST, 'sitemap-index.xml'), 'utf8');
const parts = [...sitemapIndex.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
let sitemapUrls = 0;
for (const part of parts) {
  const xml = readFileSync(join(DIST, new URL(part).pathname), 'utf8');
  for (const [, loc] of xml.matchAll(/<url><loc>([^<]+)<\/loc>/g)) {
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
  }
}

// ---- Report ------------------------------------------------------------------
if (errors.length > 0) {
  console.error(`✗ check-seo: ${errors.length} problem(s) across ${pages.size} pages:\n`);
  console.error(errors.slice(0, 50).join('\n'));
  if (errors.length > 50) console.error(`  … and ${errors.length - 50} more`);
  process.exit(1);
}
console.log(
  `✓ check-seo: ${pages.size} pages OK — canonicals, hreflang reciprocity, ` +
    `JSON-LD, og:image, ${sitemapUrls} sitemap URLs self-canonical` +
    (privateMode ? ' (private mode: site-wide noindex expected)' : ''),
);
