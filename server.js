/**
 * Lokale webserver voor het werkplekdashboard.
 *
 * Start met: node server.js   (of dubbelklik start.bat)
 * Open dan:  http://localhost:5180
 *
 * Online draait het dashboard niet op deze server maar op de losse functies in
 * api/. Beide gebruiken dezelfde bouwstenen uit src/, zodat er maar één
 * uitvoering van de logica bestaat.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { toestellen, bewaardeHistoriek, verversHistoriek } from './src/cache.js';
import { bereken, groepeer, lokaleDagStart } from './src/aggregate.js';
import { bouwNu, bouwSensoren } from './src/model.js';
import { controleerWachtwoord, maakKoekje, wisKoekje, authActief, aangemeld } from './src/auth.js';
import { bewaak, stuurJson } from './src/http.js';

const root = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(root, 'public');
const POORT = Number(process.env.POORT || 5180);
const DAG_MS = 24 * 60 * 60 * 1000;

const MIMETYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ── Rekencache ────────────────────────────────────────────────────────────────
// De berekening duurt een fractie van een seconde, maar het inlezen van 26 MB
// historiek niet. Beide houden we vast tot de data op schijf verandert.

let historiekCache = null;
let analyseCache = new Map();

async function historiek() {
  const pad = join(root, 'data/historiek.json');
  let gewijzigd;
  try {
    gewijzigd = (await stat(pad)).mtimeMs;
  } catch {
    return null;
  }

  if (!historiekCache || historiekCache.gewijzigd !== gewijzigd) {
    historiekCache = { gewijzigd, data: bewaardeHistoriek(), events: null };
    historiekCache.events = new Map(Object.entries(historiekCache.data.events));
    analyseCache = new Map();
  }
  return historiekCache;
}

async function analyse({ dagen, startUur, eindUur }) {
  const hist = await historiek();
  if (!hist) return null;

  const sleutel = `${dagen}|${startUur}|${eindUur}|${hist.gewijzigd}`;
  if (analyseCache.has(sleutel)) return analyseCache.get(sleutel);

  const info = await toestellen();
  const werkplekken = info.toestellen.filter((t) => t.type === 'deskOccupancy');

  const tot = Date.now();
  const van = lokaleDagStart(tot) - (dagen - 1) * DAG_MS;
  const r = bereken(werkplekken, hist.events, { van, tot, startUur, eindUur });

  const uitkomst = {
    ...r,
    opgehaald: hist.data.opgehaald,
    groepen: {
      verdieping: groepeer(r, 'verdiepingNaam'),
      wijk: groepeer(r, 'wijk'),
      lokaal: groepeer(r, 'lokaal'),
    },
    // De blokjes per werkplek zijn te omvangrijk om door te sturen.
    perWerkplek: r.perWerkplek.map(({ bins, ...rest }) => rest),
  };

  analyseCache = new Map([[sleutel, uitkomst]]);
  return uitkomst;
}

// ── Verversen ─────────────────────────────────────────────────────────────────

let verversLoopt = false;
let laatsteVerversing = null;

async function ververs(dagen) {
  if (verversLoopt) return { bezig: true };
  verversLoopt = true;
  try {
    laatsteVerversing = await verversHistoriek({ dagen });
    historiekCache = null;
    analyseCache = new Map();
    return laatsteVerversing;
  } finally {
    verversLoopt = false;
  }
}

const KWARTIER_MS = 15 * 60 * 1000;
const AUTO_DAGEN = 60;

/**
 * Werkt de historiek op de achtergrond bij. Enkel werkplekken waarvan de
 * toestellenlijst een nieuwe wissel meldt worden bevraagd, dus dit kost
 * doorgaans minder dan een seconde.
 *
 * Is er nog helemaal geen historiek, dan gebeurt er niets: die eerste ophaling
 * duurt ruim een minuut en start je bewust zelf.
 */
async function achtergrondVerversing() {
  if (!bewaardeHistoriek() || verversLoopt) return;
  try {
    const s = await ververs(AUTO_DAGEN);
    if (!s.bezig) {
      console.log(`${new Date().toLocaleTimeString('nl-BE')}  historiek bijgewerkt: ${s.bevraagd} werkplekken bevraagd, ${s.nieuweEvents} nieuwe gebeurtenissen`);
    }
  } catch (err) {
    console.error('Automatische verversing mislukt:', err.message);
  }
}

// ── Statische bestanden ───────────────────────────────────────────────────────

