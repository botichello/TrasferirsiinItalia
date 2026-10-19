/**
 * Every source URL the site cites, and where each one is cited.
 *
 * Citations live in four places: the content collections (guides and their
 * region/comune overlays, as `sources[].url` in frontmatter), the `sources`
 * arrays inside the orientation pages under src/pages, the source-country
 * notes in src/data/source-countries.mjs, and the primary text behind each
 * tracked figure in src/data/figures.mjs.
 *
 * Shared because two scripts need the same answer and had drifted apart:
 * check-links learned to read all four, while fetch-archives went on reading
 * only the first — so the 140-odd orientation, source-country and figure
 * citations never gained a Wayback fallback, and /sources listed them without
 * one. One collector means a fifth location only has to be taught once.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const CONTENT_DIRS = ['src/content/guides/', 'src/content/region-notes/', 'src/content/comune-notes/'].map((d) =>
  fileURLToPath(new URL(d, root)),
);

/** Recursively collect all .md files under a directory. */
async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * @returns {Promise<{
 *   urlToFiles: Map<string, Set<string>>,
 *   counts: { contentFiles: number, orientationPages: number, noteSources: number, figures: number },
 * }>}
 */
export async function collectCitedUrls() {
  const urlToFiles = new Map();
  const cite = (url, where) => {
    if (!urlToFiles.has(url)) urlToFiles.set(url, new Set());
    urlToFiles.get(url).add(where);
  };

  const files = (await Promise.all(CONTENT_DIRS.map(walk))).flat();
  const urlRe = /^\s*url:\s*(['"]?)(https?:\/\/[^'"\s]+)\1/gm;
  for (const path of files) {
    const raw = await readFile(path, 'utf8');
    const file = relative(process.cwd(), path);
    for (const m of raw.matchAll(urlRe)) cite(m[2], file);
  }

  // Orientation pages keep their `sources` arrays in the .astro file; they use
  // the same `url:` shape, so read them straight from the registry.
  const { orientationPages } = await import(new URL('src/data/orientation-pages.mjs', root));
  const astroUrlRe = /\burl:\s*(['"])(https?:\/\/[^'"\s]+)\1/g;
  for (const entry of orientationPages) {
    for (const rel of [entry.en, entry.it]) {
      let raw;
      try {
        raw = await readFile(new URL(rel, root), 'utf8');
      } catch {
        continue; // check-freshness owns the "registered page missing" error
      }
      for (const m of raw.matchAll(astroUrlRe)) cite(m[2], rel);
    }
  }

  const { sourceCountries } = await import(new URL('src/data/source-countries.mjs', root));
  let noteSources = 0;
  for (const country of sourceCountries) {
    for (const note of country.notes) {
      for (const src of note.sources ?? []) {
        noteSources++;
        cite(src.url, `source-countries: ${country.slug} → ${note.module}`);
      }
    }
  }

  // If the text a tracked figure was read in rots, the next re-verification has
  // nothing to check the number against — so it is a citation like any other.
  const { figures } = await import(new URL('src/data/figures.mjs', root));
  for (const fig of figures) cite(fig.source.url, `figures: ${fig.id}`);

  return {
    urlToFiles,
    counts: {
      contentFiles: files.length,
      orientationPages: orientationPages.length * 2,
      noteSources,
      figures: figures.length,
    },
  };
}
