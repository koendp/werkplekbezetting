/**
 * Zet het logo van Provincie Oost-Vlaanderen om van een PNG met witte
 * achtergrond naar twee PNG's met transparantie:
 *
 *   logo-pov.png      originele kleuren, transparante achtergrond
 *   logo-pov-wit.png  de officiële negatiefversie, wit, voor donkere vlakken
 *
 * De dekking per pixel wordt bepaald ten opzichte van de inktkleur waar de
 * pixel het dichtst bij ligt (het grijs van het woordmerk of het oranje van
 * het beeldmerk), zodat randpixels netjes doorschijnend worden en volle
 * pixels volledig dekkend blijven.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const [bron, uitKleur, uitWit] = process.argv.slice(2);

/* ── PNG lezen ────────────────────────────────────────────────────────────── */

function leesPng(pad) {
  const b = readFileSync(pad);
  const breedte = b.readUInt32BE(16);
  const hoogte = b.readUInt32BE(20);
  const bitdiepte = b[24];
  const kleurtype = b[25];

  if (bitdiepte !== 8 || kleurtype !== 2) {
    throw new Error(`Verwacht 8-bits RGB, kreeg bitdiepte ${bitdiepte} en kleurtype ${kleurtype}`);
  }

  const brokken = [];
  let i = 8;
  while (i < b.length) {
    const lengte = b.readUInt32BE(i);
    const soort = b.toString('ascii', i + 4, i + 8);
    if (soort === 'IDAT') brokken.push(b.subarray(i + 8, i + 8 + lengte));
    if (soort === 'IEND') break;
    i += 12 + lengte;
  }

  const rauw = inflateSync(Buffer.concat(brokken));
  const kanalen = 3;
  const regel = breedte * kanalen;
  const beeld = Buffer.alloc(hoogte * regel);

  // De PNG-filters per scanlijn ongedaan maken.
  for (let y = 0; y < hoogte; y++) {
    const filter = rauw[y * (regel + 1)];
    const van = y * (regel + 1) + 1;
    for (let x = 0; x < regel; x++) {
      const rauwByte = rauw[van + x];
      const a = x >= kanalen ? beeld[y * regel + x - kanalen] : 0;
      const bb = y > 0 ? beeld[(y - 1) * regel + x] : 0;
      const c = x >= kanalen && y > 0 ? beeld[(y - 1) * regel + x - kanalen] : 0;

      let waarde;
      switch (filter) {
        case 0: waarde = rauwByte; break;
        case 1: waarde = rauwByte + a; break;
        case 2: waarde = rauwByte + bb; break;
        case 3: waarde = rauwByte + ((a + bb) >> 1); break;
        case 4: {
          const p = a + bb - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - bb);
          const pc = Math.abs(p - c);
          waarde = rauwByte + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
          break;
        }
        default: throw new Error(`Onbekend filtertype ${filter} op regel ${y}`);
      }
      beeld[y * regel + x] = waarde & 0xff;
    }
  }

  return { breedte, hoogte, beeld };
}

/* ── PNG schrijven ────────────────────────────────────────────────────────── */

const crcTabel = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTabel[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function brok(soort, data) {
  const kop = Buffer.alloc(4);
  kop.writeUInt32BE(data.length);
  const lijf = Buffer.concat([Buffer.from(soort, 'ascii'), data]);
  const staart = Buffer.alloc(4);
  staart.writeUInt32BE(crc32(lijf));
  return Buffer.concat([kop, lijf, staart]);
}

function schrijfPngRgba(pad, breedte, hoogte, pixels) {
  const regel = breedte * 4;
  const rauw = Buffer.alloc(hoogte * (regel + 1));
  for (let y = 0; y < hoogte; y++) {
    rauw[y * (regel + 1)] = 0; // filter "none"
    pixels.copy(rauw, y * (regel + 1) + 1, y * regel, (y + 1) * regel);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breedte, 0);
  ihdr.writeUInt32BE(hoogte, 4);
  ihdr[8] = 8;  // bitdiepte
  ihdr[9] = 6;  // kleurtype RGBA

  writeFileSync(pad, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    brok('IHDR', ihdr),
    brok('IDAT', deflateSync(rauw, { level: 9 })),
    brok('IEND', Buffer.alloc(0)),
  ]));
}

/* ── Omzetten ─────────────────────────────────────────────────────────────── */

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const GRIJS = lum(0x56, 0x55, 0x55);   // donkergrijs van het woordmerk
const ORANJE = lum(0xc8, 0x6b, 0x02);  // oranje van het beeldmerk

const { breedte, hoogte, beeld } = leesPng(bron);
const kleur = Buffer.alloc(breedte * hoogte * 4);
const wit = Buffer.alloc(breedte * hoogte * 4);

let dekkend = 0;
let doorzichtig = 0;

for (let p = 0; p < breedte * hoogte; p++) {
  const r = beeld[p * 3];
  const g = beeld[p * 3 + 1];
  const b = beeld[p * 3 + 2];

  const helderheid = lum(r, g, b);
  const verzadiging = Math.max(r, g, b) - Math.min(r, g, b);
  const inkt = verzadiging > 40 ? ORANJE : GRIJS;

  // Dekking ten opzichte van de inktkleur: 0 op wit, 1 op volle inkt.
  let a = (255 - helderheid) / (255 - inkt);
  a = Math.max(0, Math.min(1, a));

  if (a >= 0.99) dekkend++;
  if (a <= 0.01) doorzichtig++;

  // Originele kleur terugrekenen uit de menging met wit.
  const q = 4 * p;
  if (a > 0.004) {
    kleur[q] = Math.max(0, Math.min(255, Math.round(255 + (r - 255) / a)));
    kleur[q + 1] = Math.max(0, Math.min(255, Math.round(255 + (g - 255) / a)));
    kleur[q + 2] = Math.max(0, Math.min(255, Math.round(255 + (b - 255) / a)));
  }
  kleur[q + 3] = Math.round(a * 255);

  wit[q] = 255;
  wit[q + 1] = 255;
  wit[q + 2] = 255;
  wit[q + 3] = Math.round(a * 255);
}

schrijfPngRgba(uitKleur, breedte, hoogte, kleur);
schrijfPngRgba(uitWit, breedte, hoogte, wit);

const totaal = breedte * hoogte;
console.log(`${breedte} x ${hoogte} px omgezet`);
console.log(`  volledig dekkend : ${((dekkend / totaal) * 100).toFixed(1)}%`);
console.log(`  volledig doorzichtig: ${((doorzichtig / totaal) * 100).toFixed(1)}%`);
console.log(`  randpixels       : ${(((totaal - dekkend - doorzichtig) / totaal) * 100).toFixed(1)}%`);
console.log(`geschreven: ${uitKleur}, ${uitWit}`);
