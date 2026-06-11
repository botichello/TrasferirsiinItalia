import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Update this to the production domain before launch — it drives canonical
// URLs, the sitemap, and the absolute URLs embedded in JSON-LD.
const SITE = 'https://trasferirsi-italia.example';

export default defineConfig({
  site: SITE,
  trailingSlash: 'never',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap()],
});
