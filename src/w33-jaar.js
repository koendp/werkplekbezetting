/**
 * Haalt een jaar bezettingsgeschiedenis op voor één werkwijk en rekent die uit.
 *
 * Gebruik: node src/w33-jaar.js [wijk]        standaard W3.3
 *
 * Het resultaat komt in data/<wijk>-jaar.json en bevat zowel de cijfers over
 * het hele jaar als die zonder juli en augustus.
 *
 * De ruwe gebeurtenissen worden apart bewaard in data/<wijk>-events.json, zodat
 * een herberekening niet opnieuw hoeft op te halen.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listDevices, listEventsForAll } from './dt.js';
import { ontleedToestel } from './parse.js';
import { bereken } from './aggregate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIJK = process.argv[2] || 'W3.3';

/** Twaalf volledige maanden, zodat juli en augustus er helemaal in of uit vallen. */
const VAN = Date.parse('2025-10-01T00:00:00+02:00');
const TOT = Date.parse('2026-10-01T00:00:00+02:00');

/** Aanloop om de begintoestand van elke werkplek te kennen. */
const AANLOOP_DAGEN = 21;

const START_UUR = 8;
const EIND_UUR = 17;

const ZOMERMAANDEN = [7, 8]; // juli en augustus

/**
 * Dagen waarop er niet of nauwelijks gewerkt werd. Dit zijn de Belgische
 * feestdagen plus de collectieve sluiting tussen Kerstmis en Nieuwjaar.
 * Ze worden niet weggelaten uit het gevraagde gemiddelde, maar wel apart
 * gehouden, want ze drukken het cijfer zonder dat er iets over het gebruik van
 * de werkplekken gezegd wordt.
 */
