/**
 * schema.org node builders.
 *
 * Every page emits exactly one `<script type="application/ld+json">` holding a
 * single `@graph`, and every node in it carries an `@id`. That matters more
 * here than on most sites: the GEO bet is that an assistant can read a page as
 * data, and a consumer that meets four sibling script tags has to guess which
 * anonymous `Organization` is the publisher of which node. With `@id`s it does
 * not guess — `publisher` is a pointer, the same Organization resolves from
 * every page, and the graph says which node is the page and which is the thing
 * the page is about.
 *
 * Ids are fragments on the page's own canonical URL, so they are globally
 * unique without a registry and stay stable as long as the URL does.
 */

/** A schema.org node. Deliberately loose: the shapes vary by @type. */
export type SchemaNode = Record<string, unknown>;

/** `{"@id": "…"}` — a reference to another node in the graph. */
export const ref = (id: string) => ({ '@id': id });

export const ids = {
  organization: (site: string) => `${site}#organization`,
  website: (site: string) => `${site}#website`,
  webPage: (canonical: string) => `${canonical}#webpage`,
  breadcrumb: (canonical: string) => `${canonical}#breadcrumb`,
  article: (canonical: string) => `${canonical}#article`,
  howTo: (canonical: string) => `${canonical}#howto`,
  faq: (canonical: string) => `${canonical}#faq`,
};

export interface Crumb {
  name: string;
  url: string;
}

export const breadcrumbNode = (canonical: string, crumbs: Crumb[]): SchemaNode => ({
  '@type': 'BreadcrumbList',
  '@id': ids.breadcrumb(canonical),
  itemListElement: crumbs.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: c.url,
  })),
});

export interface GuideNodeInput {
  canonical: string;
  site: string;
  title: string;
  description: string;
  /** ISO date (yyyy-mm-dd) the page was last verified. */
  dateModified: string;
  /** ISO date (yyyy-mm-dd) the page first shipped, when git history knows it. */
  datePublished?: string;
  inLanguage: string;
  /** Section headings of the guide, emitted as HowTo steps. */
  steps?: string[];
  faq?: { q: string; a: string }[];
}

/**
 * The nodes specific to a journey guide: the procedure it describes, and its
 * questions. Google retired HowTo rich results in 2023, so this is no longer a
 * play for a SERP feature — it stays because a procedure with ordered, named
 * steps is the single most useful thing a page can hand an assistant that was
 * asked "how do I register my residency in Italy".
 */
export function guideNodes({
  canonical,
  site,
  title,
  description,
  dateModified,
  datePublished,
  inLanguage,
  steps = [],
  faq = [],
}: GuideNodeInput): SchemaNode[] {
  const nodes: SchemaNode[] = [
    {
      '@type': 'HowTo',
      '@id': ids.howTo(canonical),
      name: title,
      description,
      url: canonical,
      inLanguage,
      dateModified,
      ...(datePublished && { datePublished }),
      mainEntityOfPage: ref(ids.webPage(canonical)),
      publisher: ref(ids.organization(site)),
      ...(steps.length > 0 && {
        step: steps.map((name, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name,
          url: canonical,
        })),
      }),
    },
  ];

  if (faq.length > 0) {
    nodes.push({
      '@type': 'FAQPage',
      '@id': ids.faq(canonical),
      url: canonical,
      inLanguage,
      isPartOf: ref(ids.website(site)),
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }

  return nodes;
}
