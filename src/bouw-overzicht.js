/**
 * Zet de jaarcijfers van alle groepen in het overzichtssjabloon.
 *
 * Gebruik: node src/bouw-overzicht.js
 *
 * Leest data/<groep>-jaar.json voor elke groep uit src/alle-wijken.js en
 * schrijft rapporten/bezetting-overzicht.html (logo's ernaast, voor het
 * Artifact) en rapporten/bezetting-overzicht-los.html (alles in één bestand,
 * om door te sturen). De stijl komt uit het wijksjabloon, zodat beide
 * rapporten er hetzelfde uitzien.
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Zelfde lijst als in src/alle-wijken.js; daar importeren zou meteen ophalen.
const GROEPEN = [
  'W1.4', 'W1.5', 'W1.6',
  'W2.2', 'W2.3', 'W2.4', 'W2.5', 'W2.6',
  'W3.2', 'W3.3', 'W3.4', 'W3.5', 'W3.6',
  'MOR',
];

const groepen = GROEPEN.map((groep) => {
  const g = JSON.parse(readFileSync(join(root, `data/${groep.replace(/\W/g, '')}-jaar.json`), 'utf8'));
  if (!g.kwaliteit?.metHartslag) {
    console.error(`${groep} mist de kwaliteitscontrole. Draai eerst node src/alle-wijken.js ${groep}.`);
    process.exit(1);
  }
  // Het toestel-id hoort niet in een rapport dat rondgaat.
  g.perWerkplek = g.perWerkplek.map(({ id, ...rest }) => rest);
  return g;
});

const gegevens = {
  groepen,
  buitenBeschouwing: {
    totaal: 93,
    delen: [
      { aantal: 70, wat: 'zonder wijkcode in hun naam' },
      { aantal: 11, wat: 'van het MT' },
      { aantal: 6, wat: 'aan de facilitaire balie' },
      { aantal: 6, wat: 'in stock' },
    ],
  },
};

const wijksjabloon = readFileSync(join(root, 'rapporten/sjabloon-wijk-jaar.html'), 'utf8');
const stijl = wijksjabloon.match(/<style>([\s\S]*?)<\/style>/)[1];

const sjabloon = readFileSync(join(root, 'rapporten/sjabloon-overzicht.html'), 'utf8');
const merk = /\/\*GEGEVENS\*\/[\s\S]*?\/\*GEGEVENS\*\//;
if (!merk.test(sjabloon) || !sjabloon.includes('/*STIJL*/')) {
  console.error('Het sjabloon mist de plek voor de gegevens of de stijl.');
  process.exit(1);
}

// Een functie als vervanging, zodat $-tekens in de gegevens niet geïnterpreteerd worden.
const pagina = sjabloon
  .replace('/*STIJL*/', () => stijl)
  .replace(merk, () => JSON.stringify(gegevens));

writeFileSync(join(root, 'rapporten/bezetting-overzicht.html'), pagina);
for (const naam of ['logo-pov.png', 'logo-pov-wit.png']) {
  copyFileSync(join(root, 'public', naam), join(root, 'rapporten', naam));
}

let losseVersie = pagina;
for (const naam of ['logo-pov.png', 'logo-pov-wit.png']) {
  const base64 = readFileSync(join(root, 'public', naam)).toString('base64');
  losseVersie = losseVersie.replaceAll(`src="${naam}"`, `src="data:image/png;base64,${base64}"`);
}
writeFileSync(join(root, 'rapporten/bezetting-overzicht-los.html'), losseVersie);

const plekken = groepen.reduce((a, g) => a + g.aantalPlekken, 0);
console.log(`Geschreven: rapporten/bezetting-overzicht.html (${(pagina.length / 1024).toFixed(0)} kB, logo's ernaast)`);
console.log(`           rapporten/bezetting-overzicht-los.html (${(losseVersie.length / 1024).toFixed(0)} kB, alles in één bestand)`);
console.log(`  ${groepen.length} groepen, ${plekken} werkplekken`);
