/**
 * Zet de berekende jaarcijfers in het rapportsjabloon.
 *
 * Gebruik: node src/bouw-rapport.js [wijk]      standaard W3.3
 *
 * Leest data/<wijk>-jaar.json en schrijft rapporten/bezetting-<wijk>.html,
 * een pagina die op zichzelf staat en als Artifact gepubliceerd kan worden.
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIJK = process.argv[2] || 'W3.3';
const kort = WIJK.replace(/\W/g, '');

const gegevens = JSON.parse(readFileSync(join(root, `data/${kort}-jaar.json`), 'utf8'));

// Het toestel-id hoort niet in een rapport dat rondgaat.
gegevens.perWerkplek = gegevens.perWerkplek.map(({ id, ...rest }) => rest);

const sjabloon = readFileSync(join(root, 'rapporten/sjabloon-wijk-jaar.html'), 'utf8');

const merk = /\/\*GEGEVENS\*\/[\s\S]*?\/\*GEGEVENS\*\//;
if (!merk.test(sjabloon)) {
  console.error('Het sjabloon bevat geen plek om de gegevens in te zetten.');
  process.exit(1);
}

const pagina = sjabloon
  .replace(merk, JSON.stringify(gegevens))
  .replaceAll('W3.3', WIJK);

const uit = join(root, `rapporten/bezetting-${kort}.html`);
writeFileSync(uit, pagina);

// De logo's ernaast zetten, zodat de map op zichzelf staat.
for (const naam of ['logo-pov.png', 'logo-pov-wit.png']) {
  copyFileSync(join(root, 'public', naam), join(root, 'rapporten', naam));
}

console.log(`Geschreven: rapporten/bezetting-${kort}.html (${(pagina.length / 1024).toFixed(0)} kB)`);
console.log(`  ${gegevens.aantalPlekken} werkplekken, ${gegevens.perDag.length} dagen`);
console.log(`  gemiddeld zonder zomer: ${gegevens.zonderZomer.gemiddeld}`);
