/** Kleine hulpjes die de lokale server en de online functies allebei gebruiken. */

import { aangemeld, authActief } from './auth.js';

/**
 * Laat het verzoek door als er geen afscherming is of als de sessie klopt.
 * Zo niet, dan wordt er een 401 teruggegeven en is er niets meer te doen.
 *
 * @returns {boolean} of het verzoek verder afgehandeld mag worden
 */
export function bewaak(req, res) {
  if (aangemeld(req.headers.cookie)) return true;
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ fout: 'Niet aangemeld', aanmeldenNodig: true }));
  return false;
}

export function stuurJson(res, inhoud, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(inhoud));
}

/** Vangt fouten af zodat een functie nooit een lege of onduidelijke fout teruggeeft. */
export function afhandelen(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      stuurJson(res, { fout: err.message }, 500);
    }
  };
}

export { authActief };
