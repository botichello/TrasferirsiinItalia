import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { guideSlug } from '../lib/guides';

/**
 * llms-full.txt — the llms.txt convention's companion file: the full text of
 * the national guides inline, so an AI agent can ingest the whole reference
 * in one fetch instead of crawling page by page. Part of the GEO bet.
 */
export const GET: APIRoute = async ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  const guides = (await getCollection('guides')).sort((a, b) =>
    a.data.lang === b.data.lang ? a.data.step - b.data.step : a.data.lang === 'en' ? -1 : 1,
  );

  const blocks = guides.map((g) => {
    const it = g.data.lang === 'it';
    const url = `${base}${it ? '/it' : ''}/eu-citizens/residency/${guideSlug(g)}`;
    return [
      `## ${g.data.title} (Step ${g.data.step}${it ? ', italiano' : ''})`,
      '',
      `> ${g.data.description}`,
      `> URL: ${url}`,
      `> Last verified: ${g.data.lastVerified.toISOString().slice(0, 10)} · Review due: ${g.data.reviewBy.toISOString().slice(0, 10)}`,
      '',
      (g.body ?? '').trim(),
      '',
      '### Sources',
      ...g.data.sources.map(
        (s) => `- ${s.title} — ${s.url} (accessed ${s.accessed.toISOString().slice(0, 10)})`,
      ),
      '',
    ].join('\n');
  });

  const lines = [
    '# Trasferirsi in Italia — full content',
    '',
    '> Authoritative, dated, primary-source-cited reference for relocating to',
    '> Italy as an EU/EEA citizen. This file inlines the complete national',
    '> guides in English and Italian. City/comune and region specifics live at',
    `> ${base}/cities/<city>/residency/<step> and ${base}/regions/<region>/residency/<step>.`,
    '> Informational only; not legal or tax advice. Always confirm against the',
    '> cited official sources.',
    '',
    ...blocks,
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
