import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { orientationPages, orientationUrl } from './src/data/orientation-pages.mjs';

// Canonical site URL — pinned to the primary custom domain (www; the bare
// domain and *.vercel.app 308-redirect to it). Deliberately NOT derived from
// VERCEL_PROJECT_PRODUCTION_URL: Vercel picks the *shortest* production domain
// for that variable, which is the bare domain — a redirect, and canonicals
// must never point at a redirect. Override with SITE_URL if the domain moves.
const SITE = process.env.SITE_URL || 'https://www.trasferirsiinitalia.com';

export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  // English is the default (unprefixed) locale; Italian is served under /it/.
  i18n: {
    locales: ['en', 'it'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sitemap({
      filter: canonicalPagesOnly,
      serialize: withLastmod,
      // Emit xhtml:link hreflang alternates for the en/it URL pairs.
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', it: 'it' },
      },
    }),
  ],
});

/**
 * Keep the sitemap to pages that are canonical to themselves. Place pages that
 * consolidate their canonical elsewhere (see the canonical strategy in the
 * city/region routes) and the noindex /search page would only add noise:
 * - /search — client-side search, noindex.
 * - city SSN pages — always canonicalize to the region SSN page.
 * - city/region guide pages without a substantive local overlay — canonicalize
 *   to the national guide. Overlay existence is checked on disk so the sitemap
 *   stays in sync with the content, per locale.
 */
/**
 * Stamp each dated sitemap URL with its `lastVerified` date as <lastmod>, so
 * crawlers prioritize what actually changed. Only the hub pages — which state
 * no verification date of their own — go out without one, and `check:seo`
 * holds every other URL to the date its page displays. The map is built once by
 * scanning frontmatter on disk (the content collections aren't available inside
 * astro.config) plus the orientation registry.
 */
const lastmodByPath = (() => {
  const root = fileURLToPath(new URL('src/content/', import.meta.url));
  const map = new Map();
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const p = `${dir}/${name}`;
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
    });

  // Pass 1: the national guides, keyed by locale + slug, because a place page's
  // date depends on the guide it overlays as well as on the overlay itself.
  const files = walk(root.replace(/\/$/, ''));
  const dateOf = (file) => readFileSync(file, 'utf8').match(/^lastVerified:\s*(\S+)/m)?.[1];
  const guideDate = new Map();
  for (const file of files) {
    const rel = file.slice(root.length, -3);
    if (!rel.startsWith('guides/')) continue;
    const date = dateOf(file);
    if (date) guideDate.set(rel.slice('guides/'.length), date); // `it/codice-fiscale`
  }

  // Pass 2: every content-backed URL. A place page renders the national guide
  // *and* the overlay, so its lastmod is the older of the two — the same date
  // its freshness badge shows. Claiming the overlay's later date would tell a
  // crawler the whole page is fresher than the national text on it is.
  for (const file of files) {
    const date = dateOf(file);
    if (!date) continue;
    const rel = file.slice(root.length, -3); // e.g. guides/it/codice-fiscale
    const it = /(^|\/)it\//.test(rel) ? '/it' : '';
    const clean = rel.replace(/(^|\/)it\//, '$1');
    const overlay = (kind, prefix) => {
      const [place, slug] = clean.slice(`${kind}/`.length).split('/');
      const national = guideDate.get(`${it ? 'it/' : ''}${slug}`);
      return [
        `${it}${prefix}/${place}/residency/${slug}`,
        national && national < date ? national : date,
      ];
    };
    let entry;
    if (clean.startsWith('guides/')) {
      entry = [`${it}/eu-citizens/residency/${clean.slice('guides/'.length)}`, date];
    } else if (clean.startsWith('region-notes/')) {
      entry = overlay('region-notes', '/regions');
    } else if (clean.startsWith('comune-notes/')) {
      entry = overlay('comune-notes', '/cities');
    }
    if (entry) map.set(entry[0], entry[1]);
  }

  // Pass 3: the orientation pages, whose dates live in the registry rather than
  // in frontmatter. Without this, 36 of the sitemap's 218 URLs — every visa,
  // country and life-admin page — went out with no freshness signal at all.
  for (const entry of orientationPages) {
    const path = orientationUrl(entry);
    map.set(path, entry.lastVerified);
    map.set(`/it${path}`, entry.lastVerified);
  }
  return map;
})();

function withLastmod(item) {
  const path = new URL(item.url).pathname.replace(/\/$/, '') || '/';
  const lastmod = lastmodByPath.get(path);
  // Note on the homepage entry: <loc> comes out as `https://host` while its own
  // xhtml:link says `https://host/`, because the integration strips the
  // trailing slash from <loc> by string replacement after the XML is built and
  // the sitemap library re-normalizes any bare origin back to `/`. The two
  // spellings are the same URL — RFC 3986 makes an empty path equivalent to "/"
  // — so this is left alone rather than post-processed; the machinery to fight
  // it would be more fragile than the thing it fixed.
  //
  // The integration's item schema types lastmod as a Date, not a string.
  return lastmod ? { ...item, lastmod: new Date(lastmod) } : item;
}

function canonicalPagesOnly(page) {
  const path = new URL(page).pathname.replace(/\/$/, '');
  const it = path.startsWith('/it/') || path === '/it';
  const rel = it ? path.slice(3) || '/' : path;

  if (rel === '/search') return false;

  const content = (dir) =>
    fileURLToPath(new URL(`src/content/${dir}`, import.meta.url));

  const city = rel.match(/^\/cities\/([^/]+)\/residency\/([^/]+)$/);
  if (city) {
    const [, slug, guide] = city;
    if (guide === 'servizio-sanitario') return false;
    return existsSync(`${content('comune-notes')}/${it ? 'it/' : ''}${slug}/${guide}.md`);
  }

  const region = rel.match(/^\/regions\/([^/]+)\/residency\/([^/]+)$/);
  if (region) {
    const [, slug, guide] = region;
    return existsSync(`${content('region-notes')}/${it ? 'it/' : ''}${slug}/${guide}.md`);
  }

  return true;
}
