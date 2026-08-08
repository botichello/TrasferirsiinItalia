import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The citability contract.
 *
 * Every guide page MUST carry at least one primary source and an explicit
 * verification date. These are not optional frontmatter niceties — the build
 * fails without them (see the .min(1) on sources and the required dates).
 *
 * This is the whole strategic bet of the site: AI agents and humans cite
 * content that is accurate, dated, and sourced. A stale, unsourced page is
 * worse than no page. So we make the discipline mechanical, not aspirational.
 */
const source = z.object({
  title: z.string().min(1),
  // Must be a real, resolvable primary source (gov / EU portal, ideally).
  url: z.string().url(),
  // When a human last confirmed this source said what we claim it says.
  accessed: z.coerce.date(),
});

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z
    .object({
      title: z.string().min(1),
      // Head/OG title for the city and region copies of this guide, which are
      // rendered as "<Place> — <title>". Set it when `title` is long enough
      // that the longest place name would push the pair past the ~60 characters
      // a result snippet shows (check:seo enforces the ceiling). Never shown
      // on the page: the visible <h1> is always `title`.
      shortTitle: z.string().min(1).max(40).optional(),
      // The lede printed under the <h1>. It is written for a reader who has
      // already arrived, so it may run longer than a search snippet shows.
      description: z.string().min(1).max(200),
      // The <meta name="description"> — written for a reader who has *not*
      // arrived, and capped so a result snippet shows all of it. The city and
      // region copies of this guide prefix it with the place name, so the
      // ceiling leaves room for the longest of those ("Friuli-Venezia Giulia — ").
      // check:seo enforces the composed length; this is the input budget.
      metaDescription: z.string().min(70).max(135).optional(),
      // Ordered position within its journey (1 = first step).
      step: z.number().int().positive(),
      journey: z.literal('eu-residency'),
      // Content language. English files live at the collection root; Italian
      // translations live under it/ (id `it/<slug>`).
      lang: z.enum(['en', 'it']).default('en'),
      // The trust signals, enforced.
      lastVerified: z.coerce.date(),
      reviewBy: z.coerce.date(),
      regionScope: z.enum(['national', 'regional', 'comune']).default('national'),
      sources: z
        .array(source)
        .min(1, 'Every guide page must cite at least one primary source.'),
      // Drives the interactive document checklist (rendered by GuideLayout).
      documents: z.array(z.string().min(1)).default([]),
      // Q→A blocks double as on-page content and FAQPage structured data.
      faq: z
        .array(z.object({ q: z.string().min(1), a: z.string().min(1) }))
        .default([]),
    })
    // A misspelled optional key must fail, not vanish. Without strict(), a
    // guide with `documnets:` builds green and silently ships an empty document
    // checklist — the exact silent-degradation this repo keeps hunting.
    .strict()
    .refine((data) => data.reviewBy > data.lastVerified, {
      message: 'reviewBy must be after lastVerified.',
      path: ['reviewBy'],
    }),
});

/**
 * Region-specific overlays for a given guide step. Same citability contract:
 * every overlay must carry its own sources + verification dates, because
 * region-specific facts (e.g. SSN voluntary-contribution rules) are exactly
 * the volatile ones most likely to drift.
 *
 * One file per region × guide at: src/content/region-notes/<region>/<guide>.md
 * The markdown body is the region-specific content; `region` and `guide` map
 * it to a region slug (see src/data/regions.ts) and a guide id.
 */
const regionNotes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/region-notes' }),
  schema: z
    .object({
      region: z.string().min(1),
      guide: z.string().min(1),
      lang: z.enum(['en', 'it']).default('en'),
      title: z.string().optional(),
      lastVerified: z.coerce.date(),
      reviewBy: z.coerce.date(),
      sources: z
        .array(source)
        .min(1, 'Every region note must cite at least one primary source.'),
    })
    // A misspelled optional key must fail, not vanish. Without strict(), a
    // guide with `documnets:` builds green and silently ships an empty document
    // checklist — the exact silent-degradation this repo keeps hunting.
    .strict()
    .refine((data) => data.reviewBy > data.lastVerified, {
      message: 'reviewBy must be after lastVerified.',
      path: ['reviewBy'],
    }),
});

/**
 * Comune-specific overlays for a given guide step. Same citability contract.
 * Used mainly for the anagrafe step (residency registration is run by each
 * comune's Ufficio Anagrafe, so the office, booking system and forms are local).
 *
 * One file per comune × guide at: src/content/comune-notes/<city>/<guide>.md
 */
const comuneNotes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/comune-notes' }),
  schema: z
    .object({
      city: z.string().min(1),
      guide: z.string().min(1),
      lang: z.enum(['en', 'it']).default('en'),
      title: z.string().optional(),
      lastVerified: z.coerce.date(),
      reviewBy: z.coerce.date(),
      sources: z
        .array(source)
        .min(1, 'Every comune note must cite at least one primary source.'),
    })
    // A misspelled optional key must fail, not vanish. Without strict(), a
    // guide with `documnets:` builds green and silently ships an empty document
    // checklist — the exact silent-degradation this repo keeps hunting.
    .strict()
    .refine((data) => data.reviewBy > data.lastVerified, {
      message: 'reviewBy must be after lastVerified.',
      path: ['reviewBy'],
    }),
});

export const collections = { guides, regionNotes, comuneNotes };
