/** Neemt het wachtwoord aan en geeft bij een treffer een sessiekoekje terug. */

import { controleerWachtwoord, maakKoekje, authActief } from '../src/auth.js';
import { stuurJson, afhandelen } from '../src/http.js';

export default afhandelen(async (req, res) => {
  if (req.method !== 'POST') return stuurJson(res, { fout: 'Alleen POST' }, 405);

  if (!authActief()) return stuurJson(res, { ok: true, opmerking: 'Er is geen afscherming ingesteld.' });

  let lijf = req.body;
  if (typeof lijf === 'string') { try { lijf = JSON.parse(lijf); } catch { lijf = {}; } }
  if (!lijf) {
    const stukken = [];
    for await (const s of req) stukken.push(s);
    try { lijf = JSON.parse(Buffer.concat(stukken).toString() || '{}'); } catch { lijf = {}; }
  }

  if (!controleerWachtwoord(lijf.wachtwoord)) {
    // Even wachten, zodat het niet aantrekkelijk wordt om wachtwoorden af te gaan.
    await new Promise((r) => setTimeout(r, 700));
    return stuurJson(res, { fout: 'Wachtwoord klopt niet' }, 401);
  }

  res.setHeader('Set-Cookie', maakKoekje());
  return stuurJson(res, { ok: true });
});
