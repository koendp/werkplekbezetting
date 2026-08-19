/**
 * Eenvoudige afscherming met één gedeeld wachtwoord.
 *
 * Na een geslaagde aanmelding krijgt de browser een koekje met een vervaltijd en
 * een handtekening. Het wachtwoord zelf gaat niet mee terug en staat nergens aan
 * de kant van de browser. De handtekening wordt gemaakt met een geheim dat
 * alleen de server kent.
 *
 * Dit is bewust klein gehouden: het houdt toevallige bezoekers en zoekmachines
 * buiten. Het is geen vervanging voor een aanmelding met personeelsaccounts.
 *
 * Staat er geen wachtwoord ingesteld, dan is de afscherming uitgeschakeld. Zo
 * blijft de lokale versie zonder aanmelding werken.
 */

import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const KOEKJE = 'werkplek_sessie';
const GELDIG_MS = 12 * 60 * 60 * 1000;

export function wachtwoord() {
  return process.env.AUTH_WACHTWOORD || null;
}

/**
 * Sleutel om het koekje mee te tekenen. Online draaien er meerdere exemplaren
 * van dezelfde functie naast elkaar, dus die moeten allemaal dezelfde sleutel
 * gebruiken. Zonder `SESSIE_GEHEIM` wordt de sleutel daarom afgeleid van het
 * wachtwoord, wat overal hetzelfde resultaat geeft. Verandert het wachtwoord,
 * dan vervallen alle lopende sessies vanzelf.
 */
function sleutel() {
  if (process.env.SESSIE_GEHEIM) return process.env.SESSIE_GEHEIM;
  const ww = wachtwoord();
  if (ww) return createHash('sha256').update('werkplek-sessie:' + ww).digest('hex');
  return randomBytes(32).toString('hex');
}

const geheim = sleutel();

export function authActief() {
  return Boolean(wachtwoord());
}

/** Vergelijking die niet sneller stopt bij een vroege afwijking. */
function gelijk(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function teken(vervalt) {
  return createHmac('sha256', geheim).update(String(vervalt)).digest('base64url');
}

export function controleerWachtwoord(ingevoerd) {
  const verwacht = wachtwoord();
  if (!verwacht) return false;
  return gelijk(ingevoerd ?? '', verwacht);
}

/** Maakt de waarde voor de Set-Cookie-kop na een geslaagde aanmelding. */
export function maakKoekje() {
  const vervalt = Date.now() + GELDIG_MS;
  const waarde = `${vervalt}.${teken(vervalt)}`;
  return `${KOEKJE}=${waarde}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${Math.floor(GELDIG_MS / 1000)}`;
}

export function wisKoekje() {
  return `${KOEKJE}=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0`;
}

/** Controleert het koekje uit de Cookie-kop van een verzoek. */
export function aangemeld(cookieKop) {
  if (!authActief()) return true;
  if (!cookieKop) return false;

  const paar = cookieKop.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${KOEKJE}=`));
  if (!paar) return false;

  const [vervalt, handtekening] = paar.slice(KOEKJE.length + 1).split('.');
  if (!vervalt || !handtekening) return false;
  if (Number(vervalt) < Date.now()) return false;

  return gelijk(handtekening, teken(vervalt));
}
