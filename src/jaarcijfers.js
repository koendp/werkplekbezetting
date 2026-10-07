/**
 * Rekent een jaar sensorgegevens van één groep werkplekken om naar de cijfers
 * voor het jaarrapport. Gedeeld door src/w33-jaar.js (één wijk) en
 * src/alle-wijken.js (alle groepen na elkaar).
 */

import { bereken, naarLokaal } from './aggregate.js';

/** Twaalf volledige maanden, zodat juli en augustus er helemaal in of uit vallen. */
export const VAN = Date.parse('2025-10-01T00:00:00+02:00');
export const TOT = Date.parse('2026-10-01T00:00:00+02:00');

/** Aanloop om de begintoestand van elke werkplek te kennen. */
export const AANLOOP_DAGEN = 21;

export const START_UUR = 8;
export const EIND_UUR = 17;

export const ZOMERMAANDEN = [7, 8]; // juli en augustus

/**
 * Dagen waarop er niet of nauwelijks gewerkt werd. Dit zijn de Belgische
 * feestdagen plus de collectieve sluiting tussen Kerstmis en Nieuwjaar.
 * Ze worden niet weggelaten uit het gevraagde gemiddelde, maar wel apart
 * gehouden, want ze drukken het cijfer zonder dat er iets over het gebruik van
 * de werkplekken gezegd wordt.
 */
export const GESLOTEN = {
  '2025-11-11': 'Wapenstilstand',
  '2025-12-24': 'kerstsluiting',
  '2025-12-25': 'Kerstmis',
  '2025-12-26': 'kerstsluiting',
  '2025-12-29': 'kerstsluiting',
  '2025-12-30': 'kerstsluiting',
  '2025-12-31': 'kerstsluiting',
  '2026-01-01': 'Nieuwjaar',
  '2026-01-02': 'kerstsluiting',
  '2026-04-06': 'paasmaandag',
  '2026-05-01': 'Dag van de Arbeid',
  '2026-05-14': 'Onze-Lieve-Heer-Hemelvaart',
  '2026-05-15': 'brugdag na Hemelvaart',
  '2026-05-25': 'pinkstermaandag',
  '2026-07-20': 'brugdag voor 21 juli',
  '2026-07-21': 'nationale feestdag',
};

/** Een plek die zo lang onafgebroken bezet blijft, hangt vast. Een nacht
 * doorlopen gebeurt wel eens (een jas over de stoel), drie dagen niet. */
const VAST_NA_UREN = 72;

const BINS_PER_DAG = 96;
const DREMPEL = 0.5; // een halve blok van een kwartier

const gemiddelde = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const percentiel = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const maandVan = (datum) => Number(datum.slice(5, 7));
const isZomer = (datum) => ZOMERMAANDEN.includes(maandVan(datum));
const lokaleDatum = (ms) => new Date(naarLokaal(ms)).toISOString().slice(0, 10);

/** Rekent de kerncijfers uit voor een deelverzameling werkdagen. */
function vatSamen(dagen, aantalPlekken) {
  const gem = dagen.map((d) => d.gemiddeld);
  const piek = dagen.map((d) => d.piek);
  const gebruikt = dagen.map((d) => d.gebruikt);
  return {
    werkdagen: dagen.length,
    gebruiktGemiddeld: +gemiddelde(gebruikt).toFixed(1),
    gebruiktHoogste: Math.max(...gebruikt, 0),
    gebruiktLaagste: gebruikt.length ? Math.min(...gebruikt) : 0,
    volledigeDagen: gebruikt.filter((g) => g >= aantalPlekken).length,
    gemiddeld: +gemiddelde(gem).toFixed(2),
    gemiddeldeGraad: +(gemiddelde(gem) / aantalPlekken).toFixed(4),
    mediaan: +percentiel(gem, 50).toFixed(2),
    laagste: +Math.min(...gem, Infinity).toFixed(2),
    hoogste: +Math.max(...gem, 0).toFixed(2),
    piekGemiddeld: +gemiddelde(piek).toFixed(2),
    piekHoogste: +Math.max(...piek, 0).toFixed(2),
    piekGraad: +(Math.max(...piek, 0) / aantalPlekken).toFixed(4),
    piekP95: +percentiel(piek, 95).toFixed(2),
  };
}

