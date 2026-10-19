/**
 * Citation link-health gate. Companion to check-freshness.mjs.
 *
 * The site's whole bet is that its citations are trustworthy. Dates being
 * present (check-freshness.mjs) is not enough — a source URL can rot into a
 * 404, or worse, start redirecting to a parked/scam domain (this is not
 * hypothetical: a comune citation here had begun 302-ing to a domain-parking
 * page). This gate fetches every cited `sources[].url` and classifies it.
 *
 * Unlike the freshness gate, this one needs network, so it is NOT part of
 * `npm run build` (builds must stay hermetic and fast). It runs via
 * `npm run check:links` and on a schedule / on content PRs in CI
 * (.github/workflows/link-health.yml).
 *
 * Failure policy (kept deliberately low-false-positive so the red check means
 * something):
 *   - ERROR (always fails): 404/410 dead links, and redirects to a domain that
 *     looks like parking/hijack, or answers 200 with a bot-challenge body
 *     instead of the page.
 *   - REVIEW (fails only when LINKS_STRICT=1): a citation that redirects to a
 *     different host, or whose deep link now collapses to the site root — i.e.
 *     possible silent rot a human should look at.
 *   - UNVERIFIABLE (never fails): 401/403/429/5xx/timeout. Many official IT
 *     portals sit behind anti-bot/edge protection that answers automated
 *     fetches with 403/503 while resolving fine in a real browser, so this is
 *     not actionable from CI. Known such hosts are listed as "expected".
 *
 * No dependencies — uses Node's built-in fetch (Node 18+).
 */
import { collectCitedUrls } from './lib/cited-urls.mjs';
import { MISSING_INTERMEDIATE, missingIntermediates, getWithCa } from './lib/tls-chain.mjs';

const STRICT = process.env.LINKS_STRICT === '1';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const TIMEOUT_MS = 25_000;
const ATTEMPTS = 3;
const CONCURRENCY = 8;

/**
 * Hosts verified (2026-06-12; Milano/Palermo added 2026-07-10) to sit behind
 * anti-bot / origin firewalls that return 401/403/503 to automated fetches
 * while resolving in a normal browser. Their non-2xx is reported as
 * "expected", never a failure. Stored www-stripped to match host() below.
 * Trim this list if a host starts answering cleanly. All their cited URLs
 * carry Wayback fallbacks in src/data/archives.json.
 */
const KNOWN_BOTWALL = new Set([
  'comune.milano.it',
  'comune.palermo.it',
  'demografici.comune.napoli.it',
  'comune.napoli.it',
  'regione.campania.it',
  'regione.marche.it',
  'uslumbria1.it',
  'asugi.sanita.fvg.it',
  'sanita.regione.abruzzo.it',
  'aspbasilicata.it',
  'asrem.molise.it',
  'comune.catania.it',
  'comune.reggioemilia.it',
  'comune.trieste.it',
  'regione.basilicata.it',
  'regione.fvg.it',
  'sanita.puglia.it',
  // Serves a JS "Site verification" interstitial at HTTP 200 to datacenter
  // traffic. Confirmed live via Wayback snapshots recorded in archives.json
  // (the SSN page 2026-02-16, the contribution PDF 2023-12-07).
  'salute.gov.it',
  // ANPR serves its subpages only to browser-shaped requests (root is 200,
  // every /area-cittadino/ path is 403); each cited page was read with full
  // browser headers on 2026-08-09.
  'anagrafenazionale.interno.it',
  // WAF-fronted comuni: 403/503 to datacenter traffic, fine in a browser
  // (Potenza confirmed alive via Wayback 200 snapshots).
  'comune.potenza.it',
  'comune.siracusa.it',
  'servizidemografici.reggiocal.it',
  // EUR-Lex answers datacenter traffic with an AWS WAF challenge (HTTP 202,
  // empty body) for every URL, valid or not — so this checker cannot tell a
  // good citation from a typo here. Each cited CELEX number is instead verified
  // against the EU Publications Office (publications.europa.eu/resource/celex/
  // <CELEX>, which 200s for a real identifier and 404s for a bogus one) and the
  // human-readable EUR-Lex URL is built from the verified identifier.
  'eur-lex.europa.eu',
]);

/** Final-redirect hosts that smell like domain parking / hijack -> hard fail. */
const PARKING_RE =
  /(^|\.)(verification|parking|sedo|sedoparking|bodis|afternic|hugedomains|domainsale|domainforsale|cashparking|parkingcrew|above|dan)\b|verification\.com/i;

