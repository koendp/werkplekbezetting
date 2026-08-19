/**
 * Client voor de Disruptive Technologies REST API.
 * Authenticatie gebeurt met basic auth op de service account (key id + secret).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://api.disruptive-technologies.com/v2';

let cachedConfig = null;

/**
 * Sleutels komen uit de omgevingsvariabelen. Staan ze daar niet, dan valt het
 * terug op een .env-bestand naast dit project. Zo werkt hetzelfde bestand
 * lokaal en op een server waar geen .env staat.
 */
export function config() {
  if (cachedConfig) return cachedConfig;

  const env = { ...process.env };

  if (!env.DT_KEY_ID) {
    try {
      for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([^#=]+)=(.*)$/);
        if (m && !env[m[1].trim()]) env[m[1].trim()] = m[2].trim();
      }
    } catch {
      // Geen .env: dan moeten de omgevingsvariabelen volstaan.
    }
  }

  const missing = ['DT_KEY_ID', 'DT_SECRET', 'DT_PROJECT_ID'].filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Ontbrekende instellingen: ${missing.join(', ')}. Zet ze in .env of als omgevingsvariabele.`);
  }

  cachedConfig = {
    projectId: env.DT_PROJECT_ID,
    auth: 'Basic ' + Buffer.from(`${env.DT_KEY_ID}:${env.DT_SECRET}`).toString('base64'),
  };
  return cachedConfig;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Eén API-oproep met herkansing bij tijdelijke fouten. */
async function request(path, params = {}, poging = 0) {
  const { auth } = config();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: auth } });
  } catch (err) {
    if (poging < 4) {
      await sleep(500 * 2 ** poging);
      return request(path, params, poging + 1);
    }
    throw new Error(`Netwerkfout bij ${path}: ${err.message}`);
  }

  if (res.status === 429 || res.status >= 500) {
    if (poging < 4) {
      await sleep(800 * 2 ** poging);
      return request(path, params, poging + 1);
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status} bij ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Doorloopt alle pagina's van een lijst-endpoint. */
async function listAll(path, params, veld) {
  const items = [];
  let pageToken = '';
  do {
    const data = await request(path, { ...params, pageToken });
    items.push(...(data[veld] ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return items;
}

/** Alle toestellen in het project, met hun laatst gerapporteerde toestand. */
export async function listDevices() {
  const { projectId } = config();
  return listAll(`/projects/${projectId}/devices`, { pageSize: 100 }, 'devices');
}

/** Gebeurtenissen van één toestel binnen een tijdvenster. */
export async function listEvents(deviceId, { eventType = 'deskOccupancy', startTime, endTime } = {}) {
  const { projectId } = config();
  return listAll(
    `/projects/${projectId}/devices/${deviceId}/events`,
    { pageSize: 1000, eventTypes: eventType, startTime, endTime },
    'events',
  );
}

/** Haalt gebeurtenissen op voor veel toestellen tegelijk, met beperkte gelijktijdigheid. */
export async function listEventsForAll(deviceIds, opties = {}, { concurrency = 8, onProgress } = {}) {
  const resultaat = new Map();
  let index = 0;
  let klaar = 0;

  async function worker() {
    while (index < deviceIds.length) {
      const id = deviceIds[index++];
      try {
        resultaat.set(id, await listEvents(id, opties));
      } catch (err) {
        resultaat.set(id, { fout: err.message });
      }
      klaar++;
      if (onProgress && klaar % 10 === 0) onProgress(klaar, deviceIds.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, deviceIds.length) }, worker));
  if (onProgress) onProgress(klaar, deviceIds.length);
  return resultaat;
}