async function stuurBestand(res, pad) {
  try {
    const inhoud = await readFile(pad);
    res.writeHead(200, { 'Content-Type': MIMETYPES[extname(pad)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(inhoud);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Niet gevonden');
  }
}

async function leesLijf(req) {
  const stukken = [];
  for await (const s of req) stukken.push(s);
  try {
    return JSON.parse(Buffer.concat(stukken).toString() || '{}');
  } catch {
    return {};
  }
}

// ── Verzoeken afhandelen ──────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${POORT}`);
  const pad = url.pathname;

  try {
    if (pad === '/api/aanmelden' && req.method === 'POST') {
      if (!authActief()) return stuurJson(res, { ok: true, opmerking: 'Er is geen afscherming ingesteld.' });
      const lijf = await leesLijf(req);
      if (!controleerWachtwoord(lijf.wachtwoord)) {
        await new Promise((r) => setTimeout(r, 700));
        return stuurJson(res, { fout: 'Wachtwoord klopt niet' }, 401);
      }
      res.setHeader('Set-Cookie', maakKoekje());
      return stuurJson(res, { ok: true });
    }

    if (pad === '/api/afmelden') {
      res.setHeader('Set-Cookie', wisKoekje());
      return stuurJson(res, { ok: true });
    }

    // Status staat open, zodat het aanmeldscherm weet wat het moet tonen. Wie
    // niet aangemeld is, krijgt daarom enkel dat en verder geen cijfers.
    if (pad === '/api/status') {
      const binnen = aangemeld(req.headers.cookie);
      const basis = { modus: 'lokaal', authActief: authActief(), aangemeld: binnen };
      if (!binnen) return stuurJson(res, basis);

      const hist = await historiek();
      return stuurJson(res, {
        ...basis,
        historiek: hist ? { opgehaald: hist.data.opgehaald, van: hist.data.van, tot: hist.data.tot } : null,
        verversLoopt,
        laatsteVerversing,
      });
    }

    if (pad.startsWith('/api/')) {
      if (!bewaak(req, res)) return;

      const info = await toestellen({ maxLeeftijdMs: 30 * 1000 });

      if (pad === '/api/nu') return stuurJson(res, bouwNu(info.toestellen, info.opgehaald));
      if (pad === '/api/sensoren') return stuurJson(res, bouwSensoren(info.toestellen, info.opgehaald));

      if (pad === '/api/analyse') {
        const dagen = Math.min(120, Math.max(1, Number(url.searchParams.get('dagen') || 30)));
        const startUur = Math.min(23, Math.max(0, Number(url.searchParams.get('startUur') || 8)));
        const eindUur = Math.min(24, Math.max(startUur + 1, Number(url.searchParams.get('eindUur') || 17)));
        const r = await analyse({ dagen, startUur, eindUur });
        if (!r) return stuurJson(res, { fout: 'Er is nog geen historiek. Klik op Historiek verversen.' }, 404);
        return stuurJson(res, r);
      }

      if (pad === '/api/ververs' && req.method === 'POST') {
        const dagen = Math.min(180, Math.max(7, Number(url.searchParams.get('dagen') || 60)));
        return stuurJson(res, await ververs(dagen));
      }

      return stuurJson(res, { fout: 'Onbekend eindpunt' }, 404);
    }

    const bestand = pad === '/' ? 'index.html' : normalize(pad).replace(/^[\\/]+/, '');
    if (bestand.includes('..')) {
      res.writeHead(400);
      return res.end('Ongeldig pad');
    }
    return stuurBestand(res, join(PUBLIC, bestand));
  } catch (err) {
    console.error(err);
    return stuurJson(res, { fout: err.message }, 500);
  }
});

server.listen(POORT, () => {
  console.log(`Werkplekdashboard draait op http://localhost:${POORT}`);
  if (authActief()) console.log('Afscherming staat aan: er wordt een wachtwoord gevraagd.');

  const bewaard = bewaardeHistoriek();
  if (!bewaard) {
    console.log('Er is nog geen historiek. Haal ze op met: node src/refresh.js 60');
    return;
  }

  console.log(`Historiek bijgewerkt tot ${new Date(bewaard.tot).toLocaleString('nl-BE')}. Wordt elk kwartier automatisch bijgewerkt.`);

  // Bij het opstarten inhalen wat er sinds de vorige keer bijgekomen is, maar
  // pas nadat de server antwoordt.
  setTimeout(achtergrondVerversing, 5000);
  setInterval(achtergrondVerversing, KWARTIER_MS);
});