/**
 * Final-redirect hosts belonging to bot-management / WAF challenge vendors. A
 * citation that bounces here isn't rot — it's edge protection answering our
 * automated fetch — so treat it as "expected", like a 403 from a bot-walled
 * host, rather than a redirect to review.
 */
/**
 * Interstitials served *in place of* the page, on the cited host, with HTTP 200.
 * Status and final URL both look healthy, so without reading the body a
 * challenge is indistinguishable from the real page — six salute.gov.it
 * citations were passing this check while serving a "Site verification" screen,
 * including the source behind the SSN guide and all twenty region overlays.
 * Markers are deliberately narrow: each is a literal string these screens print
 * and an article about Italian healthcare would not.
 */
const CHALLENGE_BODY_RE =
  /<title>\s*(?:Site verification|Just a moment|Attention Required|Access denied)\s*<\/title>|Checking your browser before accessing|Enable JavaScript and cookies to continue|__cf_chl_|\/cdn-cgi\/challenge-platform/i;

const BOTWALL_REDIRECT_RE =
  /(perfdrive|radware|incapsula|imperva|datadome|queue-it|distilnetworks|shieldsquare|hcaptcha|recaptcha|geo\.captcha)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};
const depth = (u) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
  } catch {
    return 0;
  }
};

const HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** Per-host intermediates fetched by repairChain(), so each host is repaired once. */
const repaired = new Map();

/**
 * Retry a URL whose server omits an intermediate certificate, the way a
 * browser would (scripts/lib/tls-chain.mjs). Null if the chain cannot be built
 * from the certificate's own issuer URLs — the original error then stands.
 */
async function repairChain(url) {
  const { hostname } = new URL(url);
  if (!repaired.has(hostname)) repaired.set(hostname, missingIntermediates(hostname).catch(() => null));
  const extraCa = await repaired.get(hostname);
  if (!extraCa) return null;
  try {
    const r = await getWithCa(url, { headers: HEADERS, timeoutMs: TIMEOUT_MS, extraCa });
    return { status: r.status, finalUrl: r.finalUrl, error: null, challenge: CHALLENGE_BODY_RE.test(r.body), chainRepaired: true };
  } catch {
    return null;
  }
}

/** GET with redirects, browser UA, timeout, and retries on non-2xx/errors. */
async function check(url) {
  let last = { status: 0, finalUrl: url, error: 'unreachable' };
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // A challenge page answers 200 on the cited host itself, so status and
      // final URL both look healthy. Read a bounded slice of HTML bodies to
      // tell one apart; everything else has its body cancelled as before.
      let challenge = false;
      const type = res.headers.get('content-type') ?? '';
      if (res.status >= 200 && res.status < 300 && /html/i.test(type)) {
        try {
          challenge = CHALLENGE_BODY_RE.test((await res.text()).slice(0, 60_000));
        } catch {}
      } else {
        try {
          await res.body?.cancel();
        } catch {}
      }
      last = { status: res.status, finalUrl: res.url || url, error: null, challenge };
      if (res.status >= 200 && res.status < 300) return last;
    } catch (e) {
      const code = e?.name === 'TimeoutError' ? 'timeout' : e?.cause?.code || e?.code || e?.name || 'fetch-error';
      last = { status: 0, finalUrl: url, error: String(code) };
      // Not transient, so not worth the retries: either the browser-style
      // repair answers, or the error is the result.
      if (MISSING_INTERMEDIATE.has(String(code))) {
        const r = await repairChain(url);
        if (r) return r;
        return { ...last, error: `${code} (server omits an intermediate certificate and its issuer could not be fetched)` };
      }
    }
    if (i < ATTEMPTS - 1) await sleep(1500 * (i + 1));
  }
  return last;
}

