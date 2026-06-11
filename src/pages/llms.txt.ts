import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

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
    '## Notes',
    '- Informational only; not legal or tax advice.',
    '- Procedures change; always confirm against the cited official sources.',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
