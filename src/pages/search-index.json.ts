import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { regions, getRegion } from '../data/regions';
import { cities } from '../data/cities';
import { glossary } from '../data/glossary';
import { guideSlug } from '../lib/guides';

/**
 * Static search index consumed by /search. Dependency-free: a small JSON
 * document the client filters in the browser. Covers national guides (both
 * languages), region SSN pages, city journeys, glossary terms, and the trust
 * pages. City entries carry English exonyms (Florence → Firenze) so searches
 * work in either naming.
 */

/** English exonyms for cities whose Italian names differ. */
const exonyms: Record<string, string> = {
  roma: 'Rome',
  milano: 'Milan',
  napoli: 'Naples',
  torino: 'Turin',
  firenze: 'Florence',
  venezia: 'Venice',
  genova: 'Genoa',
  padova: 'Padua',
};

export const GET: APIRoute = async () => {
  const guides = (await getCollection('guides')).sort((a, b) => a.data.step - b.data.step);

  type Entry = { title: string; url: string; type: string; text: string };
  const entries: Entry[] = [];

  for (const g of guides) {
    const it = g.data.lang === 'it';
    entries.push({
      title: g.data.title,
      url: `${it ? '/it' : ''}/eu-citizens/residency/${guideSlug(g)}`,
      type: it ? 'Guida nazionale (IT)' : 'National guide',
      text: g.data.description,
    });
  }

  for (const r of regions) {
    entries.push({
      title: `${r.name} — health service (SSN)`,
      url: `/regions/${r.slug}/residency/servizio-sanitario`,
      type: 'Region',
      text: `${r.name} SSN health authority enrolment ${r.capoluogo}`,
    });
  }

  for (const c of cities) {
    const region = getRegion(c.region);
    const alias = exonyms[c.slug] ?? '';
    entries.push({
      title: `${c.name} (${c.province})`,
      url: `/cities/${c.slug}/residency/codice-fiscale`,
      type: `City · ${region?.name ?? ''}`,
      text: `${c.name} ${alias} ${region?.name ?? ''} ${c.province} residency relocation anagrafe comune`,
    });
  }

  for (const term of glossary) {
    entries.push({
      title: term.term,
      url: `/glossary#${term.slug}`,
      type: 'Glossary term',
      text: term.en,
    });
  }

  entries.push(
    { title: 'About', url: '/about', type: 'Page', text: 'about who maintains this reference' },
    {
      title: 'How we verify',
      url: '/how-we-verify',
      type: 'Page',
      text: 'editorial methodology sources verification freshness',
    },
    {
      title: 'Sources',
      url: '/sources',
      type: 'Page',
      text: 'all primary sources citations index official authorities checked dates transparency',
    },
    {
      title: 'Updates',
      url: '/updates',
      type: 'Page',
      text: 'updates verification log history changelog when pages were last checked',
    },
    {
      title: 'Start here',
      url: '/start',
      type: 'Page',
      text: 'start here wizard personalized path situation worker student economically inactive family which steps',
    },
    {
      title: 'Glossary',
      url: '/glossary',
      type: 'Page',
      text: 'glossary definitions terms codice fiscale anagrafe SSN ASL SPID CIE PEC marca da bollo autocertificazione permesso di soggiorno',
    },
  );

  return new Response(JSON.stringify(entries), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
