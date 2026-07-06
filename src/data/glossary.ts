/**
 * Bilingual glossary of the bureaucratic terms a newcomer meets. Rendered at
 * /glossary (EN) and /it/glossary (IT) with schema.org DefinedTermSet JSON-LD,
 * so both humans and AI assistants can cite one canonical definition per term.
 * Definitions are deliberately short; each links into the guide that covers it.
 */
export interface GlossaryTerm {
  /** URL anchor slug. */
  slug: string;
  /** The Italian term as written. */
  term: string;
  en: string;
  it: string;
  /** Root-relative guide path (unprefixed; the IT page adds /it). */
  guide?: string;
}

export const glossary: GlossaryTerm[] = [
  {
    slug: 'codice-fiscale',
    term: 'Codice fiscale',
    en: 'Your Italian tax identification code — 16 characters derived from your name, birth date/place and sex. Free, issued by the Agenzia delle Entrate, and required for almost everything (contracts, bank, lease, health service).',
    it: 'Il codice identificativo fiscale italiano — 16 caratteri derivati da nome, data e luogo di nascita e sesso. Gratuito, rilasciato dall’Agenzia delle Entrate e necessario per quasi tutto (contratti, banca, affitto, sanità).',
    guide: '/eu-citizens/residency/codice-fiscale',
  },
  {
    slug: 'anagrafe',
    term: 'Anagrafe',
    en: 'The population registry kept by each comune. "Iscrizione anagrafica" — registering there — is how an EU citizen establishes legal residency for stays over three months.',
    it: 'Il registro della popolazione tenuto da ogni Comune. L’“iscrizione anagrafica” è il modo in cui un cittadino UE stabilisce la residenza legale per soggiorni oltre i tre mesi.',
    guide: '/eu-citizens/residency/iscrizione-anagrafica',
  },
  {
    slug: 'attestazione-di-iscrizione-anagrafica',
    term: 'Attestazione di iscrizione anagrafica',
    en: 'The certificate confirming an EU citizen is registered as a resident. It is the EU citizen’s equivalent of a residence document — no permesso di soggiorno is needed.',
    it: 'Il certificato che conferma l’iscrizione anagrafica di un cittadino UE. È l’equivalente del titolo di soggiorno per i cittadini UE — non serve il permesso di soggiorno.',
    guide: '/eu-citizens/residency/iscrizione-anagrafica',
  },
  {
    slug: 'residenza-domicilio',
    term: 'Residenza vs. domicilio',
    en: 'Residenza is where you habitually live and are registered at the anagrafe (a legal status with checks). Domicilio is merely where you can be reached — declaring a domicilio does not make you a resident.',
    it: 'La residenza è dove vivi abitualmente e sei iscritto in anagrafe (uno status legale, con controlli). Il domicilio è solo il luogo dove sei reperibile — dichiarare un domicilio non ti rende residente.',
    guide: '/eu-citizens/residency/iscrizione-anagrafica',
  },
  {
    slug: 'comune',
    term: 'Comune',
    en: 'The municipality — Italy’s basic administrative unit (~7,900 of them). Residency, ID cards (CIE) and civil records are handled by your comune, so office, forms and booking systems are local.',
    it: 'L’unità amministrativa di base italiana (circa 7.900). Residenza, carta d’identità (CIE) e stato civile sono gestiti dal tuo Comune, quindi uffici, moduli e prenotazioni sono locali.',
    guide: '/cities',
  },
  {
    slug: 'anpr',
    term: 'ANPR',
    en: 'Anagrafe Nazionale della Popolazione Residente — the national resident-population database. Its portal (with SPID/CIE) lets you file residence declarations and download registry certificates online.',
    it: 'Anagrafe Nazionale della Popolazione Residente — la banca dati nazionale dei residenti. Il suo portale (con SPID/CIE) permette di presentare dichiarazioni di residenza e scaricare certificati anagrafici online.',
    guide: '/eu-citizens/residency/iscrizione-anagrafica',
  },
  {
    slug: 'ssn',
    term: 'SSN (Servizio Sanitario Nazionale)',
    en: 'Italy’s national health service, delivered regionally. Workers enrol free; economically inactive residents enrol voluntarily (minimum €2,000/year since 2024) or hold private insurance.',
    it: 'Il servizio sanitario nazionale italiano, erogato a livello regionale. I lavoratori si iscrivono gratis; i non attivi si iscrivono volontariamente (minimo 2.000 €/anno dal 2024) o hanno un’assicurazione privata.',
    guide: '/eu-citizens/residency/servizio-sanitario',
  },
  {
    slug: 'asl',
    term: 'ASL / AUSL / ASP / ATS / ASST',
    en: 'The local health authority that runs SSN services for your address. The name varies by region (ASL in most, AUSL in Emilia-Romagna, ASP in Sicilia, ATS/ASST in Lombardia…) — the role is the same: it is where you enrol and choose a doctor.',
    it: 'L’azienda sanitaria locale che eroga i servizi SSN per il tuo indirizzo. Il nome varia per regione (ASL, AUSL in Emilia-Romagna, ASP in Sicilia, ATS/ASST in Lombardia…) — il ruolo è lo stesso: è dove ti iscrivi e scegli il medico.',
    guide: '/regions',
  },
  {
    slug: 'tessera-sanitaria',
    term: 'Tessera sanitaria',
    en: 'The plastic health card issued once you are enrolled in the SSN. It carries your codice fiscale and is asked for constantly — at the doctor, the pharmacy, and many counters.',
    it: 'La tessera plastificata rilasciata una volta iscritto al SSN. Riporta il codice fiscale ed è richiesta di continuo — dal medico, in farmacia e a molti sportelli.',
    guide: '/eu-citizens/residency/servizio-sanitario',
  },
  {
    slug: 'medico-di-base',
    term: 'Medico di base',
    en: 'Your general practitioner within the SSN (also "medico di medicina generale"). You choose one from your health authority’s list when you enrol; visits are free at the point of care.',
    it: 'Il medico di medicina generale nel SSN. Lo scegli dall’elenco della tua azienda sanitaria al momento dell’iscrizione; le visite sono gratuite.',
    guide: '/eu-citizens/residency/servizio-sanitario',
  },
  {
    slug: 'team-ehic',
    term: 'TEAM / EHIC',
    en: 'The European Health Insurance Card (Tessera Europea di Assicurazione Malattia). Covers necessary care during temporary stays — it is not a substitute for SSN enrolment once you are a resident.',
    it: 'La Tessera Europea di Assicurazione Malattia. Copre le cure necessarie durante soggiorni temporanei — non sostituisce l’iscrizione al SSN una volta residente.',
    guide: '/eu-citizens/residency/servizio-sanitario',
  },
  {
    slug: 'spid',
    term: 'SPID',
    en: 'Sistema Pubblico di Identità Digitale — Italy’s digital-identity login, issued by accredited providers. Free, but it requires an Italian-issued ID document, so newcomers usually get the CIE first.',
    it: 'Sistema Pubblico di Identità Digitale — l’accesso con identità digitale, rilasciato da gestori accreditati. Gratuito, ma richiede un documento d’identità italiano: chi arriva di solito ottiene prima la CIE.',
    guide: '/eu-citizens/residency/identita-digitale',
  },
  {
    slug: 'cie',
    term: 'CIE (Carta d’Identità Elettronica)',
    en: 'The Italian electronic ID card, issued by your comune (~€22, mailed in ~6 working days). It is both your physical ID and a top-level digital identity ("Entra con CIE").',
    it: 'La carta d’identità elettronica, rilasciata dal Comune (~22 €, spedita in ~6 giorni lavorativi). È sia il documento fisico sia un’identità digitale di livello massimo (“Entra con CIE”).',
    guide: '/eu-citizens/residency/identita-digitale',
  },
  {
    slug: 'cns',
    term: 'CNS',
    en: 'Carta Nazionale dei Servizi — a smart card (often your tessera sanitaria) that can authenticate you to public services with a reader and PIN. Largely superseded by SPID/CIE for everyday use.',
    it: 'Carta Nazionale dei Servizi — una smart card (spesso la tessera sanitaria) che permette l’autenticazione ai servizi pubblici con lettore e PIN. Per l’uso quotidiano è ormai affiancata da SPID/CIE.',
    guide: '/eu-citizens/residency/identita-digitale',
  },
  {
    slug: 'pec',
    term: 'PEC',
    en: 'Posta Elettronica Certificata — certified email with legal value, the standard way to file documents with Italian public offices remotely (many comuni accept residence declarations only by PEC or online portal).',
    it: 'Posta Elettronica Certificata — email con valore legale, il canale standard per inviare documenti agli uffici pubblici (molti Comuni accettano le dichiarazioni di residenza solo via PEC o portale).',
    guide: '/eu-citizens/residency/iscrizione-anagrafica',
  },
  {
    slug: 'autocertificazione',
    term: 'Autocertificazione',
    en: 'A self-declaration that replaces many certificates when dealing with public offices — you declare a fact (residence, birth, family status) under your own responsibility instead of producing the document.',
    it: 'Una dichiarazione sostitutiva che rimpiazza molti certificati nei rapporti con gli uffici pubblici: dichiari un fatto (residenza, nascita, stato di famiglia) sotto la tua responsabilità invece di produrre il documento.',
  },
  {
    slug: 'marca-da-bollo',
    term: 'Marca da bollo',
    en: 'A €16 revenue stamp (bought at a tabaccheria) required on many certificates and applications — e.g. some comuni require one on the attestazione di iscrizione anagrafica.',
    it: 'La marca da 16 € (si compra in tabaccheria) richiesta su molti certificati e istanze — ad esempio alcuni Comuni la richiedono sull’attestazione di iscrizione anagrafica.',
  },
  {
    slug: 'f24',
    term: 'Modello F24',
    en: 'The standard form for paying taxes and public contributions (including the voluntary SSN contribution). Paid via bank/home banking; the receipt is your proof of payment.',
    it: 'Il modulo standard per pagare imposte e contributi pubblici (compreso il contributo volontario al SSN). Si paga in banca o con l’home banking; la ricevuta è la prova del versamento.',
    guide: '/eu-citizens/residency/servizio-sanitario',
  },
  {
    slug: 'permesso-carta-di-soggiorno',
    term: 'Permesso di soggiorno / Carta di soggiorno',
    en: 'Residence permits for non-EU citizens. EU citizens do NOT need one — they register at the anagrafe instead. The "carta di soggiorno" concerns non-EU family members of EU citizens.',
    it: 'I titoli di soggiorno per cittadini non UE. I cittadini UE NON ne hanno bisogno — si iscrivono all’anagrafe. La “carta di soggiorno” riguarda i familiari non UE di cittadini UE.',
    guide: '/eu-citizens/residency/iscrizione-anagrafica',
  },
  {
    slug: 'allegato-b',
    term: 'Allegato B',
    en: 'The attachment to the ministerial residence-declaration form listing the documents EU citizens must provide (work, study or resources + health cover). Comuni reference it constantly.',
    it: 'L’allegato al modulo ministeriale di dichiarazione di residenza che elenca i documenti per i cittadini UE (lavoro, studio o risorse + copertura sanitaria). I Comuni vi fanno costante riferimento.',
    guide: '/eu-citizens/residency/iscrizione-anagrafica',
  },
  {
    slug: 'partita-iva',
    term: 'Partita IVA',
    en: 'The VAT number identifying a self-employed person or business. For a self-employed EU citizen it is also the basis for anagrafe registration and free SSN enrolment.',
    it: 'Il numero di partita IVA che identifica un lavoratore autonomo o un’impresa. Per un cittadino UE autonomo è anche la base per l’iscrizione anagrafica e l’iscrizione gratuita al SSN.',
    guide: '/eu-citizens/residency/servizio-sanitario',
  },
  {
    slug: 'questura',
    term: 'Questura / Prefettura',
    en: 'Provincial police headquarters (questura) and the state’s provincial office (prefettura). Central to non-EU immigration procedures; EU citizens rarely need them for residency itself.',
    it: 'La questura (polizia provinciale) e la prefettura (ufficio territoriale dello Stato). Centrali nelle procedure per non UE; i cittadini UE raramente ne hanno bisogno per la residenza.',
  },
];
