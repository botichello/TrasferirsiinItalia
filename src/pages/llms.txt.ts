import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { regions } from '../data/regions';

/**
 * llms.txt — a concise, machine-friendly index for AI agents and assistants,
 * pointing them at the canonical guide pages. This is part of the GEO bet:
 * make the site easy and unambiguous to cite.
 */
export const GET: APIRoute = async ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  const guides = (await getCollection('guides')).sort(
    (a, b) => a.data.step - b.data.step,
  );

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
    '## Region-specific versions',
    '> Each step is also available tailored to a specific Italian region at',
    '> /regions/<region>/residency/<step>. Region pages add local specifics',
    '> (e.g. the health authority to enrol with) on top of the national steps.',
    `> Regions: ${regions.map((r) => r.slug).join(', ')}.`,
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
