export interface Region {
  /** URL slug — lowercase, hyphenated, no accents. */
  slug: string;
  /** English/Italian region name as displayed. */
  name: string;
  /** Regional capital (capoluogo di regione). */
  capoluogo: string;
}

/** The 20 regions of Italy. */
export const regions: Region[] = [
  { slug: 'abruzzo', name: 'Abruzzo', capoluogo: "L'Aquila" },
  { slug: 'basilicata', name: 'Basilicata', capoluogo: 'Potenza' },
  { slug: 'calabria', name: 'Calabria', capoluogo: 'Catanzaro' },
  { slug: 'campania', name: 'Campania', capoluogo: 'Napoli' },
  { slug: 'emilia-romagna', name: 'Emilia-Romagna', capoluogo: 'Bologna' },
  { slug: 'friuli-venezia-giulia', name: 'Friuli-Venezia Giulia', capoluogo: 'Trieste' },
  { slug: 'lazio', name: 'Lazio', capoluogo: 'Roma' },
  { slug: 'liguria', name: 'Liguria', capoluogo: 'Genova' },
  { slug: 'lombardia', name: 'Lombardia', capoluogo: 'Milano' },
  { slug: 'marche', name: 'Marche', capoluogo: 'Ancona' },
  { slug: 'molise', name: 'Molise', capoluogo: 'Campobasso' },
  { slug: 'piemonte', name: 'Piemonte', capoluogo: 'Torino' },
  { slug: 'puglia', name: 'Puglia', capoluogo: 'Bari' },
  { slug: 'sardegna', name: 'Sardegna', capoluogo: 'Cagliari' },
  { slug: 'sicilia', name: 'Sicilia', capoluogo: 'Palermo' },
  { slug: 'toscana', name: 'Toscana', capoluogo: 'Firenze' },
  { slug: 'trentino-alto-adige', name: 'Trentino-Alto Adige', capoluogo: 'Trento' },
  { slug: 'umbria', name: 'Umbria', capoluogo: 'Perugia' },
  { slug: 'valle-d-aosta', name: "Valle d'Aosta", capoluogo: 'Aosta' },
  { slug: 'veneto', name: 'Veneto', capoluogo: 'Venezia' },
];

const bySlug = new Map(regions.map((r) => [r.slug, r]));

export function getRegion(slug: string): Region | undefined {
  return bySlug.get(slug);
}