/** Gemiddelde per weekdag en per uur, afgeleid uit het dagverloop. */
function profielen(dagen, aantalPlekken) {
  const perWeekdag = Array.from({ length: 5 }, () => ({ gem: [], piek: [], gebruikt: [], piekUren: [] }));
  const perUur = Array.from({ length: 24 }, () => []);
  const perWeekdagUur = Array.from({ length: 5 }, () => Array.from({ length: 24 }, () => []));

  for (const d of dagen) {
    const w = perWeekdag[d.weekdag];
    w.gem.push(d.gemiddeld);
    w.piek.push(d.piek);
    w.gebruikt.push(d.gebruikt);
    w.piekUren.push(d.piekUur);
    for (let u = 0; u < 24; u++) {
      const uurgemiddelde = gemiddelde(d.verloop.slice(u * 4, u * 4 + 4));
      perUur[u].push(uurgemiddelde);
      perWeekdagUur[d.weekdag][u].push(uurgemiddelde);
    }
  }

  /** Het uur dat het vaakst het drukste uur van de dag was. */
  const vaakstePiekuur = (uren) => {
    if (!uren.length) return null;
    const tel = new Map();
    for (const u of uren) tel.set(u, (tel.get(u) ?? 0) + 1);
    return [...tel].sort((a, b) => b[1] - a[1])[0][0];
  };

  return {
    perWeekdag: perWeekdag.map((w, i) => ({
      weekdag: i,
      dagen: w.gem.length,
      gemiddeld: +gemiddelde(w.gem).toFixed(2),
      graad: +(gemiddelde(w.gem) / aantalPlekken).toFixed(4),
      piek: +gemiddelde(w.piek).toFixed(2),
      piekHoogste: +Math.max(...w.piek, 0).toFixed(2),
      // Verschillende plekken die in de loop van de dag gebruikt werden.
      gebruiktGemiddeld: +gemiddelde(w.gebruikt).toFixed(1),
      gebruiktHoogste: Math.max(...w.gebruikt, 0),
      gebruiktLaagste: w.gebruikt.length ? Math.min(...w.gebruikt) : 0,
      volledigeDagen: w.gebruikt.filter((g) => g >= aantalPlekken).length,
      druksteUur: vaakstePiekuur(w.piekUren),
    })),
    perUur: perUur.map((v) => +gemiddelde(v).toFixed(2)),
    perWeekdagUur: perWeekdagUur.map((rij) => rij.map((v) => +gemiddelde(v).toFixed(2))),
  };
}

/**
 * Controleert of de metingen van een groep te vertrouwen zijn.
 *
 * Drie dingen kunnen een wijk drukker of rustiger laten lijken dan ze is:
 * een sensor die op bezet blijft hangen, een sensor die maandenlang zwijgt, en
 * dagen waarop van de hele groep niets binnenkwam. De dagelijkse batterijmelding
 * dient als hartslag: komt die binnen, dan leefde de sensor, ook als niemand er
 * zat.
 */
