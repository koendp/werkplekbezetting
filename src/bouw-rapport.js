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

/**
 * Daarnaast een versie waarin de logo's in het bestand zelf zitten. Die ene
 * HTML kan je doorsturen of op een netwerkschijf zetten; hij opent in elke
 * browser, zonder account en zonder internetverbinding.
 */
let losseVersie = pagina;
for (const naam of ['logo-pov.png', 'logo-pov-wit.png']) {
  const base64 = readFileSync(join(root, 'public', naam)).toString('base64');
  losseVersie = losseVersie.replaceAll(`src="${naam}"`, `src="data:image/png;base64,${base64}"`);
}

const losPad = join(root, `rapporten/bezetting-${kort}-los.html`);
writeFileSync(losPad, losseVersie);

console.log(`Geschreven: rapporten/bezetting-${kort}.html (${(pagina.length / 1024).toFixed(0)} kB, logo's ernaast)`);
console.log(`           rapporten/bezetting-${kort}-los.html (${(losseVersie.length / 1024).toFixed(0)} kB, alles in één bestand)`);
console.log(`  ${gegevens.aantalPlekken} werkplekken, ${gegevens.perDag.length} dagen`);
console.log(`  gemiddeld zonder zomer: ${gegevens.zonderZomer.gemiddeld}`);
