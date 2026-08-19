/**
 * Lokale webserver voor het werkplekdashboard.
 *
 * Start met: node server.js   (of dubbelklik start.bat)
 * Open dan:  http://localhost:5180
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { toestellen, bewaardeHistoriek, verversHistoriek } from './src/cache.js';
import { bereken, groepeer, lokaleDagStart } from './src/aggregate.js';

const root = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(root, 'public');
const POORT = Number(process.env.POORT || 5180);
const DAG_MS = 24 * 60 * 60 * 1000;

const MIMETYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

// ── Live toestand ─────────────────────────────────────────────────────────────

function telPerGroep(werkplekken, sleutel) {
  const groepen = new Map();
  for (const w of werkplekken) {
    const naam = w[sleutel] || 'Onbekend';
    if (!groepen.has(naam)) groepen.set(naam, { naam, totaal: 0, bezet: 0, vrij: 0, onbekend: 0 });
    const g = groepen.get(naam);
    g.totaal++;
    if (w.toestand === 'OCCUPIED') g.bezet++;
    else if (w.toestand === 'NOT_OCCUPIED') g.vrij++;
    else g.onbekend++;
  }
  return [...groepen.values()]
    .map((g) => ({ ...g, graad: g.totaal ? +(g.bezet / g.totaal).toFixed(3) : 0 }))
    .sort((a, b) => b.totaal - a.totaal);
}

async function nu() {
  const info = await toestellen({ maxLeeftijdMs: 30 * 1000 });
  const werkplekken = info.toestellen.filter((t) => t.type === 'deskOccupancy');

  const bezet = werkplekken.filter((w) => w.toestand === 'OCCUPIED').length;
  const vrij = werkplekken.filter((w) => w.toestand === 'NOT_OCCUPIED').length;

  return {
    opgehaald: info.opgehaald,
    totaal: werkplekken.length,
    bezet,
    vrij,
    onbekend: werkplekken.length - bezet - vrij,
    graad: werkplekken.length ? +(bezet / werkplekken.length).toFixed(3) : 0,
    perVerdieping: telPerGroep(werkplekken, 'verdiepingNaam'),
    perWijk: telPerGroep(werkplekken, 'wijk'),
    werkplekken: werkplekken.map((w) => ({
      id: w.id,
      naam: w.naam,
      lokaal: w.lokaal,
      verdiepingNaam: w.verdiepingNaam,
      wijk: w.wijk,
      toestand: w.toestand,
      toestandSinds: w.toestandSinds,
    })),
  };
}

// ── Toestand van de sensoren ──────────────────────────────────────────────────

async function sensoren() {
  const info = await toestellen({ maxLeeftijdMs: 30 * 1000 });
  const nuMs = Date.now();

  const lijst = info.toestellen
    .filter((t) => t.type !== 'ccon')
    .map((t) => {
      const stilMs = t.laatsteSignaal ? nuMs - Date.parse(t.laatsteSignaal) : null;
      const bezetSindsMs = t.toestand === 'OCCUPIED' && t.toestandSinds ? nuMs - Date.parse(t.toestandSinds) : null;

      const stil = stilMs === null || stilMs > 24 * 3600 * 1000;

      const problemen = [];
      if (!t.actief) problemen.push('uitgeschakeld');
      if (stil) problemen.push('geen signaal (>24u)');
      // De toestand UNKNOWN komt vaak voor bij sensoren die net stil vallen; die
      // melden we niet apart, want het echte probleem staat er dan al.
      if (t.batterijStatus === 'LOW' || t.batterijStatus === 'CRITICAL') {
        problemen.push('batterij ' + t.batterijStatus.toLowerCase());
      } else if (t.batterij !== null && t.batterij <= 20) {
        problemen.push('batterij laag');
      }
      if (!stil && t.signaal !== null && t.signaal < 20) problemen.push('zwak signaal');
      if (!stil && bezetSindsMs !== null && bezetSindsMs > 4 * DAG_MS) problemen.push('staat al dagen bezet');

      const ernst = problemen.some((p) => p.startsWith('geen signaal') || p === 'uitgeschakeld')
        ? 'critical'
        : problemen.length
          ? 'warning'
          : 'good';

      return {
        id: t.id,
        naam: t.naam,
        type: t.type,
        verdiepingNaam: t.verdiepingNaam,
        wijk: t.wijk,
        batterij: t.batterij,
        batterijJaren: t.batterijJaren === null ? null : +t.batterijJaren.toFixed(1),
        signaal: t.signaal,
        laatsteSignaal: t.laatsteSignaal,
        urenStil: stilMs === null ? null : +(stilMs / 3600000).toFixed(1),
        dagenBezet: bezetSindsMs === null ? null : +(bezetSindsMs / DAG_MS).toFixed(1),
        problemen,
        ernst,
      };
    });

  return {
    opgehaald: info.opgehaald,
    totaal: lijst.length,
    cloudConnectors: info.toestellen.filter((t) => t.type === 'ccon').length,
    inOrde: lijst.filter((s) => s.ernst === 'good').length,
    aandacht: lijst.filter((s) => s.ernst === 'warning').length,
    kritiek: lijst.filter((s) => s.ernst === 'critical').length,
    // Eerst het meest dringende, en binnen dezelfde ernst het langst stille
    // toestel bovenaan. Zo staat de lijst elke keer in dezelfde volgorde.
    sensoren: lijst
      .filter((s) => s.problemen.length)
      .sort((a, b) => {
        if (a.ernst !== b.ernst) return a.ernst === 'critical' ? -1 : 1;
        if (b.problemen.length !== a.problemen.length) return b.problemen.length - a.problemen.length;
        return (b.urenStil ?? Infinity) - (a.urenStil ?? Infinity);
      }),
  };
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

// ── HTTP ──────────────────────────────────────────────────────────────────────

function stuurJson(res, inhoud, status = 200) {
  const body = JSON.stringify(inhoud);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${POORT}`);
  const pad = url.pathname;

  try {
    if (pad === '/api/nu') return stuurJson(res, await nu());
    if (pad === '/api/sensoren') return stuurJson(res, await sensoren());

    if (pad === '/api/analyse') {
      const dagen = Math.min(120, Math.max(1, Number(url.searchParams.get('dagen') || 30)));
      const startUur = Math.min(23, Math.max(0, Number(url.searchParams.get('startUur') || 8)));
      const eindUur = Math.min(24, Math.max(startUur + 1, Number(url.searchParams.get('eindUur') || 17)));
      const r = await analyse({ dagen, startUur, eindUur });
      if (!r) return stuurJson(res, { fout: 'Er is nog geen historiek. Klik op Historiek verversen.' }, 404);
      return stuurJson(res, r);
    }

    if (pad === '/api/status') {
      const hist = await historiek();
      return stuurJson(res, {
        historiek: hist ? { opgehaald: hist.data.opgehaald, van: hist.data.van, tot: hist.data.tot } : null,
        verversLoopt,
        laatsteVerversing,
      });
    }

    if (pad === '/api/ververs' && req.method === 'POST') {
      const dagen = Math.min(180, Math.max(7, Number(url.searchParams.get('dagen') || 60)));
      return stuurJson(res, await ververs(dagen));
    }

    // Statische bestanden
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