/** Map a fetch result to a severity + category. */
function classify(url, r) {
  const cited = host(url);
  const final = host(r.finalUrl);
  const s = r.status;

  if (s === 404 || s === 410) return { level: 'error', cat: 'dead', msg: `HTTP ${s} — dead` };

  if (s >= 200 && s < 300) {
    if (r.challenge) {
      return KNOWN_BOTWALL.has(cited)
        ? { level: 'info', cat: 'botwall', msg: 'HTTP 200 but the body is a bot-challenge — known bot-protected host (expected)' }
        : { level: 'warn', cat: 'unverifiable', msg: 'HTTP 200 but the body is a bot-challenge, not the page — could not verify' };
    }
    if (final && final !== cited) {
      if (PARKING_RE.test(final))
        return { level: 'error', cat: 'hijack', msg: `redirects off-site to ${r.finalUrl}` };
      if (BOTWALL_REDIRECT_RE.test(final))
        return { level: 'info', cat: 'botwall', msg: `redirects to a bot-challenge (${final}) — expected` };
      return { level: 'review', cat: 'offsite-redirect', msg: `redirects to a different host → ${r.finalUrl}` };
    }
    if (depth(url) >= 1 && depth(r.finalUrl) === 0)
      return { level: 'review', cat: 'stale-redirect', msg: `deep link now lands on the site root → ${r.finalUrl}` };
    return { level: 'ok', cat: 'ok', msg: 'ok', chainRepaired: r.chainRepaired };
  }

  const reason = s ? `HTTP ${s}` : r.error || 'unreachable';
  if (KNOWN_BOTWALL.has(cited))
    return { level: 'info', cat: 'botwall', msg: `${reason} — known bot-protected host (expected)` };
  return { level: 'warn', cat: 'unverifiable', msg: `${reason} — could not verify (bot-protection or transient)` };
}

/** Bounded-concurrency map. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// --- collect cited URLs --------------------------------------------------
// Content collections, orientation pages, source-country notes and tracked
// figures — see scripts/lib/cited-urls.mjs for why all four.
const { urlToFiles, counts } = await collectCitedUrls();
const urls = [...urlToFiles.keys()].sort();
console.log(
  `Checking ${urls.length} cited source URL(s) across ${counts.contentFiles} content file(s) ` +
    `+ ${counts.orientationPages} orientation pages + ${counts.noteSources} source-country note citations ` +
    `+ ${counts.figures} tracked figures…\n`,
);

// --- check + classify ----------------------------------------------------
const results = await pool(urls, CONCURRENCY, async (url) => ({ url, ...classify(url, await check(url)) }));

const by = (cat) => results.filter((r) => r.cat === cat);
const errors = results.filter((r) => r.level === 'error');
const reviews = results.filter((r) => r.level === 'review');
const warns = results.filter((r) => r.level === 'warn');
const infos = results.filter((r) => r.level === 'info');
const okCount = results.filter((r) => r.level === 'ok').length;

const show = (r) => {
  console.log(`  - ${r.url}\n      ${r.msg}`);
  for (const f of urlToFiles.get(r.url)) console.log(`      cited in: ${f}`);
};

if (errors.length) {
  console.log(`✗ ${errors.length} broken citation(s) — dead or hijacked:`);
  errors.forEach(show);
  console.log('');
}
if (reviews.length) {
  console.log(`⚠️  ${reviews.length} citation(s) to review (redirects / possible rot):`);
  reviews.forEach(show);
  console.log('');
}
if (warns.length) {
  console.log(`ℹ️  ${warns.length} citation(s) could not be verified (new — investigate):`);
  warns.forEach(show);
  console.log('');
}
if (infos.length) {
  console.log(`ℹ️  ${infos.length} citation(s) on known bot-protected hosts (expected, not failing):`);
  for (const r of infos) console.log(`  - ${host(r.url)} — ${r.msg.split(' — ')[0]}`);
  console.log('');
}

// Worth saying out loud: these pass only because the checker repaired the
// server's chain, and a reader on a strict client could still hit the error.
const repairedHosts = [...new Set(results.filter((r) => r.chainRepaired).map((r) => host(r.url)))].sort();
if (repairedHosts.length) {
  console.log(
    `ℹ️  ${repairedHosts.length} host(s) omit an intermediate TLS certificate; checked by fetching it from the ` +
      `certificate's own issuer URL, as browsers do: ${repairedHosts.join(', ')}\n`,
  );
}

console.log(
  `Summary: ${okCount} ok · ${errors.length} broken · ${reviews.length} to-review · ` +
    `${warns.length} unverifiable(new) · ${infos.length} bot-protected(expected).`,
);

const failures = errors.length + (STRICT ? reviews.length : 0);
// One stream for the whole report: the verdict on stderr and the details on
// stdout are buffered separately, so in CI logs the verdict used to land in
// the middle of the broken-link list it summarises.
if (failures) {
  console.log(
    `\n✗ Link-health check failed: ${errors.length} broken` +
      (STRICT ? ` + ${reviews.length} to-review (strict)` : '') +
      '.',
  );
  process.exit(1);
}
console.log('\n✓ Link-health check passed (no dead or hijacked citations).');
