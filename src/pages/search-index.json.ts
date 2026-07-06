import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { regions, getRegion } from '../data/regions';
import { cities } from '../data/cities';

/**
 * Static search index consumed by /search. Dependency-free: a small JSON
 * document the client filters in the browser. Covers national guides, region
 * SSN pages, city journeys, and the trust pages.
 */
export const GET: APIRoute = async () => {
  const guides = (await getCollection('guides')).sort((a, b) => a.data.step - b.data.step);
  const comuneNotes = await getCollection('comuneNotes');

  type Entry = { title: string; url: string; type: string; text: string };
  const entries: Entry[] = [];

  for (const g of guides) {
    entries.push({
      title: g.data.title,
      url: `/eu-citizens/residency/${g.id}`,
      type: 'National guide',
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
    entries.push({
      title: `${c.name} (${c.province})`,
      url: `/cities/${c.slug}/residency/codice-fiscale`,
      type: `City · ${region?.name ?? ''}`,
      text: `${c.name} ${region?.name ?? ''} ${c.province} residency relocation`,
    });
  }

  for (const n of comuneNotes) {
    if (n.data.guide !== 'iscrizione-anagrafica') continue;
    entries.push({
      title: n.data.title ?? `Residency registration — ${n.data.city}`,
      url: `/cities/${n.data.city}/residency/iscrizione-anagrafica`,
      type: 'City · anagrafe',
      text: `${n.data.city} anagrafe residency registration comune`,
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
