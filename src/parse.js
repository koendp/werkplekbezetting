/**
 * Ontleedt de sensornamen naar een bruikbare indeling.
 *
 * De meeste werkplekken heten "<lokaal>.<bureau>-W<verdieping>.<wijk>",
 * bijvoorbeeld "301.B19-W3.2". Daarnaast bestaan er varianten met een
 * zone-achtervoegsel ("-130.B26-MOR", "339.B11-Stock") en namen zonder
 * enige structuur ("onbekend 3", "vrij", "Test01").
 */

const PATROON = /^(-?\d{1,3})\.(B\d+)(?:-(.*))?$/i;
const WIJK_PATROON = /^W(-?\d+)\.(\d*)$/i;

/** Leidt de verdieping af uit het lokaalnummer: -130 is kelder, 021 is gelijkvloers, 301 is de derde. */
function verdiepingUitLokaal(lokaal) {
  const n = Number(lokaal);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return -1;
  return Math.floor(n / 100);
}

export function verdiepingLabel(v) {
  if (v === null || v === undefined) return 'Onbekend';
  if (v === -1) return 'Kelder';
  if (v === 0) return 'Gelijkvloers';
  return `Verdieping ${v}`;
}

/**
 * @returns {{naam, lokaal, bureau, verdieping, verdiepingNaam, wijk, zone, gestructureerd}}
 */
export function ontleedNaam(ruweNaam) {
  const naam = (ruweNaam ?? '').trim();

  const leeg = {
    naam: naam || '(naamloos)',
    lokaal: null,
    bureau: null,
    verdieping: null,
    verdiepingNaam: 'Onbekend',
    wijk: 'Niet toegewezen',
    zone: null,
    gestructureerd: false,
  };

  const m = naam.match(PATROON);
  if (!m) return leeg;

  const [, lokaal, bureau, achtervoegsel] = m;
  let verdieping = verdiepingUitLokaal(lokaal);
  let wijk = null;
  let zone = null;

  if (achtervoegsel) {
    const w = achtervoegsel.match(WIJK_PATROON);
    if (w) {
      verdieping = Number(w[1]);
      // "021.B01-W0." mist het wijknummer; dan blijft alleen de verdieping over.
      wijk = w[2] ? `W${w[1]}.${w[2]}` : null;
    } else {
      zone = achtervoegsel.trim();
    }
  }

  return {
    naam,
    lokaal,
    bureau,
    verdieping,
    verdiepingNaam: verdiepingLabel(verdieping),
    wijk: wijk ?? zone ?? 'Niet toegewezen',
    zone,
    gestructureerd: true,
  };
}

/** Zet een ruw toestel uit de API om naar het model dat het dashboard gebruikt. */
export function ontleedToestel(d) {
  const id = (d.name ?? '').split('/').pop();
  const labels = d.labels ?? {};
  const naam = labels.name || labels.description || id;
  const gerapporteerd = d.reported ?? {};

  return {
    id,
    type: d.type,
    ...ontleedNaam(naam),
    beschrijving: labels.description ?? null,
    kit: labels.kit ?? null,
    actief: d.active !== false,
    toestand: gerapporteerd.deskOccupancy?.state ?? null,
    toestandSinds: gerapporteerd.deskOccupancy?.updateTime ?? null,
    batterij: gerapporteerd.batteryStatus?.percentage ?? null,
    batterijStatus: gerapporteerd.batteryStatus?.state ?? null,
    batterijJaren: gerapporteerd.batteryStatus?.estimatedRemainingYears ?? null,
    signaal: gerapporteerd.networkStatus?.signalStrength ?? null,
    laatsteSignaal: gerapporteerd.networkStatus?.updateTime ?? null,
    verbinding: gerapporteerd.connectionStatus?.connection ?? null,
  };
}
