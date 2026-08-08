import type { APIRoute } from 'astro';
import { getUpdateFeed } from '../lib/updates';

/**
 * RSS feed of the verification log (/updates): one item per verification
 * event group (date × change), so subscribers — and crawlers — see when
 * content was re-checked against its primary sources.
 */
const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export const GET: APIRoute = async ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  const feed = await getUpdateFeed('en');

  const items = feed.flatMap((day) => {
    const bySubject = new Map<string, typeof day.events>();
    for (const ev of day.events) {
      const list = bySubject.get(ev.subject) ?? [];
      list.push(ev);
      bySubject.set(ev.subject, list);
    }
    return [...bySubject.entries()].map(([subject, events]) => {
      const pages = events.map((e) => `${e.label} (${base}${e.url})`).join('; ');
      return [
        '<item>',
        `<title>${esc(subject)}</title>`,
        `<link>${base}/updates</link>`,
        `<guid isPermaLink="false">${day.date}:${esc(subject)}</guid>`,
        `<pubDate>${new Date(`${day.date}T12:00:00Z`).toUTCString()}</pubDate>`,
        `<description>${esc(`${events.length} page(s) verified: ${pages}`)}</description>`,
        '</item>',
      ].join('');
    });
  });

  // `atom:link rel="self"` is what tells a reader (and a crawler that found the
  // feed through the <link rel="alternate"> in the page head) the feed's own
  // canonical address, so the same feed reached by two routes is recognised as
  // one. It is the single most common thing feed validators report missing.
  // `lastBuildDate` comes from the newest item rather than from build time, so
  // a rebuild that changed nothing does not announce itself as an update.
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    '<title>Trasferirsi in Italia — verification updates</title>',
    `<link>${base}/updates</link>`,
    `<atom:link href="${base}/updates.xml" rel="self" type="application/rss+xml"/>`,
    '<description>Every occasion a page of this reference was re-verified against its primary sources.</description>',
    '<language>en</language>',
    ...(feed[0] ? [`<lastBuildDate>${new Date(`${feed[0].date}T12:00:00Z`).toUTCString()}</lastBuildDate>`] : []),
    ...items,
    '</channel></rss>',
  ].join('');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
