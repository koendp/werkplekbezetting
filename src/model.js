/**
 * Bouwt de gegevens voor de tabbladen Nu en Sensoren uit een toestellenlijst.
 *
 * Deze functies staan los van waar de gegevens vandaan komen, zodat de lokale
 * server en de online functies dezelfde uitkomst geven.
 */

const DAG_MS = 24 * 60 * 60 * 1000;

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

/** Actuele bezetting, per verdieping en per werkwijk. */
export function bouwNu(toestellen, opgehaald) {
  const werkplekken = toestellen.filter((t) => t.type === 'deskOccupancy');
  const bezet = werkplekken.filter((w) => w.toestand === 'OCCUPIED').length;
  const vrij = werkplekken.filter((w) => w.toestand === 'NOT_OCCUPIED').length;

  return {
    opgehaald,
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

/** Toestand van de sensoren: batterij, bereik en toestellen die zwijgen. */
export function bouwSensoren(toestellen, opgehaald) {
  const nu = Date.now();

  const lijst = toestellen
    .filter((t) => t.type !== 'ccon')
    .map((t) => {
      const stilMs = t.laatsteSignaal ? nu - Date.parse(t.laatsteSignaal) : null;
      const bezetSindsMs = t.toestand === 'OCCUPIED' && t.toestandSinds ? nu - Date.parse(t.toestandSinds) : null;
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
    opgehaald,
    totaal: lijst.length,
    cloudConnectors: toestellen.filter((t) => t.type === 'ccon').length,
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
