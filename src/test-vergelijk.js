/**
 * Controleert of de incrementele verversing hetzelfde oplevert als een
 * volledige ophaling. Vergelijkt data/historiek.json (volledig) met
 * data/historiek-incrementeel.json.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const volledig = JSON.parse(readFileSync(join(root, 'data/historiek.json'), 'utf8'));
const stapsgewijs = JSON.parse(readFileSync(join(root, 'data/historiek-incrementeel.json'), 'utf8'));

// De volledige ophaling gebeurde later, dus gebeurtenissen van na de
// incrementele ophaling laten we buiten beschouwing.
const grens = Date.parse(stapsgewijs.opgehaald);

const sleutels = (bron, id) => new Set(
  (bron.events[id] ?? [])
    .filter((e) => Date.parse(e.timestamp) <= grens)
    .map((e) => e.eventId),
);

let ontbreekt = 0;
let teveel = 0;
const voorbeelden = [];

const alleIds = new Set([...Object.keys(volledig.events), ...Object.keys(stapsgewijs.events)]);

for (const id of alleIds) {
  const a = sleutels(volledig, id);
  const b = sleutels(stapsgewijs, id);

  for (const k of a) if (!b.has(k)) { ontbreekt++; if (voorbeelden.length < 5) voorbeelden.push(`mist ${k} bij ${id}`); }
  for (const k of b) if (!a.has(k)) { teveel++; if (voorbeelden.length < 5) voorbeelden.push(`extra ${k} bij ${id}`); }
}

console.log(`werkplekken vergeleken : ${alleIds.size}`);
console.log(`grens                  : ${stapsgewijs.opgehaald}`);
console.log(`ontbreekt in de incrementele versie : ${ontbreekt}`);
console.log(`staat er teveel in                  : ${teveel}`);
if (voorbeelden.length) console.log('voorbeelden:\n  ' + voorbeelden.join('\n  '));
console.log(ontbreekt === 0 && teveel === 0 ? '\nIDENTIEK: de incrementele verversing verliest niets.' : '\nVERSCHIL GEVONDEN.');
