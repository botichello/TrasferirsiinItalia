import type { CollectionEntry } from 'astro:content';

/** Canonical step slug for a guide entry (Italian ids are prefixed `it/`). */
export function guideSlug(entry: CollectionEntry<'guides'>): string {
  return entry.id.replace(/^it\//, '');
}
