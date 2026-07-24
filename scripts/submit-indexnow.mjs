#!/usr/bin/env node
/**
 * Submit the site's canonical URLs to IndexNow (Bing, Yandex, Seznam, Naver…),
 * so new/changed pages are discovered immediately instead of on crawl cadence.
 * Google does not consume IndexNow — use Search Console for Google.
 *
 * The key is proven by ownership of https://<host>/<key>.txt (in public/).
 * Run AFTER a production deploy, so the sitemap and key file are live:
 *
 *   npm run submit:indexnow            # uses the live production sitemap
 *   SITE_URL=https://example.com npm run submit:indexnow
 */
const SITE = (process.env.SITE_URL || 'https://www.trasferirsiinitalia.com').replace(/\/$/, '');
const KEY = '16f5622b924b82ed4511062448e762d7';

const host = new URL(SITE).host;
const keyLocation = `${SITE}/${KEY}.txt`;

// The key file must be live before any engine will accept the submission.
const keyRes = await fetch(keyLocation);
if (!keyRes.ok || (await keyRes.text()).trim() !== KEY) {
  console.error(`✗ Key file not live at ${keyLocation} — deploy first.`);
  process.exit(1);
}

// Collect canonical URLs from the live sitemap (index → parts → <loc>).
const urls = [];
const indexXml = await (await fetch(`${SITE}/sitemap-index.xml`)).text();
for (const [, part] of indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const xml = await (await fetch(part)).text();
  for (const [, loc] of xml.matchAll(/<url><loc>([^<]+)<\/loc>/g)) urls.push(loc);
}
if (urls.length === 0) {
  console.error('✗ No URLs found in the live sitemap.');
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key: KEY, keyLocation, urlList: urls }),
});

// 200 = processed, 202 = accepted (key validation pending) — both are success.
if (res.status === 200 || res.status === 202) {
  console.log(`✓ Submitted ${urls.length} URLs for ${host} (HTTP ${res.status}).`);
} else {
  console.error(`✗ IndexNow returned HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
