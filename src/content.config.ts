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
      description: z.string().min(1).max(200),
      // Ordered position within its journey (1 = first step).
      step: z.number().int().positive(),
      journey: z.literal('eu-residency'),
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
    .refine((data) => data.reviewBy > data.lastVerified, {
      message: 'reviewBy must be after lastVerified.',
      path: ['reviewBy'],
    }),
});

export const collections = { guides };
