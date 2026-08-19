/** Snelle controle van de berekening op de bewaarde data. */

import { bewaardeHistoriek } from './cache.js';
import { bereken, groepeer, lokaleDagStart } from './aggregate.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const info = JSON.parse(readFileSync(join(root, 'data/toestellen.json'), 'utf8'));
const hist = bewaardeHistoriek();

const werkplekken = info.toestellen.filter((t) => t.type === 'deskOccupancy');
const events = new Map(Object.entries(hist.events));

const dagen = 30;
const tot = Date.now();
const van = lokaleDagStart(tot) - (dagen - 1) * 86400000;

const t0 = Date.now();
const r = bereken(werkplekken, events, { van, tot, startUur: 8, eindUur: 17 });
console.log(`berekend in ${Date.now() - t0} ms`);
console.log('venster    :', r.venster.van.slice(0, 10), 'tot', r.venster.tot.slice(0, 10), `(${r.venster.werkdagen} volledige werkdagen)`);
console.log('werkplekken:', r.aantalPlekken);
console.log('kerncijfers:', r.kerncijfers);

console.log('\nper uur (gemiddeld aantal bezette plekken op een werkdag):');
r.perUur.forEach((v, u) => {
  if (u >= 5 && u <= 21) console.log(`  ${String(u).padStart(2, '0')}u  ${'#'.repeat(Math.round(v / 3))} ${v}`);
});

console.log('\nper weekdag:');
['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].forEach((d, i) => {
  const w = r.perWeekdag[i];
  console.log(`  ${d}  gemiddeld ${String(w.gemiddeld).padStart(6)}   piek ${String(w.piek).padStart(6)}   (${w.dagen} dagen)`);
});

console.log('\nper verdieping:');
for (const g of groepeer(r, 'verdiepingNaam')) {
  console.log(`  ${g.naam.padEnd(16)} ${String(g.aantalPlekken).padStart(4)} plekken   gem ${(g.bezettingsgraad * 100).toFixed(1).padStart(5)}%   piek ${(g.piekgraad * 100).toFixed(1).padStart(5)}%   nooit gebruikt: ${g.nooitGebruikt}`);
}

console.log('\nlaatste 10 dagen:');
for (const d of r.perDag.slice(-10)) {
  console.log(`  ${d.datum}  ${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'][d.weekdag]}  gem ${String(d.gemiddeld).padStart(6)}  piek ${String(d.piek).padStart(6)}  ${d.volledig ? '' : '(lopend)'}`);
}
