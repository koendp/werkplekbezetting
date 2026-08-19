/**
 * Rekent de analyse uit en schrijft ze weg als data/momentopname.js.
 *
 * Online kan de analyse niet live berekend worden: ze heeft 552 API-oproepen en
 * ruim 25 MB historiek nodig. Daarom rekent een geplande taak de uitkomst
 * periodiek uit en wordt alleen dat resultaat gepubliceerd.
 *
 * Gebruik: node src/snapshot.js
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bewaardeHistoriek, verversHistoriek } from './cache.js';
import { bereken, groepeer, lokaleDagStart } from './aggregate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAG_MS = 24 * 60 * 60 * 1000;

/** De periodes die online beschikbaar zijn, telkens met kantooruren 8 tot 17. */
const PERIODES = [7, 30, 60];
const START_UUR = 8;
const EIND_UUR = 17;

const geenHistoriek = !bewaardeHistoriek();
if (geenHistoriek) console.log('Nog geen historiek, alles wordt opgehaald. Dit duurt ruim een minuut.');

console.log('Historiek bijwerken...');
const verversing = await verversHistoriek({
  dagen: Math.max(...PERIODES),
  onProgress: (klaar, totaal) => process.stdout.write(`\r  ${klaar}/${totaal}`),
});
process.stdout.write('\r' + ' '.repeat(30) + '\r');
console.log(`  ${verversing.bevraagd} werkplekken bevraagd, ${verversing.nieuweEvents} nieuwe gebeurtenissen`);

const info = JSON.parse(readFileSync(join(root, 'data/toestellen.json'), 'utf8'));
const historiek = bewaardeHistoriek();
const werkplekken = info.toestellen.filter((t) => t.type === 'deskOccupancy');
const events = new Map(Object.entries(historiek.events));

const tot = Date.now();
const analyses = {};

for (const dagen of PERIODES) {
  const van = lokaleDagStart(tot) - (dagen - 1) * DAG_MS;
  const r = bereken(werkplekken, events, { van, tot, startUur: START_UUR, eindUur: EIND_UUR });

  analyses[dagen] = {
    ...r,
    opgehaald: historiek.opgehaald,
    groepen: {
      verdieping: groepeer(r, 'verdiepingNaam'),
      wijk: groepeer(r, 'wijk'),
      lokaal: groepeer(r, 'lokaal'),
    },
    // De blokjes per werkplek zijn te omvangrijk om te publiceren.
    perWerkplek: r.perWerkplek.map(({ bins, ...rest }) => rest),
  };

  console.log(`  ${String(dagen).padStart(2)} dagen: gemiddeld ${r.kerncijfers.gemiddeldeBezetting} bezet, piek ${r.kerncijfers.piekBezetting}`);
}

const inhoud = {
  gemaakt: new Date(tot).toISOString(),
  periodes: PERIODES,
  startUur: START_UUR,
  eindUur: EIND_UUR,
  analyses,
};

// Als JavaScript-module, zodat het bestand zeker meegaat bij het publiceren.
const pad = join(root, 'data/momentopname.js');
writeFileSync(pad, `// Automatisch gemaakt door src/snapshot.js. Niet met de hand aanpassen.\nexport default ${JSON.stringify(inhoud)};\n`);

const kb = (readFileSync(pad).length / 1024).toFixed(0);
console.log(`\nGeschreven: data/momentopname.js (${kb} kB), gemaakt ${inhoud.gemaakt}`);
