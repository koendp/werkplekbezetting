/**
 * Geeft de vooraf berekende analyse terug.
 *
 * Online wordt er niet gerekend: een geplande taak zet de uitkomst in
 * data/momentopname.js. Zie src/snapshot.js.
 */

import momentopname from '../data/momentopname.js';
import { bewaak, stuurJson, afhandelen } from '../src/http.js';

export default afhandelen(async (req, res) => {
  if (!bewaak(req, res)) return;

  const gevraagd = Number(new URL(req.url, 'http://x').searchParams.get('dagen') || 30);
  const dagen = momentopname.periodes.includes(gevraagd) ? gevraagd : 30;

  return stuurJson(res, { ...momentopname.analyses[dagen], momentopnameGemaakt: momentopname.gemaakt });
});
