import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCollection } from 'astro:content';
import type { Locale } from '../i18n/ui';
import { orientationPages, orientationUrl } from '../data/orientation-pages.mjs';
import { sourceCountries } from '../data/source-countries.mjs';
import { getRegion } from '../data/regions';
import { getCity } from '../data/cities';
import { guideSlug } from './guides';
import archives from '../data/archives.json';

const archMap = archives as Record<string, { archived: string; timestamp: string }>;
const tsDate = (ts: string) =>
  ts && ts.length >= 8 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : '';

/**
 * Builds the site-wide citation index consumed by /sources (and /it/sources).
 *
 * The whole promise of the site is that every claim is backed by a dated,
 * primary source. This turns that promise into an auditable page: every source
 * URL cited anywhere in the given locale, de-duplicated, grouped by kind of
 * authority, with the most recent date it was checked and the pages that rely
 * on it. Pure build-time (no network).
 *
 * "Cited anywhere" has to mean anywhere. Citations live in three places, and
 * for a long time this function read only the first: the content collections
 * (guides and overlays), the `sources` arrays inside the orientation pages
 * under src/pages, and the source-country notes in src/data. Reading only the
 * collections left 126 of the site's URLs — the whole of the visa, citizenship,
 * banking, driving, schools and US-tax citation base — off the one page whose
 * heading promises "every one is listed here". check-links hit exactly this
 * omission and fixed it; the audit page had not.
 */
export interface CitedSource {
  title: string;
  url: string;
  host: string;
  accessed: Date;
  archived?: string;
  archDate?: string;
  citedBy: { label: string; href: string }[];
}
export interface SourceGroup {
  key: 'national' | 'regional' | 'comuni';
  sources: CitedSource[];
}

function categoryOf(host: string): SourceGroup['key'] {
  if (
    /(agenziaentrate|interno\.gov|salute\.gov|europa\.eu|spid\.gov|cartaidentita|agid\.gov|integrazionemigranti|anagrafenazionale)/.test(
      host,
    )
  )
    return 'national';
  if (
    /(regione\.|sanita|salute\.regione|\basl|ausl|\basp|asuit|asdaa|sabes|uslumbria|aressardegna|ats-|asugi|asrem|aspbasilicata)/.test(
      host,
    )
  )
    return 'regional';
  return 'comuni';
}

export async function collectSources(locale: Locale) {
  const prefix = locale === 'it' ? '/it' : '';
  const [guides, regionNotes, comuneNotes] = await Promise.all([
    getCollection('guides', ({ data }) => data.lang === locale),
    getCollection('regionNotes', ({ data }) => data.lang === locale),
    getCollection('comuneNotes', ({ data }) => data.lang === locale),
  ]);

  const byUrl = new Map<string, CitedSource>();
  const add = (label: string, href: string, sources: { title: string; url: string; accessed: Date }[]) => {
    for (const s of sources) {
      let host = '';
      try {
        host = new URL(s.url).hostname.replace(/^www\./, '');
      } catch {
        host = s.url;
      }
      const accessed = new Date(s.accessed);
      const existing = byUrl.get(s.url);
      if (existing) {
        if (accessed > existing.accessed) existing.accessed = accessed;
        if (!existing.citedBy.some((c) => c.href === href)) existing.citedBy.push({ label, href });
      } else {
        const a = archMap[s.url];
        byUrl.set(s.url, {
          title: s.title,
          url: s.url,
          host,
          accessed,
          archived: a?.archived,
          archDate: a ? tsDate(a.timestamp) : undefined,
          citedBy: [{ label, href }],
        });
      }
    }
  };

  for (const g of guides) {
    add(g.data.title, `${prefix}/eu-citizens/residency/${guideSlug(g)}`, g.data.sources);
  }
  for (const n of regionNotes) {
    const r = getRegion(n.data.region);
    add(
      `${r?.name ?? n.data.region} — SSN`,
      `${prefix}/regions/${n.data.region}/residency/servizio-sanitario`,
      n.data.sources,
    );
  }
  for (const n of comuneNotes) {
    const c = getCity(n.data.city);
    add(
      `${c?.name ?? n.data.city} — ${n.data.guide}`,
      `${prefix}/cities/${n.data.city}/residency/${n.data.guide}`,
      n.data.sources,
    );
  }

  // Orientation pages keep their citations as a `sources` array literal inside
  // the .astro file, so they are read as text — the same shape check-links
  // matches. They carry no per-source `accessed`, so the registry's
  // lastVerified stands in: that is the date a human confirmed the page
  // against exactly these sources, which is what the column means.
  const literal = /\burl:\s*(['"])(https?:\/\/[^'"\s]+)\1/g;
  const titled = /\btitle:\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*url:\s*(['"])(https?:\/\/[^'"\s]+)\3/g;
  for (const entry of orientationPages) {
    const rel = locale === 'it' ? entry.it : entry.en;
    let raw: string;
    try {
      raw = readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
    } catch {
      continue; // check-freshness owns "registered page missing"
    }
    const titles = new Map<string, string>();
    for (const m of raw.matchAll(titled)) titles.set(m[4], m[2].replace(/\\(.)/g, '$1'));
    const seen = new Set<string>();
    const list = [];
    for (const m of raw.matchAll(literal)) {
      if (seen.has(m[2])) continue;
      seen.add(m[2]);
      list.push({ title: titles.get(m[2]) ?? m[2], url: m[2], accessed: new Date(entry.lastVerified) });
    }
    add(
      locale === 'it' ? entry.titleIt : entry.title,
      `${prefix}${orientationUrl(entry)}`,
      list,
    );
  }

  // Source-country notes are data rather than page text, and are rendered on
  // the /from/<country> pages, so their citations belong here too.
  for (const country of sourceCountries) {
    for (const note of country.notes) {
      add(
        `${locale === 'it' ? country.nameIt : country.nameEn} — ${note.module}`,
        `${prefix}/from/${country.slug}`,
        (note.sources ?? []).map((s: { title: string; url: string }) => ({
          title: s.title,
          url: s.url,
          accessed: new Date(note.lastVerified),
        })),
      );
    }
  }

  const groupsMap = new Map<SourceGroup['key'], CitedSource[]>();
  for (const s of byUrl.values()) {
    const key = categoryOf(s.host);
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key)!.push(s);
  }
  const order: SourceGroup['key'][] = ['national', 'regional', 'comuni'];
  const groups: SourceGroup[] = order
    .filter((k) => groupsMap.has(k))
    .map((key) => ({
      key,
      sources: groupsMap
        .get(key)!
        .sort((a, b) => a.host.localeCompare(b.host) || a.title.localeCompare(b.title)),
    }));

  return { groups, sourceCount: byUrl.size };
}
