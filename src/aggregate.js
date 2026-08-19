/**
 * Rekent toestandswissels van de sensoren om naar bezettingscijfers.
 *
 * De sensoren sturen enkel wissels door (OCCUPIED / NOT_OCCUPIED). Per werkplek
 * bouwen we daaruit een tijdlijn, die we in blokjes van 15 minuten gieten.
 * Een blokje krijgt de fractie van de tijd dat de plek bezet was, zodat de som
 * over alle werkplekken het verwachte aantal bezette plekken geeft.
 */

const TIJDZONE = 'Europe/Brussels';
export const BIN_MIN = 15;
export const BINS_PER_DAG = (24 * 60) / BIN_MIN;
const BIN_MS = BIN_MIN * 60 * 1000;
const DAG_MS = 24 * 60 * 60 * 1000;

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIJDZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const offsetCache = new Map();

/** Verschil tussen lokale tijd in Brussel en UTC, in milliseconden. */
function offsetMs(ms) {
  const bucket = Math.floor(ms / 3600000);
  if (offsetCache.has(bucket)) return offsetCache.get(bucket);

  const p = Object.fromEntries(
    formatter.formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  const alsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const off = alsUtc - Math.floor(ms / 1000) * 1000;

  offsetCache.set(bucket, off);
  return off;
}

/** Zet UTC-tijd om naar lokale tijd, uitgedrukt alsof het UTC was. */
function naarLokaal(ms) {
  return ms + offsetMs(ms);
}

/** Lokale middernacht van de dag waarin dit tijdstip valt, als UTC-tijdstip. */
export function lokaleDagStart(ms = Date.now()) {
  const middernachtLokaal = Math.floor(naarLokaal(ms) / DAG_MS) * DAG_MS;
  return middernachtLokaal - offsetMs(ms);
}

const gemiddelde = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

function percentiel(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/** Haalt tijdstip en toestand uit een ruwe gebeurtenis. */
function leesEvent(e) {
  const bezet = e.data && e.data.deskOccupancy ? e.data.deskOccupancy : null;
  return {
    t: Date.parse((bezet && bezet.updateTime) || e.timestamp),
    state: bezet ? bezet.state : null,
  };
}

/** Bouwt de lijst met bezette periodes van één werkplek binnen het venster. */
export function bezettePeriodes(events, van, tot, beginToestand = null) {
  const gesorteerd = events
    .map(leesEvent)
    .filter((e) => Number.isFinite(e.t) && e.state)
    .sort((a, b) => a.t - b.t);

  let toestand = beginToestand;
  let start = van;
  const periodes = [];
  let wissels = 0;

  for (const e of gesorteerd) {
    if (e.t <= van) {
      toestand = e.state;
      continue;
    }
    if (e.t > tot) break;
    wissels++;
    if (e.state !== toestand) {
      if (toestand === 'OCCUPIED') periodes.push([start, e.t]);
      toestand = e.state;
      start = e.t;
    }
  }
  if (toestand === 'OCCUPIED') periodes.push([start, tot]);

  return { periodes, eindToestand: toestand, wissels };
}

/** Verdeelt bezette periodes over blokjes van 15 minuten. */
function vulBins(periodes, bins, rasterStart) {
  for (const periode of periodes) {
    const van = naarLokaal(periode[0]);
    const tot = naarLokaal(periode[1]);
    const eerste = Math.max(0, Math.floor((van - rasterStart) / BIN_MS));
    const laatste = Math.min(bins.length - 1, Math.floor((tot - rasterStart) / BIN_MS));

    for (let b = eerste; b <= laatste; b++) {
      const binVan = rasterStart + b * BIN_MS;
      const overlap = Math.min(tot, binVan + BIN_MS) - Math.max(van, binVan);
      if (overlap > 0) bins[b] += overlap / BIN_MS;
    }
  }
}

/**
 * Hoofdberekening: van ruwe gebeurtenissen naar bezettingscijfers.
 *
 * @param {Array} werkplekken ontlede toestellen
 * @param {Map} eventsPerToestel toestel-id naar lijst gebeurtenissen
 * @param {{van:number, tot:number, startUur?:number, eindUur?:number}} venster
 */
export function bereken(werkplekken, eventsPerToestel, venster) {
  const van = venster.van;
  const tot = venster.tot;
  const startUur = venster.startUur === undefined ? 8 : venster.startUur;
  const eindUur = venster.eindUur === undefined ? 17 : venster.eindUur;

  const rasterStart = Math.floor(naarLokaal(van) / DAG_MS) * DAG_MS;
  const rasterEind = Math.ceil(naarLokaal(tot) / DAG_MS) * DAG_MS;
  const aantalDagen = Math.round((rasterEind - rasterStart) / DAG_MS);
  const aantalBins = aantalDagen * BINS_PER_DAG;

  const eersteKantoorBin = Math.floor((startUur * 60) / BIN_MIN);
  const laatsteKantoorBin = Math.floor((eindUur * 60) / BIN_MIN) - 1;

  const dagen = [];
  for (let d = 0; d < aantalDagen; d++) {
    const datum = new Date(rasterStart + d * DAG_MS);
    const weekdag = (datum.getUTCDay() + 6) % 7; // 0 = maandag
    dagen.push({
      datum: datum.toISOString().slice(0, 10),
      weekdag,
      werkdag: weekdag < 5,
      volledig: rasterStart + (d + 1) * DAG_MS <= naarLokaal(tot),
    });
  }

  const totaalBins = new Float32Array(aantalBins);
  const perWerkplek = [];

  for (const wp of werkplekken) {
    const ruwe = eventsPerToestel.get(wp.id);
    const events = Array.isArray(ruwe) ? ruwe : [];
    const geenData = !Array.isArray(ruwe) || (events.length === 0 && !wp.toestandSinds);

    // Begintoestand: laatste wissel voor het venster, anders de huidige
    // toestand als die al van voor het venster dateert.
    let begin = null;
    const voorVenster = events
      .map(leesEvent)
      .filter((e) => Number.isFinite(e.t) && e.state && e.t <= van)
      .sort((a, b) => a.t - b.t);

    if (voorVenster.length) begin = voorVenster[voorVenster.length - 1].state;
    else if (wp.toestandSinds && Date.parse(wp.toestandSinds) <= van) begin = wp.toestand;

    const tijdlijn = bezettePeriodes(events, van, tot, begin);

    const bins = new Float32Array(aantalBins);
    vulBins(tijdlijn.periodes, bins, rasterStart);
    for (let i = 0; i < aantalBins; i++) totaalBins[i] += bins[i];

    let bezetteUren = 0;
    let kantoorSom = 0;
    let kantoorBins = 0;
    const dagenGebruikt = new Set();

    for (let d = 0; d < aantalDagen; d++) {
      let dagSom = 0;
      for (let b = 0; b < BINS_PER_DAG; b++) {
        const v = bins[d * BINS_PER_DAG + b];
        dagSom += v;
        if (dagen[d].werkdag && dagen[d].volledig && b >= eersteKantoorBin && b <= laatsteKantoorBin) {
          kantoorSom += v;
          kantoorBins++;
        }
      }
      bezetteUren += (dagSom * BIN_MIN) / 60;
      if (dagSom > 0.5) dagenGebruikt.add(dagen[d].datum);
    }

    const werkdagen = dagen.filter((d) => d.werkdag && d.volledig).length;

    perWerkplek.push({
      id: wp.id,
      naam: wp.naam,
      lokaal: wp.lokaal,
      verdiepingNaam: wp.verdiepingNaam,
      wijk: wp.wijk,
      toestand: wp.toestand,
      bezetteUren: +bezetteUren.toFixed(1),
      bezettingsgraad: kantoorBins ? +(kantoorSom / kantoorBins).toFixed(4) : 0,
      dagenGebruikt: dagenGebruikt.size,
      werkdagen,
      aandeelDagen: werkdagen ? +(dagenGebruikt.size / werkdagen).toFixed(3) : 0,
      wissels: tijdlijn.wissels,
      geenData,
      bins: Array.from(bins),
    });
  }

  const aantalPlekken = werkplekken.length || 1;
  const perUurWaarden = Array.from({ length: 24 }, () => []);
  const perWeekdagWaarden = Array.from({ length: 7 }, () => ({ gem: [], piek: [] }));
  const perDag = [];
  const binsPerUur = 60 / BIN_MIN;

  for (let d = 0; d < aantalDagen; d++) {
    const dagBins = Array.from(totaalBins.slice(d * BINS_PER_DAG, (d + 1) * BINS_PER_DAG));
    const kantoor = dagBins.slice(eersteKantoorBin, laatsteKantoorBin + 1);
    const piek = Math.max(0, ...dagBins);
    const gem = gemiddelde(kantoor);

    perDag.push({
      datum: dagen[d].datum,
      weekdag: dagen[d].weekdag,
      werkdag: dagen[d].werkdag,
      volledig: dagen[d].volledig,
      gemiddeld: +gem.toFixed(2),
      piek: +piek.toFixed(2),
      bezettingsgraad: +(gem / aantalPlekken).toFixed(4),
      piekgraad: +(piek / aantalPlekken).toFixed(4),
      verloop: dagBins.map((v) => +v.toFixed(2)),
    });

    if (dagen[d].volledig) {
      perWeekdagWaarden[dagen[d].weekdag].gem.push(gem);
      perWeekdagWaarden[dagen[d].weekdag].piek.push(piek);
      if (dagen[d].werkdag) {
        for (let u = 0; u < 24; u++) {
          perUurWaarden[u].push(gemiddelde(dagBins.slice(u * binsPerUur, (u + 1) * binsPerUur)));
        }
      }
    }
  }

  const werkdagen = perDag.filter((d) => d.werkdag && d.volledig);
  const werkdagPieken = werkdagen.map((d) => d.piek);
  const werkdagGemiddelden = werkdagen.map((d) => d.gemiddeld);
  const gemBezetting = gemiddelde(werkdagGemiddelden);
  const maxPiek = Math.max(0, ...werkdagPieken);

  return {
    venster: {
      van: new Date(van).toISOString(),
      tot: new Date(tot).toISOString(),
      dagen: aantalDagen,
      werkdagen: werkdagen.length,
      startUur,
      eindUur,
    },
    aantalPlekken: werkplekken.length,
    kerncijfers: {
      gemiddeldeBezetting: +gemBezetting.toFixed(1),
      gemiddeldeBezettingsgraad: +(gemBezetting / aantalPlekken).toFixed(4),
      piekBezetting: +maxPiek.toFixed(1),
      piekBezettingsgraad: +(maxPiek / aantalPlekken).toFixed(4),
      piekP95: +percentiel(werkdagPieken, 95).toFixed(1),
      piekMediaan: +percentiel(werkdagPieken, 50).toFixed(1),
      nooitGebruikt: perWerkplek.filter((w) => !w.geenData && w.dagenGebruikt === 0).length,
      zonderData: perWerkplek.filter((w) => w.geenData).length,
    },
    perUur: perUurWaarden.map((v) => +gemiddelde(v).toFixed(2)),
    perWeekdag: perWeekdagWaarden.map((w, i) => ({
      weekdag: i,
      gemiddeld: +gemiddelde(w.gem).toFixed(2),
      piek: +gemiddelde(w.piek).toFixed(2),
      dagen: w.gem.length,
    })),
    perDag,
    perWerkplek,
    dagen,
    eersteKantoorBin,
    laatsteKantoorBin,
  };
}

/** Groepeert de werkplekresultaten per verdieping, wijk of lokaal. */
export function groepeer(resultaat, sleutel) {
  const groepen = new Map();
  const binsPerUur = 60 / BIN_MIN;

  for (const wp of resultaat.perWerkplek) {
    const naam = wp[sleutel] || 'Onbekend';
    if (!groepen.has(naam)) {
      groepen.set(naam, { naam, plekken: [], bins: new Float32Array(wp.bins.length) });
    }
    const g = groepen.get(naam);
    g.plekken.push(wp);
    for (let i = 0; i < wp.bins.length; i++) g.bins[i] += wp.bins[i];
  }

  const eersteKantoorBin = resultaat.eersteKantoorBin;
  const laatsteKantoorBin = resultaat.laatsteKantoorBin;

  const uitkomst = [...groepen.values()].map((g) => {
    const kantoorWaarden = [];
    const pieken = [];
    const perUurWaarden = Array.from({ length: 24 }, () => []);

    resultaat.dagen.forEach((dag, d) => {
      if (!dag.werkdag || !dag.volledig) return;
      const dagBins = Array.from(g.bins.slice(d * BINS_PER_DAG, (d + 1) * BINS_PER_DAG));
      kantoorWaarden.push(gemiddelde(dagBins.slice(eersteKantoorBin, laatsteKantoorBin + 1)));
      pieken.push(Math.max(0, ...dagBins));
      for (let u = 0; u < 24; u++) {
        perUurWaarden[u].push(gemiddelde(dagBins.slice(u * binsPerUur, (u + 1) * binsPerUur)));
      }
    });

    const aantal = g.plekken.length || 1;
    const gem = gemiddelde(kantoorWaarden);
    const piek = Math.max(0, ...pieken);

    return {
      naam: g.naam,
      aantalPlekken: g.plekken.length,
      gemiddeld: +gem.toFixed(2),
      bezettingsgraad: +(gem / aantal).toFixed(4),
      piek: +piek.toFixed(2),
      piekgraad: +(piek / aantal).toFixed(4),
      nooitGebruikt: g.plekken.filter((w) => !w.geenData && w.dagenGebruikt === 0).length,
      zonderData: g.plekken.filter((w) => w.geenData).length,
      perUur: perUurWaarden.map((v) => +gemiddelde(v).toFixed(2)),
    };
  });

  return uitkomst.sort((a, b) => b.aantalPlekken - a.aantalPlekken);
}