const GESLOTEN = {
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

const eventsPad = join(root, `data/${WIJK.replace(/\W/g, '')}-events.json`);
const uitPad = join(root, `data/${WIJK.replace(/\W/g, '')}-jaar.json`);

// ── Ophalen ───────────────────────────────────────────────────────────────────

console.log(`Werkplekken van wijk ${WIJK} zoeken...`);
const toestellen = (await listDevices()).map(ontleedToestel);
const werkplekken = toestellen.filter((t) => t.type === 'deskOccupancy' && t.wijk === WIJK);

if (!werkplekken.length) {
  console.error(`Geen werkplekken gevonden in wijk ${WIJK}.`);
  process.exit(1);
}
console.log(`  ${werkplekken.length} werkplekken`);

let ruwe;
if (existsSync(eventsPad)) {
  const bewaard = JSON.parse(readFileSync(eventsPad, 'utf8'));
  if (Date.parse(bewaard.tot) >= TOT && Date.parse(bewaard.van) <= VAN - AANLOOP_DAGEN * 86400000) {
    console.log(`Bewaarde gebeurtenissen hergebruiken (opgehaald ${bewaard.opgehaald.slice(0, 16)}).`);
    ruwe = bewaard.events;
  }
}

if (!ruwe) {
  console.log('Gebeurtenissen ophalen, een jaar per werkplek...');
  const t0 = Date.now();
  const resultaat = await listEventsForAll(
    werkplekken.map((w) => w.id),
    {
      eventType: 'deskOccupancy',
      startTime: new Date(VAN - AANLOOP_DAGEN * 86400000).toISOString(),
      endTime: new Date(TOT).toISOString(),
    },
    {
      concurrency: 8,
      onProgress: (klaar, totaal) => process.stdout.write(`\r  ${klaar}/${totaal}`),
    },
  );
  process.stdout.write('\r' + ' '.repeat(30) + '\r');

  ruwe = {};
  let fouten = 0;
  for (const [id, lijst] of resultaat) {
    if (!Array.isArray(lijst)) { fouten++; ruwe[id] = []; continue; }
    ruwe[id] = lijst.map((e) => ({
      eventId: e.eventId,
      timestamp: e.timestamp,
      data: { deskOccupancy: { state: e.data.deskOccupancy.state, updateTime: e.data.deskOccupancy.updateTime } },
    }));
  }

  const aantal = Object.values(ruwe).reduce((a, l) => a + l.length, 0);
  console.log(`  ${aantal} gebeurtenissen in ${((Date.now() - t0) / 1000).toFixed(0)} s${fouten ? `, ${fouten} fouten` : ''}`);

  writeFileSync(eventsPad, JSON.stringify({
    wijk: WIJK,
    opgehaald: new Date().toISOString(),
    van: new Date(VAN - AANLOOP_DAGEN * 86400000).toISOString(),
    tot: new Date(TOT).toISOString(),
    events: ruwe,
  }));
}

// ── Berekenen ─────────────────────────────────────────────────────────────────

const events = new Map(Object.entries(ruwe));
const r = bereken(werkplekken, events, { van: VAN, tot: TOT, startUur: START_UUR, eindUur: EIND_UUR });

const gemiddelde = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const percentiel = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const maandVan = (datum) => Number(datum.slice(5, 7));
const isZomer = (datum) => ZOMERMAANDEN.includes(maandVan(datum));

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

const aantalPlekken = werkplekken.length;

/**
 * Per dag: welke werkplekken waren er die dag in gebruik?
 *
 * Dit is iets anders dan de piek. De piek telt hoeveel plekken op hetzelfde
 * moment bezet waren; dit telt hoeveel verschillende plekken er in de loop van
 * de dag aan bod kwamen. Een plek telt mee vanaf een kwartier gebruik, dezelfde
 * drempel die ook voor "dagen gebruikt" per werkplek geldt.
 */
const BINS_PER_DAG = 96;
const DREMPEL = 0.5; // een halve blok van een kwartier

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

const uitkomst = {
  wijk: WIJK,
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
};

writeFileSync(uitPad, JSON.stringify(uitkomst));

// ── Overzicht in de terminal ──────────────────────────────────────────────────

const pct = (v) => (v * 100).toFixed(1) + '%';
const DAGKORT = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag'];

console.log(`\nWijk ${WIJK}, ${aantalPlekken} werkplekken`);
console.log(`Periode ${uitkomst.van.slice(0, 10)} tot ${uitkomst.tot.slice(0, 10)}, kantooruren ${START_UUR} tot ${EIND_UUR} uur\n`);

for (const [naam, s] of [
  ['heel jaar, alle werkdagen', uitkomst.heelJaar],
  ['zonder juli en augustus', uitkomst.zonderZomer],
  ['enkel juli en augustus', uitkomst.alleenZomer],
  ['heel jaar, zonder feestdagen en kerstsluiting', uitkomst.open],
  ['zonder zomer, feestdagen en kerstsluiting', uitkomst.openZonderZomer],
]) {
  console.log(`${naam}:`);
  console.log(`  werkdagen        ${s.werkdagen}`);
  console.log(`  gemiddeld per dag ${s.gemiddeld} van ${aantalPlekken}  (${pct(s.gemiddeldeGraad)})`);
  console.log(`  mediaan          ${s.mediaan}`);
  console.log(`  drukste dag      ${s.hoogste}   rustigste ${s.laagste}`);
  console.log(`  hoogste piek     ${s.piekHoogste} (${pct(s.piekGraad)})\n`);
}

console.log('per weekdag (zonder juli en augustus):');
console.log('              gemiddeld   graad   piek   verschillende plekken   alle 41');
uitkomst.zonderZomer.perWeekdag.forEach((w, i) => {
  console.log(
    `  ${DAGKORT[i].padEnd(10)} ${String(w.gemiddeld).padStart(7)} ${pct(w.graad).padStart(7)}` +
    ` ${String(w.piek).padStart(6)}   gem ${String(w.gebruiktGemiddeld).padStart(4)}, hoogste ${String(w.gebruiktHoogste).padStart(2)}` +
    `   ${w.volledigeDagen} van ${w.dagen} dagen`,
  );
});

console.log('\nverschillende plekken gebruikt op één dag:');
for (const [naam, s] of [['heel jaar', uitkomst.heelJaar], ['zonder juli en augustus', uitkomst.zonderZomer]]) {
  console.log(`  ${naam.padEnd(24)} gemiddeld ${s.gebruiktGemiddeld}, laagste ${s.gebruiktLaagste}, hoogste ${s.gebruiktHoogste}, alle ${aantalPlekken} op ${s.volledigeDagen} dagen`);
}

console.log('\nper maand:');
for (const m of uitkomst.perMaand) {
  console.log(`  ${m.maand}  ${String(m.gemiddeld).padStart(6)}  ${pct(m.graad).padStart(6)}  ${m.zomer ? '(zomer)' : ''}`);
}

console.log(`\nGeschreven: ${uitPad.replace(root, '.')}`);
