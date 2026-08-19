/** Toestand van de sensoren, rechtstreeks bij de API opgehaald. */

import { listDevices } from '../src/dt.js';
import { ontleedToestel } from '../src/parse.js';
import { bouwSensoren } from '../src/model.js';
import { bewaak, stuurJson, afhandelen } from '../src/http.js';

export default afhandelen(async (req, res) => {
  if (!bewaak(req, res)) return;
  const toestellen = (await listDevices()).map(ontleedToestel);
  return stuurJson(res, bouwSensoren(toestellen, new Date().toISOString()));
});
