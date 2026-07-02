import { getCollection } from 'astro:content';
import type { Locale } from '../i18n/ui';
import { getRegion } from '../data/regions';
import { getCity } from '../data/cities';
import { guideSlug } from './guides';

/**
 * Builds the site-wide citation index consumed by /sources (and /it/sources).
 *
 * The whole promise of the site is that every claim is backed by a dated,
 * primary source. This turns that promise into an auditable page: every source
 * URL cited anywhere in the given locale, de-duplicated, grouped by kind of
 * authority, with the most recent date it was checked and the pages that rely
 * on it. Pure build-time (reads the content collections; no network).
 */
export interface CitedSource {
  title: string;
  url: string;
  host: string;
  accessed: Date;
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
        byUrl.set(s.url, { title: s.title, url: s.url, host, accessed, citedBy: [{ label, href }] });
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
