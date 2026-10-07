/**
 * Haalt een jaar op voor alle groepen werkplekken en rekent ze na elkaar uit.
 *
 * Gebruik: node src/alle-wijken.js [groep ...]     standaard alle veertien
 *
 * Per groep komt er een data/<groep>-jaar.json, dezelfde vorm als die van
 * src/w33-jaar.js, aangevuld met de kwaliteitscontrole. De ruwe gebeurtenissen
 * worden niet bewaard: samen zijn ze ongeveer 150 MB, de berekende cijfers maar
 * een fractie daarvan. Daarna maakt src/bouw-overzicht.js er de pagina van.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listDevices, listEventsForAll } from './dt.js';
import { ontleedToestel } from './parse.js';
import { berekenJaar, VAN, TOT, AANLOOP_DAGEN } from './jaarcijfers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * De dertien werkwijken plus MOR. De overige 93 sensoren vallen erbuiten:
 * 70 zonder wijkcode in hun naam, 11 MT, 6 facilitaire balie en 6 stock.
 */
export const GROEPEN = [
  'W1.4', 'W1.5', 'W1.6',
  'W2.2', 'W2.3', 'W2.4', 'W2.5', 'W2.6',
  'W3.2', 'W3.3', 'W3.4', 'W3.5', 'W3.6',
  'MOR',
];

const gevraagd = process.argv.slice(2);
const groepen = gevraagd.length ? GROEPEN.filter((g) => gevraagd.includes(g)) : GROEPEN;

console.log('Toestellen ophalen...');
const toestellen = (await listDevices()).map(ontleedToestel).filter((t) => t.type === 'deskOccupancy');

const t0 = Date.now();
let totaalPlekken = 0;

for (const groep of groepen) {
  const werkplekken = toestellen.filter((t) => t.wijk === groep);
  if (!werkplekken.length) {
    console.error(`${groep}: geen werkplekken gevonden, overgeslagen.`);
    continue;
  }
  totaalPlekken += werkplekken.length;
  const ids = werkplekken.map((w) => w.id);
  const t1 = Date.now();

  const bezetting = await listEventsForAll(ids, {
    eventType: 'deskOccupancy',
    startTime: new Date(VAN - AANLOOP_DAGEN * 86400000).toISOString(),
    endTime: new Date(TOT).toISOString(),
  });

  // De batterijmelding komt elke dag, ook als niemand de plek gebruikt.
  const batterij = await listEventsForAll(ids, {
    eventType: 'batteryStatus',
    startTime: new Date(VAN).toISOString(),
    endTime: new Date(TOT).toISOString(),
  });

  const ruwe = {};
  const hartslagen = {};
  let fouten = 0;
  let aantal = 0;
  for (const id of ids) {
    const lijst = bezetting.get(id);
    const hart = batterij.get(id);
    if (!Array.isArray(lijst) || !Array.isArray(hart)) fouten++;
    ruwe[id] = (Array.isArray(lijst) ? lijst : []).map((e) => ({
      timestamp: e.timestamp,
      data: { deskOccupancy: { state: e.data.deskOccupancy.state, updateTime: e.data.deskOccupancy.updateTime } },
    }));
    hartslagen[id] = (Array.isArray(hart) ? hart : []).map((e) => Date.parse(e.timestamp));
    aantal += ruwe[id].length;
  }
  if (fouten) {
    console.error(`${groep}: ${fouten} werkplekken konden niet opgehaald worden. Gestopt, probeer opnieuw.`);
    process.exit(1);
  }

  const uitkomst = berekenJaar(groep, werkplekken, ruwe, hartslagen);
  const kort = groep.replace(/\W/g, '');
  writeFileSync(join(root, `data/${kort}-jaar.json`), JSON.stringify(uitkomst));

  const k = uitkomst.kwaliteit;
  console.log(
    `${groep.padEnd(5)} ${String(werkplekken.length).padStart(3)} plekken, ${String(aantal).padStart(7)} wissels, ` +
    `${((Date.now() - t1) / 1000).toFixed(0).padStart(3)} s | gem ${uitkomst.zonderZomer.gemiddeld} ` +
    `(${(uitkomst.zonderZomer.gemiddeldeGraad * 100).toFixed(1)}%) | weekend ${k.weekendGemiddeld}, ` +
    `vast ${k.vastePlekken.length}, zwijgend ${k.zwijgend.length}, zonder meting ${k.dagenZonderMeting.length} dagen`,
  );
}

console.log(`\n${groepen.length} groepen, ${totaalPlekken} werkplekken, ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
