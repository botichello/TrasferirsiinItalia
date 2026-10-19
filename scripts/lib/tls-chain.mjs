/**
 * Fetching a page whose server sends an incomplete TLS chain.
 *
 * A server is meant to send its own certificate plus the intermediates that
 * link it to a trusted root. Several Italian public portals send only the
 * first (in 2026-10: mit.gov.it, the ministry behind every driving-licence
 * citation here, and comune.lecce.it). Browsers repair this silently: the
 * certificate names where its issuer can be downloaded (the "CA Issuers" URL in
 * its Authority Information Access extension) and they fetch it. Node does not,
 * so fetch() fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE, and the link-health
 * check could only file those citations under "could not verify" — every
 * week, for pages that open fine for every reader.
 *
 * This does what the browser does, and no more: download the issuer the
 * certificate itself names, require it to have signed the certificate and to
 * chain to a root Node already trusts, and only then retry with it added. A
 * certificate that is expired, for the wrong host, or not ultimately issued by
 * a trusted root still fails, because the retry is an ordinary verified
 * request with one more intermediate available — verification is never turned
 * off for the request whose answer is used.
 */
import tls from 'node:tls';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';

/** Errors that mean "an intermediate is missing", as opposed to a bad certificate. */
export const MISSING_INTERMEDIATE = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
]);

const anchors = () => tls.getCACertificates?.('default') ?? tls.rootCertificates;
const anchorCerts = () => anchors().map((pem) => new X509Certificate(pem));
const MAX_HOPS = 3;

/** The certificate a host presents, read without verifying it. */
function presented(hostname, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false }, () => {
      const peer = socket.getPeerCertificate(false);
      socket.end();
      if (!peer?.raw) return reject(new Error('no peer certificate'));
      resolve({ cert: new X509Certificate(peer.raw), infoAccess: peer.infoAccess });
    });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('timeout')));
    socket.on('error', reject);
  });
}

const issuerUrls = (infoAccess) => (infoAccess?.['CA Issuers - URI'] ?? []).filter((u) => /^https?:\/\//.test(u));

/** AIA URLs of an X509Certificate (crypto's object exposes them as text). */
const issuerUrlsOf = (cert) =>
  [...(cert.infoAccess ?? '').matchAll(/CA Issuers - URI:(\S+)/g)].map((m) => m[1]).filter((u) => /^https?:\/\//.test(u));

async function download(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`issuer download HTTP ${res.status}`);
  // DER or PEM; a PKCS#7 bundle fails to parse and is treated as unrepairable.
  return new X509Certificate(Buffer.from(await res.arrayBuffer()));
}

const signs = (issuer, cert) => cert.checkIssued(issuer) && cert.verify(issuer.publicKey);

/**
 * PEMs of the intermediates linking `hostname`'s certificate to a trusted root,
 * fetched from the URLs the certificates themselves name. Null if no such
 * chain can be built.
 */
export async function missingIntermediates(hostname, { port = 443, timeoutMs = 15_000 } = {}) {
  const roots = anchorCerts();
  const { cert, infoAccess } = await presented(hostname, port, timeoutMs);
  const chain = [];
  let current = cert;
  let urls = issuerUrls(infoAccess);
  for (let hop = 0; hop < MAX_HOPS && urls.length; hop++) {
    let issuer = null;
    for (const url of urls) {
      try {
        const candidate = await download(url, timeoutMs);
        if (signs(candidate, current)) {
          issuer = candidate;
          break;
        }
      } catch {}
    }
    if (!issuer) return null;
    chain.push(issuer.toString());
    if (roots.some((root) => signs(root, issuer))) return chain;
    current = issuer;
    urls = issuerUrlsOf(issuer);
  }
  return null;
}

/**
 * GET with redirects over https.request, trusting the default roots plus
 * `extraCa`. Shape of the result matches check-links' check(): status, final
 * URL, and the bounded HTML body for the challenge test.
 */
export function getWithCa(url, { headers, timeoutMs, extraCa, maxRedirects = 8 }) {
  const agent = new https.Agent({ ca: [...anchors(), ...extraCa] });
  const hop = (current, left) =>
    new Promise((resolve, reject) => {
      const req = https.get(current, { headers, agent, timeout: timeoutMs }, (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && left > 0) {
          res.resume();
          resolve(hop(new URL(location, current).href, left - 1));
          return;
        }
        const type = res.headers['content-type'] ?? '';
        if (!(status >= 200 && status < 300 && /html/i.test(type))) {
          res.resume();
          resolve({ status, finalUrl: current, body: '' });
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 60_000) res.destroy();
        });
        res.on('close', () => resolve({ status, finalUrl: current, body: body.slice(0, 60_000) }));
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })));
      req.on('error', reject);
    });
  return hop(url, maxRedirects);
}
