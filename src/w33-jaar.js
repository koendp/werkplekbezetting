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
import { berekenJaar, VAN, TOT, AANLOOP_DAGEN, START_UUR, EIND_UUR } from './jaarcijfers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIJK = process.argv[2] || 'W3.3';

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

const uitkomst = berekenJaar(WIJK, werkplekken, ruwe);
const aantalPlekken = uitkomst.aantalPlekken;

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
