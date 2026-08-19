/**
 * Haalt toestellen en gebeurtenissen op en bewaart ze lokaal in data/.
 *
 * De historiek wordt bijgewerkt in plaats van opnieuw opgehaald: bij een
 * verversing halen we enkel de periode sinds de vorige keer op. Zo duurt een
 * dagelijkse verversing enkele seconden in plaats van een halve minuut.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listDevices, listEventsForAll } from './dt.js';
import { ontleedToestel } from './parse.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, 'data');
const TOESTELLEN = join(DATA, 'toestellen.json');
const HISTORIEK = join(DATA, 'historiek.json');

/** Extra aanloop om de begintoestand van elke werkplek te kennen. */
const AANLOOP_DAGEN = 14;
const DAG_MS = 24 * 60 * 60 * 1000;

function zorgVoorMap() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
}

function leesJson(pad) {
  try {
    return JSON.parse(readFileSync(pad, 'utf8'));
  } catch {
    return null;
  }
}

function schrijfJson(pad, inhoud) {
  zorgVoorMap();
  writeFileSync(pad, JSON.stringify(inhoud));
}

/** Haalt de actuele toestellenlijst op en bewaart die. */
export async function verversToestellen() {
  const ruw = await listDevices();
  const toestellen = ruw.map(ontleedToestel);
  const inhoud = { opgehaald: new Date().toISOString(), toestellen };
  schrijfJson(TOESTELLEN, inhoud);
  return inhoud;
}

/** Leest de bewaarde toestellen, of haalt ze op als er nog niets is. */
export async function toestellen({ maxLeeftijdMs = 5 * 60 * 1000 } = {}) {
  const bewaard = leesJson(TOESTELLEN);
  if (bewaard && Date.now() - Date.parse(bewaard.opgehaald) < maxLeeftijdMs) return bewaard;
  return verversToestellen();
}

export function bewaardeHistoriek() {
  return leesJson(HISTORIEK);
}

/**
 * Werkt de historiek bij tot nu.
 *
 * @param {{dagen?:number, onProgress?:Function, volledig?:boolean}} opties
 */
export async function verversHistoriek({ dagen = 60, onProgress, volledig = false } = {}) {
  const nu = Date.now();
  const gewenstVan = nu - (dagen + AANLOOP_DAGEN) * DAG_MS;

  const bewaard = volledig ? null : bewaardeHistoriek();
  const dekt = bewaard && Date.parse(bewaard.van) <= gewenstVan;

  // Bij een geldige cache halen we enkel de nieuwe periode op, met een uur
  // overlap zodat er niets tussen valt.
  const ophaalVan = dekt ? Date.parse(bewaard.tot) - 60 * 60 * 1000 : gewenstVan;

  const info = await verversToestellen();
  const werkplekken = info.toestellen.filter((t) => t.type === 'deskOccupancy');

  /** Tijdstip van de laatste bewaarde wissel van een werkplek. */
  const laatstBewaard = (id) => {
    const lijst = dekt ? bewaard.events[id] : null;
    if (!lijst || !lijst.length) return null;
    let max = 0;
    for (const e of lijst) {
      const t = Date.parse(e.data.deskOccupancy.updateTime || e.timestamp);
      if (t > max) max = t;
    }
    return max || null;
  };

  // De toestellenlijst bevat per sensor al het tijdstip van de laatste wissel.
  // Is dat niet nieuwer dan wat we bewaard hebben, dan valt er niets op te
  // halen. Bij een verversing per uur scheelt dat honderden API-oproepen.
  const teVerversen = werkplekken.filter((wp) => {
    if (!dekt) return true;
    const bewaardTot = laatstBewaard(wp.id);
    if (bewaardTot === null || !wp.toestandSinds) return true;
    return Date.parse(wp.toestandSinds) > bewaardTot;
  });

  const resultaat = await listEventsForAll(
    teVerversen.map((w) => w.id),
    { eventType: 'deskOccupancy', startTime: new Date(ophaalVan).toISOString() },
    { concurrency: 10, onProgress },
  );

  const events = {};
  let fouten = 0;
  let aantalEvents = 0;
  let nieuweEvents = 0;

  for (const wp of werkplekken) {
    const bestaand = (dekt && bewaard.events[wp.id]) || [];
    const nieuw = resultaat.get(wp.id);

    // Overgeslagen werkplek: houden wat er was, binnen het venster.
    if (nieuw === undefined) {
      events[wp.id] = bestaand.filter((e) => Date.parse(e.data.deskOccupancy.updateTime || e.timestamp) >= gewenstVan);
      aantalEvents += events[wp.id].length;
      continue;
    }

    if (!Array.isArray(nieuw)) {
      fouten++;
      // Bij een fout houden we vast aan wat er al was.
      events[wp.id] = bestaand;
      aantalEvents += bestaand.length;
      continue;
    }

    const samen = new Map();
    for (const e of bestaand) samen.set(e.eventId, e);
    for (const e of nieuw) if (!samen.has(e.eventId)) nieuweEvents++;
    for (const e of nieuw) {
      samen.set(e.eventId, {
        eventId: e.eventId,
        timestamp: e.timestamp,
        data: { deskOccupancy: { state: e.data.deskOccupancy.state, updateTime: e.data.deskOccupancy.updateTime } },
      });
    }

    const lijst = [...samen.values()]
      .filter((e) => Date.parse(e.data.deskOccupancy.updateTime || e.timestamp) >= gewenstVan)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    events[wp.id] = lijst;
    aantalEvents += lijst.length;
  }

  const inhoud = {
    opgehaald: new Date(nu).toISOString(),
    van: new Date(gewenstVan).toISOString(),
    tot: new Date(nu).toISOString(),
    aanloopDagen: AANLOOP_DAGEN,
    events,
  };

  schrijfJson(HISTORIEK, inhoud);

  return {
    opgehaald: inhoud.opgehaald,
    van: inhoud.van,
    tot: inhoud.tot,
    werkplekken: werkplekken.length,
    bevraagd: teVerversen.length,
    overgeslagen: werkplekken.length - teVerversen.length,
    events: aantalEvents,
    nieuweEvents,
    fouten,
    bijgewerkt: Boolean(dekt),
  };
}
