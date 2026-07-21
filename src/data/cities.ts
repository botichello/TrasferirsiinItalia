import { getRegion, type Region } from './regions';

export interface City {
  /** URL slug — lowercase, hyphenated, no accents. */
  slug: string;
  /** Display name. */
  name: string;
  /** Province sigla (e.g. RM, MI). */
  province: string;
  /** Region slug — must match an entry in regions.ts. */
  region: string;
}

/**
 * Curated set of comuni: every regional capital plus major cities and popular
 * relocation destinations, so the city selector covers all 20 regions. Not
 * exhaustive (Italy has ~7,900 comuni) — the model scales by adding entries
 * here and, optionally, a comune overlay under src/content/comune-notes/.
 */
export const cities: City[] = [
  // Abruzzo
  { slug: 'laquila', name: "L'Aquila", province: 'AQ', region: 'abruzzo' },
  { slug: 'pescara', name: 'Pescara', province: 'PE', region: 'abruzzo' },
  { slug: 'chieti', name: 'Chieti', province: 'CH', region: 'abruzzo' },
  { slug: 'teramo', name: 'Teramo', province: 'TE', region: 'abruzzo' },
  // Basilicata
  { slug: 'potenza', name: 'Potenza', province: 'PZ', region: 'basilicata' },
  { slug: 'matera', name: 'Matera', province: 'MT', region: 'basilicata' },
  // Calabria
  { slug: 'catanzaro', name: 'Catanzaro', province: 'CZ', region: 'calabria' },
  { slug: 'reggio-calabria', name: 'Reggio Calabria', province: 'RC', region: 'calabria' },
  { slug: 'cosenza', name: 'Cosenza', province: 'CS', region: 'calabria' },
  // Campania
  { slug: 'napoli', name: 'Napoli', province: 'NA', region: 'campania' },
  { slug: 'salerno', name: 'Salerno', province: 'SA', region: 'campania' },
  { slug: 'caserta', name: 'Caserta', province: 'CE', region: 'campania' },
  // Emilia-Romagna
  { slug: 'bologna', name: 'Bologna', province: 'BO', region: 'emilia-romagna' },
  { slug: 'modena', name: 'Modena', province: 'MO', region: 'emilia-romagna' },
  { slug: 'parma', name: 'Parma', province: 'PR', region: 'emilia-romagna' },
  { slug: 'reggio-emilia', name: 'Reggio Emilia', province: 'RE', region: 'emilia-romagna' },
  { slug: 'rimini', name: 'Rimini', province: 'RN', region: 'emilia-romagna' },
  { slug: 'ferrara', name: 'Ferrara', province: 'FE', region: 'emilia-romagna' },
  { slug: 'ravenna', name: 'Ravenna', province: 'RA', region: 'emilia-romagna' },
  // Friuli-Venezia Giulia
  { slug: 'trieste', name: 'Trieste', province: 'TS', region: 'friuli-venezia-giulia' },
  { slug: 'udine', name: 'Udine', province: 'UD', region: 'friuli-venezia-giulia' },
  { slug: 'pordenone', name: 'Pordenone', province: 'PN', region: 'friuli-venezia-giulia' },
  { slug: 'gorizia', name: 'Gorizia', province: 'GO', region: 'friuli-venezia-giulia' },
  // Lazio
  { slug: 'roma', name: 'Roma', province: 'RM', region: 'lazio' },
  { slug: 'latina', name: 'Latina', province: 'LT', region: 'lazio' },
  { slug: 'viterbo', name: 'Viterbo', province: 'VT', region: 'lazio' },
  // Liguria
  { slug: 'genova', name: 'Genova', province: 'GE', region: 'liguria' },
  { slug: 'la-spezia', name: 'La Spezia', province: 'SP', region: 'liguria' },
  { slug: 'sanremo', name: 'Sanremo', province: 'IM', region: 'liguria' },
  { slug: 'savona', name: 'Savona', province: 'SV', region: 'liguria' },
  // Lombardia
  { slug: 'milano', name: 'Milano', province: 'MI', region: 'lombardia' },
  { slug: 'bergamo', name: 'Bergamo', province: 'BG', region: 'lombardia' },
  { slug: 'brescia', name: 'Brescia', province: 'BS', region: 'lombardia' },
  { slug: 'como', name: 'Como', province: 'CO', region: 'lombardia' },
  { slug: 'monza', name: 'Monza', province: 'MB', region: 'lombardia' },
  { slug: 'pavia', name: 'Pavia', province: 'PV', region: 'lombardia' },
  // Marche
  { slug: 'ancona', name: 'Ancona', province: 'AN', region: 'marche' },
  { slug: 'pesaro', name: 'Pesaro', province: 'PU', region: 'marche' },
  { slug: 'macerata', name: 'Macerata', province: 'MC', region: 'marche' },
  // Molise
  { slug: 'campobasso', name: 'Campobasso', province: 'CB', region: 'molise' },
  { slug: 'isernia', name: 'Isernia', province: 'IS', region: 'molise' },
  // Piemonte
  { slug: 'torino', name: 'Torino', province: 'TO', region: 'piemonte' },
  { slug: 'novara', name: 'Novara', province: 'NO', region: 'piemonte' },
  { slug: 'cuneo', name: 'Cuneo', province: 'CN', region: 'piemonte' },
  { slug: 'alessandria', name: 'Alessandria', province: 'AL', region: 'piemonte' },
  // Puglia
  { slug: 'bari', name: 'Bari', province: 'BA', region: 'puglia' },
  { slug: 'lecce', name: 'Lecce', province: 'LE', region: 'puglia' },
  { slug: 'taranto', name: 'Taranto', province: 'TA', region: 'puglia' },
  { slug: 'brindisi', name: 'Brindisi', province: 'BR', region: 'puglia' },
  { slug: 'foggia', name: 'Foggia', province: 'FG', region: 'puglia' },
  // Sardegna
  { slug: 'cagliari', name: 'Cagliari', province: 'CA', region: 'sardegna' },
  { slug: 'sassari', name: 'Sassari', province: 'SS', region: 'sardegna' },
  { slug: 'olbia', name: 'Olbia', province: 'SS', region: 'sardegna' },
  { slug: 'nuoro', name: 'Nuoro', province: 'NU', region: 'sardegna' },
  // Sicilia
  { slug: 'palermo', name: 'Palermo', province: 'PA', region: 'sicilia' },
  { slug: 'catania', name: 'Catania', province: 'CT', region: 'sicilia' },
  { slug: 'messina', name: 'Messina', province: 'ME', region: 'sicilia' },
  { slug: 'siracusa', name: 'Siracusa', province: 'SR', region: 'sicilia' },
  { slug: 'ragusa', name: 'Ragusa', province: 'RG', region: 'sicilia' },
  // Toscana
  { slug: 'firenze', name: 'Firenze', province: 'FI', region: 'toscana' },
  { slug: 'pisa', name: 'Pisa', province: 'PI', region: 'toscana' },
  { slug: 'siena', name: 'Siena', province: 'SI', region: 'toscana' },
  { slug: 'lucca', name: 'Lucca', province: 'LU', region: 'toscana' },
  { slug: 'arezzo', name: 'Arezzo', province: 'AR', region: 'toscana' },
  { slug: 'livorno', name: 'Livorno', province: 'LI', region: 'toscana' },
  // Trentino-Alto Adige
  { slug: 'trento', name: 'Trento', province: 'TN', region: 'trentino-alto-adige' },
  { slug: 'bolzano', name: 'Bolzano', province: 'BZ', region: 'trentino-alto-adige' },
  // Umbria
  { slug: 'perugia', name: 'Perugia', province: 'PG', region: 'umbria' },
  { slug: 'terni', name: 'Terni', province: 'TR', region: 'umbria' },
  // Valle d'Aosta
  { slug: 'aosta', name: 'Aosta', province: 'AO', region: 'valle-d-aosta' },
  // Veneto
  { slug: 'venezia', name: 'Venezia', province: 'VE', region: 'veneto' },
  { slug: 'verona', name: 'Verona', province: 'VR', region: 'veneto' },
  { slug: 'padova', name: 'Padova', province: 'PD', region: 'veneto' },
  { slug: 'vicenza', name: 'Vicenza', province: 'VI', region: 'veneto' },
  { slug: 'treviso', name: 'Treviso', province: 'TV', region: 'veneto' },
];

const bySlug = new Map(cities.map((c) => [c.slug, c]));

export function getCity(slug: string): City | undefined {
  return bySlug.get(slug);
}

export function regionOf(city: City): Region | undefined {
  return getRegion(city.region);
}

/** Cities grouped by region (region name → cities), for grouped selectors. */
export function citiesByRegion(): { region: Region; cities: City[] }[] {
  const groups = new Map<string, City[]>();
  for (const c of cities) {
    if (!groups.has(c.region)) groups.set(c.region, []);
    groups.get(c.region)!.push(c);
  }
  return [...groups.entries()]
    .map(([slug, list]) => ({ region: getRegion(slug)!, cities: list }))
    .filter((g) => g.region)
    .sort((a, b) => a.region.name.localeCompare(b.region.name));
}
