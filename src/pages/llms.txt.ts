import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { regions } from '../data/regions';
import { cities } from '../data/cities';

/**
 * llms.txt — a concise, machine-friendly index for AI agents and assistants,
 * pointing them at the canonical guide pages. This is part of the GEO bet:
 * make the site easy and unambiguous to cite.
 */
export const GET: APIRoute = async ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  const all = (await getCollection('guides')).sort((a, b) => a.data.step - b.data.step);
  const guides = all.filter((g) => g.data.lang !== 'it');
  const guidesIt = all.filter((g) => g.data.lang === 'it');
  const itSlug = (id: string) => id.replace(/^it\//, '');

  const lines = [
    '# Trasferirsi in Italia',
    '',
    '> Authoritative, dated, primary-source-cited reference for relocating to Italy.',
    '> v1 covers the EU/EEA-citizen national residency journey. Each page lists the',
    '> official sources it is based on and the date it was last verified.',
    '',
    '## EU residency journey',
    ...guides.map(
      (g) =>
        `- [${g.data.title}](${base}/eu-citizens/residency/${g.id}): ${g.data.description} (last verified ${g.data.lastVerified.toISOString().slice(0, 10)})`,
    ),
    '',
    '## Percorso di residenza UE (italiano)',
    '> The same journey, in Italian, under /it/.',
    ...guidesIt.map(
      (g) =>
        `- [${g.data.title}](${base}/it/eu-citizens/residency/${itSlug(g.id)}): ${g.data.description} (verificato il ${g.data.lastVerified.toISOString().slice(0, 10)})`,
    ),
    '',
    '## City-specific versions',
    '> Each step is available tailored to a specific city/comune at',
    '> /cities/<city>/residency/<step>. City pages add comune-level specifics for',
    '> residency registration (anagrafe) and the region-level health authority for',
    '> the SSN, on top of the national steps. The codice fiscale is national and',
    '> uniform (the only local element is the Agenzia delle Entrate office).',
    `> Cities: ${cities.map((c) => c.slug).join(', ')}.`,
    '',
    '## Region-specific versions (SSN / health authority)',
    '> /regions/<region>/residency/<step> gives the region-level health authority',
    '> to enrol with for the SSN.',
    `> Regions: ${regions.map((r) => r.slug).join(', ')}.`,
    '',
    '## Non-EU citizens (orientation)',
    `- [Not an EU citizen? Read this first](${base}/non-eu): type D visas, decreto flussi, permesso di soggiorno, and which guides still apply.`,
    `- [Italy's digital nomad visa](${base}/non-eu/digital-nomad): requirements, income floor, procedure (art. 27 q-bis).`,
    `- [Italy's elective residence visa](${base}/non-eu/elective-residence): the passive-income route for the financially independent (DM 850/2011).`,
    `- [Italy's student visa](${base}/non-eu/study-visa): Universitaly pre-enrolment, subsistence figure, work allowance, post-graduation permit.`,
    `- [Family reunification (non-EU sponsors)](${base}/non-eu/family-reunification): art. 29 TU — income/housing tests, 150-day nulla osta, family permit rights.`,
    `- [EU long-term residence permit](${base}/non-eu/long-term-residence): the permanent status after 5 years (art. 9 TU) — requirements and rights.`,
    `- [EU Blue Card](${base}/non-eu/blue-card): highly qualified work outside the quotas (art. 27-quater, post-2023 rules).`,
    `- [Italian citizenship](${base}/citizenship): residence (4 years EU / 10 non-EU), marriage, and descent after the 2025 reform.`,
    `- [Renting a home](${base}/renting): contract types, the 30-day registration rule, deposit cap, cedolare secca.`,
    `- [School: enrolling your children](${base}/schools): compulsory 6–16, mid-year enrolment at any time (DPR 394 art. 45), the Unica window, vaccinations, costs.`,
    `- [Driving on a foreign licence](${base}/driving): EU licences recognised as-is; non-EU valid 1 year from residence (art. 135 CdS), then conversion (reciprocity list) or Italian exams.`,
    `- [Opening a bank account](${base}/banking): the conto di base is a statutory right for anyone staying legally in the EU regardless of residence (art. 126-noviesdecies TUB) — free tiers, refusal rules, costs, EU IBAN rights.`,
    `- [Moving with a dog, cat or ferret](${base}/pets): microchip then rabies vaccine then document; Reg. (EU) 2026/131 replaced 576/2013 on 22 Apr 2026; SINAC registration after 30 days.`,
    '',
    '## Orientamento (italiano)',
    '> The same orientation pages, in Italian, under /it/.',
    `- [Non sei cittadino UE?](${base}/it/non-eu) · [Nomadi digitali](${base}/it/non-eu/digital-nomad) · [Residenza elettiva](${base}/it/non-eu/elective-residence) · [Visto studio](${base}/it/non-eu/study-visa)`,
    `- [Ricongiungimento familiare](${base}/it/non-eu/family-reunification) · [Lungo periodo](${base}/it/non-eu/long-term-residence) · [Carta blu UE](${base}/it/non-eu/blue-card)`,
    `- [Cittadinanza](${base}/it/citizenship) · [Affittare casa](${base}/it/renting) · [Scuola](${base}/it/schools) · [Patente](${base}/it/driving) · [Conto bancario](${base}/it/banking) · [Animali](${base}/it/pets)`,
    '',
    '## About & methodology',
    `- [About](${base}/about): what this reference is and who it's for.`,
    `- [How we verify](${base}/how-we-verify): editorial method — sourcing, dating, review.`,
    `- [Full journey checklist](${base}/checklist) · [Updates log](${base}/updates) · [Glossary](${base}/glossary)`,
    `- [Search](${base}/search) · [Browse cities](${base}/cities) · [Browse regions](${base}/regions)`,
    '',
    '## Notes',
    `- Full inline content of every national guide (both languages): ${base}/llms-full.txt`,
    `- Verification log (RSS): ${base}/updates.xml`,
    '- Informational only; not legal or tax advice.',
    '- Procedures change; always confirm against the cited official sources.',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
