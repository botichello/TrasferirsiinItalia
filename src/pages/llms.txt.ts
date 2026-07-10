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
    '## About & methodology',
    `- [About](${base}/about): what this reference is and who it's for.`,
    `- [How we verify](${base}/how-we-verify): editorial method — sourcing, dating, review.`,
    `- [Search](${base}/search) · [Browse cities](${base}/cities) · [Browse regions](${base}/regions)`,
    '',
    '## Notes',
    '- Informational only; not legal or tax advice.',
    '- Procedures change; always confirm against the cited official sources.',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
