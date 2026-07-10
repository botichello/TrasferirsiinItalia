import type { APIRoute } from 'astro';

/**
 * Explicitly welcome both traditional search crawlers and AI/LLM crawlers —
 * being citable by AI assistants is a core goal of this site.
 */
export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? new URL('sitemap-index.xml', site).href : '';
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    '# AI / assistant crawlers explicitly welcome',
    'User-agent: GPTBot',
    'Allow: /',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'User-agent: ChatGPT-User',
    'Allow: /',
    'User-agent: ClaudeBot',
    'Allow: /',
    'User-agent: Claude-User',
    'Allow: /',
    'User-agent: Claude-SearchBot',
    'Allow: /',
    'User-agent: PerplexityBot',
    'Allow: /',
    'User-agent: Perplexity-User',
    'Allow: /',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    '# Machine-readable content index for LLMs/agents',
    site ? `# llms.txt: ${new URL('llms.txt', site).href}` : '',
    '',
    sitemap ? `Sitemap: ${sitemap}` : '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
