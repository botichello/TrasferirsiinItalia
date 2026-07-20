import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Canonical site URL. On Vercel, VERCEL_PROJECT_PRODUCTION_URL is injected at
// build time and points at the production domain — so canonical URLs, the
// sitemap, and the JSON-LD all resolve to production even on preview builds
// (correct for SEO). Override with SITE_URL once a custom domain is attached.
//
// ⚠️ The env var is baked in at build time: after renaming the Vercel project,
// production must be REDEPLOYED or every canonical keeps pointing at the old
// (now dead) *.vercel.app domain.
const SITE =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://trasferirsiinitalia.vercel.app');

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
 * Stamp each content-backed sitemap URL with its `lastVerified` date as
 * <lastmod>, so crawlers prioritize what actually changed. Hub pages carry
 * no lastmod. The map is built once by scanning frontmatter on disk (the
 * content collections aren't available inside astro.config).
 */
const lastmodByPath = (() => {
  const root = fileURLToPath(new URL('src/content/', import.meta.url));
  const map = new Map();
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const p = `${dir}/${name}`;
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
    });
  for (const file of walk(root.replace(/\/$/, ''))) {
    const date = readFileSync(file, 'utf8').match(/^lastVerified:\s*(\S+)/m)?.[1];
    if (!date) continue;
    const rel = file.slice(root.length, -3); // e.g. guides/it/codice-fiscale
    const it = /(^|\/)it\//.test(rel) ? '/it' : '';
    const clean = rel.replace(/(^|\/)it\//, '$1');
    let path;
    if (clean.startsWith('guides/')) {
      path = `${it}/eu-citizens/residency/${clean.slice('guides/'.length)}`;
    } else if (clean.startsWith('region-notes/')) {
      path = `${it}/regions/${clean.slice('region-notes/'.length).replace('/', '/residency/')}`;
    } else if (clean.startsWith('comune-notes/')) {
      path = `${it}/cities/${clean.slice('comune-notes/'.length).replace('/', '/residency/')}`;
    }
    if (path) map.set(path, date);
  }
  return map;
})();

function withLastmod(item) {
  const path = new URL(item.url).pathname.replace(/\/$/, '') || '/';
  const lastmod = lastmodByPath.get(path);
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
