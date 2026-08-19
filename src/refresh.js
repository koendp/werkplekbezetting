/**
 * Haalt de historiek op vanaf de opdrachtregel.
 *
 *   node src/refresh.js            60 dagen, enkel het nieuwe stuk
 *   node src/refresh.js 90         90 dagen
 *   node src/refresh.js 90 --alles alles opnieuw ophalen
 */

import { verversHistoriek } from './cache.js';

const args = process.argv.slice(2);
const dagen = Number(args.find((a) => /^\d+$/.test(a)) || 60);
const volledig = args.includes('--alles');

console.log(`Historiek ophalen: ${dagen} dagen${volledig ? ' (volledig opnieuw)' : ''}...`);

const start = Date.now();
const samenvatting = await verversHistoriek({
  dagen,
  volledig,
  onProgress: (klaar, totaal) => process.stdout.write(`\r  ${klaar}/${totaal} werkplekken`),
});

process.stdout.write('\r' + ' '.repeat(40) + '\r');
console.log(`Klaar in ${((Date.now() - start) / 1000).toFixed(1)} s`);
console.log(`  werkplekken    : ${samenvatting.werkplekken}`);
console.log(`  bevraagd       : ${samenvatting.bevraagd} (${samenvatting.overgeslagen} overgeslagen, want ongewijzigd)`);
console.log(`  nieuw opgehaald: ${samenvatting.nieuweEvents} gebeurtenissen`);
console.log(`  totaal bewaard : ${samenvatting.events} gebeurtenissen`);
console.log(`  venster        : ${samenvatting.van.slice(0, 10)} tot ${samenvatting.tot.slice(0, 10)}`);
if (samenvatting.fouten) console.log(`  fouten         : ${samenvatting.fouten}`);
