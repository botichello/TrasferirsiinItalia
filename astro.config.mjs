import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Canonical site URL. On Vercel, VERCEL_PROJECT_PRODUCTION_URL is injected at
// build time and points at the production domain — so canonical URLs, the
// sitemap, and the JSON-LD all resolve to production even on preview builds
// (correct for SEO). Override with SITE_URL once a custom domain is attached.
const SITE =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://vibing.vercel.app');

export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap()],
});