function controleer(r, werkplekken, ruwe, hartslagen, maanden) {
  const werkdagIndex = r.dagen.map((d, i) => (d.werkdag ? i : -1)).filter((i) => i >= 0);
  const weekendIndex = r.dagen.map((d, i) => (d.werkdag ? -1 : i)).filter((i) => i >= 0);

  // Welke dagen kwam er van elke plek iets binnen, en welke maanden?
  const dagMetMelding = new Set();
  const perPlek = werkplekken.map((wp) => {
    const bezetMaanden = new Set();
    const hartMaanden = new Set();
    const hartDagen = new Set();
    for (const e of ruwe[wp.id] ?? []) {
      const t = Date.parse(e.data.deskOccupancy.updateTime || e.timestamp);
      if (t < VAN || t >= TOT) continue;
      const datum = lokaleDatum(t);
      bezetMaanden.add(datum.slice(0, 7));
      dagMetMelding.add(datum);
    }
    for (const t of hartslagen?.[wp.id] ?? []) {
      if (t < VAN || t >= TOT) continue;
      const datum = lokaleDatum(t);
      hartMaanden.add(datum.slice(0, 7));
      hartDagen.add(datum);
      dagMetMelding.add(datum);
    }
    return { naam: wp.naam, bezetMaanden, hartMaanden, hartDagen };
  });

  // Vastgelopen sensoren: lang onafgebroken bezet, of bezet in het weekend.
  const vastePlekken = [];
  r.perWerkplek.forEach((wp) => {
    let reeks = 0;
    let langste = 0;
    let einde = 0;
    wp.bins.forEach((v, b) => {
      reeks = v >= 0.999 ? reeks + 1 : 0;
      if (reeks > langste) { langste = reeks; einde = b; }
    });
    let weekendSom = 0;
    for (const d of weekendIndex) {
      for (let b = 0; b < BINS_PER_DAG; b++) weekendSom += wp.bins[d * BINS_PER_DAG + b];
    }
    const weekendGraad = weekendSom / (weekendIndex.length * BINS_PER_DAG || 1);
    const langsteUren = langste / 4;
    if (langsteUren >= VAST_NA_UREN) {
      vastePlekken.push({
        naam: wp.naam,
        langsteUren: +langsteUren.toFixed(0),
        vanaf: r.dagen[Math.floor((einde - langste + 1) / BINS_PER_DAG)].datum,
        weekendGraad: +weekendGraad.toFixed(3),
      });
    }
  });

  // Sensoren die een hele maand zwegen.
  const zwijgend = [];
  const zonderBezetting = [];
  for (const p of perPlek) {
    const stil = maanden.filter((m) => !p.hartMaanden.has(m) && !p.bezetMaanden.has(m));
    if (stil.length) zwijgend.push({ naam: p.naam, maanden: stil });
    const leeg = maanden.filter((m) => p.hartMaanden.has(m) && !p.bezetMaanden.has(m));
    if (leeg.length) zonderBezetting.push({ naam: p.naam, maanden: leeg });
  }

  // Zwijgende sensoren per maand, om te zien wanneer het begon.
  const zwijgendPerMaand = maanden.map((m) => ({
    maand: m,
    aantal: perPlek.filter((p) => !p.hartMaanden.has(m) && !p.bezetMaanden.has(m)).length,
  }));

  // Werkdagen waarop van de hele groep niets binnenkwam, ook geen hartslag.
  const dagenZonderMeting = werkdagIndex
    .map((i) => r.dagen[i].datum)
    .filter((datum) => !dagMetMelding.has(datum))
    .map((datum) => ({ datum, gesloten: GESLOTEN[datum] ?? null }));

  // Gemiddeld aantal sensoren met hartslag per werkdag.
  const levendPerDag = werkdagIndex.map((i) => perPlek.filter((p) => p.hartDagen.has(r.dagen[i].datum)).length);

  const weekenddagen = weekendIndex.map((i) => r.perDag[i].gemiddeld);
  const weekendGemiddeld = +gemiddelde(weekenddagen).toFixed(2);

  const nooitGebruikt = r.perWerkplek.filter((w) => w.dagenGebruikt === 0).map((w) => w.naam);

  return {
    weekendGemiddeld,
    weekendHoogste: +Math.max(...weekenddagen, 0).toFixed(2),
    vastePlekken,
    zwijgend,
    zwijgendPerMaand,
    zonderBezetting,
    dagenZonderMeting,
    levendGemiddeld: +gemiddelde(levendPerDag).toFixed(1),
    nooitGebruikt,
    metHartslag: Boolean(hartslagen),
  };
}

/**
 * Van ruwe gebeurtenissen naar alle cijfers van het jaarrapport.
 *
 * @param {string} wijk naam van de groep
 * @param {Array} werkplekken ontlede toestellen van die groep
 * @param {Object} ruwe toestel-id naar lijst bezettingsgebeurtenissen
 * @param {Object} [hartslagen] toestel-id naar lijst tijdstippen (ms) van batterijmeldingen
 */
