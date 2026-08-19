/** Wist het sessiekoekje. */

import { wisKoekje } from '../src/auth.js';
import { stuurJson, afhandelen } from '../src/http.js';

export default afhandelen(async (req, res) => {
  res.setHeader('Set-Cookie', wisKoekje());
  return stuurJson(res, { ok: true });
});
