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
    {
      title: 'Not an EU citizen? Read this first',
      url: '/non-eu',
      type: 'Page',
      text: 'non-EU third country citizens visa type D decreto flussi permesso di soggiorno questura orientation',
    },
    {
      title: 'Non sei cittadino UE? Leggi prima questo',
      url: '/it/non-eu',
      type: 'Pagina (IT)',
      text: 'non UE extracomunitari visto tipo D decreto flussi permesso di soggiorno questura orientamento',
    },
    {
      title: "Italy's digital nomad visa",
      url: '/non-eu/digital-nomad',
      type: 'Page',
      text: 'digital nomad remote worker visa freelance income threshold nulla osta quota art 27 q-bis',
    },
    {
      title: 'Il visto per nomadi digitali',
      url: '/it/non-eu/digital-nomad',
      type: 'Pagina (IT)',
      text: 'nomadi digitali lavoratori da remoto visto soglia reddito nulla osta fuori quota',
    },
    {
      title: "Italy's elective residence visa",
      url: '/non-eu/elective-residence',
      type: 'Page',
      text: 'elective residence visa retirees passive income pension 31000 no work residenza elettiva',
    },
    {
      title: 'Il visto per residenza elettiva',
      url: '/it/non-eu/elective-residence',
      type: 'Pagina (IT)',
      text: 'residenza elettiva pensionati redditi passivi pensione 31000 niente lavoro visto',
    },
    {
      title: "Italy's student visa (university)",
      url: '/non-eu/study-visa',
      type: 'Page',
      text: 'study visa student university Universitaly pre-enrolment subsistence 20 hours work permesso studio',
    },
    {
      title: 'Il visto per studio (università)',
      url: '/it/non-eu/study-visa',
      type: 'Pagina (IT)',
      text: 'visto studio studente università Universitaly preiscrizione mezzi sussistenza lavoro 20 ore',
    },
    {
      title: 'Family reunification (non-EU sponsors)',
      url: '/non-eu/family-reunification',
      type: 'Page',
      text: 'family reunification ricongiungimento familiare nulla osta sportello unico spouse children parents income housing',
    },
    {
      title: 'Ricongiungimento familiare (sponsor non UE)',
      url: '/it/non-eu/family-reunification',
      type: 'Pagina (IT)',
      text: 'ricongiungimento familiare nulla osta sportello unico coniuge figli genitori reddito alloggio idoneità',
    },
    {
      title: 'The EU long-term residence permit',
      url: '/non-eu/long-term-residence',
      type: 'Page',
      text: 'long-term residence permanent permit 5 years carta soggiorno A2 test assegno sociale lungo periodo',
    },
    {
      title: 'Il permesso UE per soggiornanti di lungo periodo',
      url: '/it/non-eu/long-term-residence',
      type: 'Pagina (IT)',
      text: 'soggiornanti lungo periodo permesso permanente 5 anni carta soggiorno test A2 assegno sociale',
    },
    {
      title: 'The full journey checklist',
      url: '/checklist',
      type: 'Page',
      text: 'checklist printable documents all steps journey print tick off',
    },
    {
      title: 'La checklist completa del percorso',
      url: '/it/checklist',
      type: 'Pagina (IT)',
      text: 'checklist stampabile documenti tutti i passi percorso stampa',
    },
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