export function berekenJaar(wijk, werkplekken, ruwe, hartslagen = null) {
  const events = new Map(Object.entries(ruwe));
  const r = bereken(werkplekken, events, { van: VAN, tot: TOT, startUur: START_UUR, eindUur: EIND_UUR });
  const aantalPlekken = werkplekken.length;

  /**
   * Per dag: welke werkplekken waren er die dag in gebruik?
   *
   * Dit is iets anders dan de piek. De piek telt hoeveel plekken op hetzelfde
   * moment bezet waren; dit telt hoeveel verschillende plekken er in de loop van
   * de dag aan bod kwamen. Een plek telt mee vanaf een kwartier gebruik, dezelfde
   * drempel die ook voor "dagen gebruikt" per werkplek geldt.
   */
  const gebruikPerDag = r.dagen.map(() => 0);
  const gebruikPerWerkplek = r.perWerkplek.map(() => Array.from({ length: 7 }, () => 0));

  r.perWerkplek.forEach((wp, wi) => {
    for (let d = 0; d < r.dagen.length; d++) {
      let som = 0;
      for (let b = 0; b < BINS_PER_DAG; b++) som += wp.bins[d * BINS_PER_DAG + b];
      if (som > DREMPEL) {
        gebruikPerDag[d]++;
        gebruikPerWerkplek[wi][r.dagen[d].weekdag]++;
      }
    }
  });

  /** Het uur waarop de bezetting die dag het hoogst lag. */
  const piekUurPerDag = r.perDag.map((d) => {
    let beste = 0;
    let max = -1;
    for (let b = 0; b < d.verloop.length; b++) {
      if (d.verloop[b] > max) { max = d.verloop[b]; beste = b; }
    }
    return Math.floor(beste / 4);
  });

  r.perDag.forEach((d, i) => {
    d.gebruikt = gebruikPerDag[i];
    d.piekUur = piekUurPerDag[i];
  });

  const werkdagen = r.perDag.filter((d) => d.werkdag);
  const zonderZomer = werkdagen.filter((d) => !isZomer(d.datum));
  const alleenZomer = werkdagen.filter((d) => isZomer(d.datum));

  const open = werkdagen.filter((d) => !GESLOTEN[d.datum]);
  const openZonderZomer = open.filter((d) => !isZomer(d.datum));

  // Per maand, zodat het seizoenspatroon zichtbaar wordt.
  const perMaand = new Map();
  for (const d of werkdagen) {
    const m = d.datum.slice(0, 7);
    if (!perMaand.has(m)) perMaand.set(m, []);
    perMaand.get(m).push(d);
  }

  const kwaliteit = controleer(r, werkplekken, ruwe, hartslagen, [...perMaand.keys()].sort());

  return {
    wijk,
    gemaakt: new Date().toISOString(),
    van: new Date(VAN).toISOString(),
    tot: new Date(TOT).toISOString(),
    startUur: START_UUR,
    eindUur: EIND_UUR,
    aantalPlekken,

    heelJaar: { ...vatSamen(werkdagen, aantalPlekken), ...profielen(werkdagen, aantalPlekken) },
    zonderZomer: { ...vatSamen(zonderZomer, aantalPlekken), ...profielen(zonderZomer, aantalPlekken) },
    alleenZomer: { ...vatSamen(alleenZomer, aantalPlekken), ...profielen(alleenZomer, aantalPlekken) },

    // Zelfde cijfers, maar zonder feestdagen en de kerstsluiting.
    open: { ...vatSamen(open, aantalPlekken), ...profielen(open, aantalPlekken) },
    openZonderZomer: { ...vatSamen(openZonderZomer, aantalPlekken), ...profielen(openZonderZomer, aantalPlekken) },

    geslotenDagen: Object.entries(GESLOTEN)
      .filter(([datum]) => werkdagen.some((d) => d.datum === datum))
      .map(([datum, reden]) => ({ datum, reden, gemiddeld: werkdagen.find((d) => d.datum === datum).gemiddeld })),

    perMaand: [...perMaand].sort().map(([maand, dagen]) => ({
      maand,
      zomer: ZOMERMAANDEN.includes(Number(maand.slice(5, 7))),
      werkdagen: dagen.length,
      gemiddeld: +gemiddelde(dagen.map((d) => d.gemiddeld)).toFixed(2),
      graad: +(gemiddelde(dagen.map((d) => d.gemiddeld)) / aantalPlekken).toFixed(4),
      piek: +Math.max(...dagen.map((d) => d.piek), 0).toFixed(2),
    })),

    perDag: r.perDag.map((d) => ({
      datum: d.datum,
      weekdag: d.weekdag,
      werkdag: d.werkdag,
      zomer: isZomer(d.datum),
      gesloten: GESLOTEN[d.datum] ?? null,
      gemiddeld: d.gemiddeld,
      graad: d.bezettingsgraad,
      piek: d.piek,
      gebruikt: d.gebruikt,
      piekUur: d.piekUur,
    })),

    perWerkplek: r.perWerkplek.map(({ bins, ...rest }, i) => ({
      ...rest,
      // Op hoeveel maandagen, dinsdagen enzovoort was deze plek in gebruik.
      perWeekdag: gebruikPerWerkplek[i].slice(0, 5),
    })),

    // Hoeveel maandagen, dinsdagen enzovoort telt de periode, als noemer.
    werkdagenPerWeekdag: Array.from({ length: 5 }, (_, w) => werkdagen.filter((d) => d.weekdag === w).length),

    kwaliteit,
  };
}
