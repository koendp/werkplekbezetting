/**
 * Vertelt het dashboard waar het draait en hoe vers de cijfers zijn.
 *
 * Dit eindpunt staat open, zodat het aanmeldscherm weet wat het moet tonen.
 * Wie niet aangemeld is, krijgt daarom enkel dat en verder geen cijfers.
 */

import momentopname from '../data/momentopname.js';
import { authActief, aangemeld } from '../src/auth.js';
import { stuurJson, afhandelen } from '../src/http.js';

export default afhandelen(async (req, res) => {
  const binnen = aangemeld(req.headers.cookie);
  const basis = { modus: 'online', authActief: authActief(), aangemeld: binnen };

  if (!binnen) return stuurJson(res, basis);

  return stuurJson(res, {
    ...basis,
    momentopnameGemaakt: momentopname.gemaakt,
    periodes: momentopname.periodes,
    startUur: momentopname.startUur,
    eindUur: momentopname.eindUur,
    historiek: { opgehaald: momentopname.gemaakt },
  });
});
