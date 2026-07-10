import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { existsSync } from 'node:fs';
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
