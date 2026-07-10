import { getCollection } from 'astro:content';
import { getRegion } from '../data/regions';
import { getCity } from '../data/cities';
import { localizePath, type Locale } from '../i18n/ui';
import { guideSlug } from './guides';
import historyJson from '../data/history.json';

/**
 * The site-wide verification feed: every event where a content file's
 * `lastVerified` changed (derived from git by scripts/build-history.mjs),
 * resolved to a page title + URL for the given locale and grouped by date.
 */

interface HistoryEvent {
  verified: string;
  committed: string;
  subject: string;
}
const history = historyJson as Record<string, HistoryEvent[]>;

export interface UpdateEvent {
  label: string;
  url: string;
  subject: string;
}
export interface UpdateDay {
  date: string; // ISO yyyy-mm-dd
  events: UpdateEvent[];
}

export async function getUpdateFeed(locale: Locale): Promise<UpdateDay[]> {
  const guides = await getCollection('guides', ({ data }) => data.lang === locale);
  const regionNotes = await getCollection('regionNotes', ({ data }) => data.lang === locale);
  const comuneNotes = await getCollection('comuneNotes', ({ data }) => data.lang === locale);

  const guideTitle = (slug: string) =>
    guides.find((g) => guideSlug(g) === slug)?.data.title ?? slug;

  // Resolve each localized content file to its page.
  const targets: { key: string; label: string; url: string }[] = [
    ...guides.map((g) => ({
      key: `guides/${g.id}.md`,
      label: g.data.title,
      url: localizePath(`/eu-citizens/residency/${guideSlug(g)}`, locale),
    })),
    ...regionNotes.map((n) => {
      const [regionSlug, guide] = n.id.replace(/^it\//, '').split('/');
      return {
        key: `region-notes/${n.id}.md`,
        label: `${getRegion(regionSlug)?.name ?? regionSlug} — ${guideTitle(guide)}`,
        url: localizePath(`/regions/${regionSlug}/residency/${guide}`, locale),
      };
    }),
    ...comuneNotes.map((n) => {
      const [citySlug, guide] = n.id.replace(/^it\//, '').split('/');
      return {
        key: `comune-notes/${n.id}.md`,
        label: `${getCity(citySlug)?.name ?? citySlug} — ${guideTitle(guide)}`,
        url: localizePath(`/cities/${citySlug}/residency/${guide}`, locale),
      };
    }),
  ];

  const byDate = new Map<string, UpdateEvent[]>();
  for (const { key, label, url } of targets) {
    for (const ev of history[key] ?? []) {
      const list = byDate.get(ev.verified) ?? [];
      list.push({ label, url, subject: ev.subject });
      byDate.set(ev.verified, list);
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, events]) => ({
      date,
      events: events.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

/** Verification history for one content file (for the per-guide display). */
export function getFileHistory(key: string): HistoryEvent[] {
  return history[key] ?? [];
}
