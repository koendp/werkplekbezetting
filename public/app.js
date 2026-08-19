/* Werkplekdashboard: opbouw van de grafieken en tabellen. */

const $ = (s, w = document) => w.querySelector(s);
const $$ = (s, w = document) => [...w.querySelectorAll(s)];

const getal = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const getal1 = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 });
const pct = (v) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 1 : 0)}%`;
const DAGNAMEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
const DAGKORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

const ontsnap = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function datumKort(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function tijdKort(iso) {
  if (!iso) return 'onbekend';
  return new Date(iso).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function geleden(iso) {
  if (!iso) return 'onbekend';
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 24) return `${Math.round(min / 60)} uur`;
  return `${Math.round(min / 1440)} dagen`;
}

/* ── Aanmelden ───────────────────────────────────────────────────────────── */

/**
 * Alle gegevens lopen via deze functie. Antwoordt de server met 401, dan is de
 * sessie verlopen of nog niet gestart en verschijnt het aanmeldscherm.
 */
async function haal(url, opties) {
  const res = await fetch(url, opties);
  if (res.status === 401) {
    toonAanmelden();
    const err = new Error('Niet aangemeld');
    err.aanmeldenNodig = true;
    throw err;
  }
  return res;
}

const negeerAanmelding = (err) => { if (!err.aanmeldenNodig) throw err; };

function toonAanmelden() {
  const scherm = $('#aanmelden');
  if (!scherm.hidden) return;
  scherm.hidden = false;
  $('#wachtwoord').focus();
}

/* ── Tooltip ─────────────────────────────────────────────────────────────── */

const tooltip = $('#tooltip');

function toonTip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.classList.add('aan');
  const marge = 14;
  const b = tooltip.getBoundingClientRect();
  let x = evt.clientX + marge;
  let y = evt.clientY + marge;
  if (x + b.width > innerWidth - 8) x = evt.clientX - b.width - marge;
  if (y + b.height > innerHeight - 8) y = evt.clientY - b.height - marge;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

const verbergTip = () => tooltip.classList.remove('aan');
document.addEventListener('scroll', verbergTip, true);

/* ── Grafiekbouwstenen ───────────────────────────────────────────────────── */

/** Staafpad met afgeronde bovenkant, verankerd op de nullijn. */
function staafPad(x, y, b, h, r = 4) {
  const straal = Math.max(0, Math.min(r, b / 2, h));
  if (h <= 0.5) return '';
  return `M${x},${y + h} L${x},${y + straal} Q${x},${y} ${x + straal},${y} L${x + b - straal},${y} Q${x + b},${y} ${x + b},${y + straal} L${x + b},${y + h} Z`;
}

/** Nette schaalstappen voor de y-as. */
function asStappen(max, aantal = 4) {
  if (max <= 0) return [0, 1];
  const ruw = max / aantal;
  const macht = 10 ** Math.floor(Math.log10(ruw));
  const stap = [1, 2, 2.5, 5, 10].map((m) => m * macht).find((s) => s >= ruw) ?? 10 * macht;
  const stappen = [];
  for (let v = 0; v <= max + stap * 0.001; v += stap) stappen.push(+v.toFixed(6));
  if (stappen[stappen.length - 1] < max) stappen.push(stappen[stappen.length - 1] + stap);
  return stappen;
}

/** Houdt een tekenfunctie bij zodat de grafiek meeschaalt met het venster. */
const hertekenaars = new Map();

function tekenIn(houder, fn) {
  hertekenaars.set(houder, fn);
  fn(houder);
}

let hertekenTimer;
addEventListener('resize', () => {
  clearTimeout(hertekenTimer);
  hertekenTimer = setTimeout(() => {
    for (const [houder, fn] of hertekenaars) {
      if (houder.isConnected && houder.offsetParent !== null) fn(houder);
    }
  }, 150);
});

/**
 * Lijngrafiek met vlak eronder en een kruisdraad bij aanwijzen.
 * @param {{labels:string[], waarden:number[], eenheid?:string, tip?:Function, band?:[number,number]}} opties
 */
function lijnGrafiek(houder, opties) {
  tekenIn(houder, (el) => {
    const { labels, waarden, tip, band } = opties;
    const b = Math.max(320, el.clientWidth);
    const h = opties.hoogte ?? 220;
    const m = { l: 46, r: 14, t: 12, o: 30 };
    const bb = b - m.l - m.r;
    const bh = h - m.t - m.o;

    const stappen = asStappen(Math.max(...waarden, 1));
    const maxY = stappen[stappen.length - 1];
    const x = (i) => m.l + (waarden.length === 1 ? bb / 2 : (i / (waarden.length - 1)) * bb);
    const y = (v) => m.t + bh - (v / maxY) * bh;

    const punten = waarden.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const vlak = `M${x(0)},${m.t + bh} L${punten.split(' ').join(' L')} L${x(waarden.length - 1)},${m.t + bh} Z`;

    const bandVlak = band
      ? `<rect x="${x(band[0])}" y="${m.t}" width="${x(band[1]) - x(band[0])}" height="${bh}" fill="var(--serie-1)" opacity="0.05"></rect>`
      : '';

    el.innerHTML = `<svg viewBox="0 0 ${b} ${h}" width="${b}" height="${h}" role="img">
      ${stappen.map((s) => `<line class="raster" x1="${m.l}" x2="${b - m.r}" y1="${y(s)}" y2="${y(s)}"></line>
        <text x="${m.l - 8}" y="${y(s) + 4}" text-anchor="end">${getal.format(s)}</text>`).join('')}
      ${bandVlak}
      <path class="vlak" d="${vlak}"></path>
      <path class="lijn" d="M${punten.split(' ').join(' L')}"></path>
      <line class="as-lijn" x1="${m.l}" x2="${b - m.r}" y1="${m.t + bh}" y2="${m.t + bh}"></line>
      ${labels.map((l, i) => (l ? `<text x="${x(i)}" y="${h - 10}" text-anchor="middle">${ontsnap(l)}</text>` : '')).join('')}
      <g class="aanwijs" style="display:none">
        <line class="kruisdraad" y1="${m.t}" y2="${m.t + bh}"></line>
        <circle r="4.5" fill="var(--serie-1)" stroke="var(--surface)" stroke-width="2"></circle>
      </g>
      <rect class="trefvlak" x="${m.l}" y="${m.t}" width="${bb}" height="${bh}"></rect>
    </svg>`;

    const svg = el.firstElementChild;
    const groep = svg.querySelector('.aanwijs');
    const draad = groep.querySelector('line');
    const stip = groep.querySelector('circle');
    const tref = svg.querySelector('.trefvlak');

    tref.addEventListener('mousemove', (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * b;
      const i = Math.max(0, Math.min(waarden.length - 1, Math.round(((px - m.l) / bb) * (waarden.length - 1))));
      groep.style.display = '';
      draad.setAttribute('x1', x(i));
      draad.setAttribute('x2', x(i));
      stip.setAttribute('cx', x(i));
      stip.setAttribute('cy', y(waarden[i]));
      toonTip(evt, tip ? tip(i) : `<b>${ontsnap(labels[i])}</b>${getal1.format(waarden[i])}`);
    });

    tref.addEventListener('mouseleave', () => {
      groep.style.display = 'none';
      verbergTip();
    });
  });
}

/**
 * Staafgrafiek, met optioneel een tweede reeks als streepje boven de staaf.
 * @param {{punten:{label:string, waarde:number, tweede?:number, flauw?:boolean}[], tip?:Function}} opties
 */
function staafGrafiek(houder, opties) {
  tekenIn(houder, (el) => {
    const { punten, tip } = opties;
    const b = Math.max(320, el.clientWidth);
    const h = opties.hoogte ?? 220;
    const m = { l: 46, r: 14, t: 12, o: 30 };
    const bb = b - m.l - m.r;
    const bh = h - m.t - m.o;

    const max = Math.max(...punten.map((p) => Math.max(p.waarde, p.tweede ?? 0)), 1);
    const stappen = asStappen(max);
    const maxY = stappen[stappen.length - 1];
    const y = (v) => m.t + bh - (v / maxY) * bh;

    const vak = bb / punten.length;
    const breedte = Math.max(2, Math.min(46, vak - 2)); // 2 px lucht tussen staven
    const toonLabel = punten.length <= 40;
    const labelStap = punten.length > 20 ? Math.ceil(punten.length / 14) : 1;

    el.innerHTML = `<svg viewBox="0 0 ${b} ${h}" width="${b}" height="${h}" role="img">
      ${stappen.map((s) => `<line class="raster" x1="${m.l}" x2="${b - m.r}" y1="${y(s)}" y2="${y(s)}"></line>
        <text x="${m.l - 8}" y="${y(s) + 4}" text-anchor="end">${getal.format(s)}</text>`).join('')}
      ${punten.map((p, i) => {
        const x = m.l + i * vak + (vak - breedte) / 2;
        const hh = m.t + bh - y(p.waarde);
        const tweede = p.tweede === undefined ? '' :
          `<rect x="${x}" y="${y(p.tweede) - 1}" width="${breedte}" height="2.5" rx="1.25" class="mark-2" opacity="${p.flauw ? 0.32 : 1}"></rect>`;
        return `<path class="mark" d="${staafPad(x, y(p.waarde), breedte, hh)}" opacity="${p.flauw ? 0.32 : 1}"></path>${tweede}`;
      }).join('')}
      <line class="as-lijn" x1="${m.l}" x2="${b - m.r}" y1="${m.t + bh}" y2="${m.t + bh}"></line>
      ${toonLabel ? punten.map((p, i) => (i % labelStap ? '' :
        `<text x="${m.l + i * vak + vak / 2}" y="${h - 10}" text-anchor="middle">${ontsnap(p.label)}</text>`)).join('') : ''}
      ${punten.map((p, i) => `<rect class="trefvlak" data-i="${i}" x="${m.l + i * vak}" y="${m.t}" width="${vak}" height="${bh}"></rect>`).join('')}
    </svg>`;

    const svg = el.firstElementChild;
    svg.querySelectorAll('.trefvlak').forEach((r) => {
      r.addEventListener('mousemove', (evt) => {
        const i = +r.dataset.i;
        toonTip(evt, tip ? tip(i) : `<b>${ontsnap(punten[i].label)}</b>${getal1.format(punten[i].waarde)}`);
      });
      r.addEventListener('mouseleave', verbergTip);
    });
  });
}

/** Stap uit de sequentiële schaal; de stijl bepaalt de kleuren per thema. */
const SEQ_STAPPEN = 8;

function seqKleur(fractie) {
  if (!(fractie > 0)) return 'var(--raster)';
  const stap = Math.min(SEQ_STAPPEN, Math.max(1, Math.round(fractie * SEQ_STAPPEN)));
  return `var(--seq-${stap})`;
}

/** Warmtekaart weekdag tegen uur. */
function warmteKaart(houder, opties) {
  tekenIn(houder, (el) => {
    const { rijen, uren, waarden, max, tip } = opties;
    const b = Math.max(340, el.clientWidth);
    const m = { l: 34, r: 8, t: 18, o: 8 };
    const cel = (b - m.l - m.r) / uren.length;
    const celH = 26;
    const h = m.t + rijen.length * celH + m.o;

    el.innerHTML = `<svg viewBox="0 0 ${b} ${h}" width="${b}" height="${h}" role="img">
      ${uren.map((u, i) => (i % 2 ? '' : `<text x="${m.l + i * cel + cel / 2}" y="${m.t - 6}" text-anchor="middle">${u}</text>`)).join('')}
      ${rijen.map((r, ri) => `<text x="${m.l - 8}" y="${m.t + ri * celH + celH / 2 + 4}" text-anchor="end">${ontsnap(r)}</text>`).join('')}
      ${rijen.map((r, ri) => uren.map((u, ui) => {
        const v = waarden[ri][ui];
        return `<rect data-r="${ri}" data-u="${ui}" x="${m.l + ui * cel + 1}" y="${m.t + ri * celH + 1}" width="${Math.max(1, cel - 2)}" height="${celH - 2}" rx="3" fill="${seqKleur(v / max)}"></rect>`;
      }).join('')).join('')}
    </svg>`;

    el.firstElementChild.querySelectorAll('rect').forEach((r) => {
      r.addEventListener('mousemove', (evt) => toonTip(evt, tip(+r.dataset.r, +r.dataset.u)));
      r.addEventListener('mouseleave', verbergTip);
    });
  });
}

/* ── Staat bewaren bij een stille verversing ─────────────────────────────── */

/** Onthoudt ingevulde filters en scrollposities voor het scherm opnieuw opgebouwd wordt. */
function bewaarStaat(houder) {
  return {
    velden: [...houder.querySelectorAll('input[id], select[id]')].map((el) => [el.id, el.value]),
    tabellen: [...houder.querySelectorAll('.tabelhoes')].map((el) => el.scrollTop),
    pagina: window.scrollY,
  };
}

function herstelVelden(staat) {
  if (!staat) return;
  for (const [id, waarde] of staat.velden) {
    const el = document.getElementById(id);
    if (el) el.value = waarde;
  }
}

function herstelScroll(houder, staat) {
  if (!staat) return;
  houder.querySelectorAll('.tabelhoes').forEach((el, i) => { el.scrollTop = staat.tabellen[i] ?? 0; });
  window.scrollTo({ top: staat.pagina });
}

/* ── Tabbladen ───────────────────────────────────────────────────────────── */

const laders = {};
const geladen = new Set();

$$('nav button').forEach((knop) => {
  knop.addEventListener('click', () => {
    $$('nav button').forEach((k) => k.setAttribute('aria-selected', String(k === knop)));
    $$('main section').forEach((s) => { s.hidden = s.id !== `tab-${knop.dataset.tab}`; });

    const tab = knop.dataset.tab;
    if (!geladen.has(tab)) laders[tab]().catch(negeerAanmelding);
    else if (tab !== 'analyse') stilBijwerken(tab, laders[tab]);
  });
});

/* ── Tabblad: bezetting over tijd ────────────────────────────────────────── */

let analyseData = null;

async function laadAnalyse({ stil = false } = {}) {
  const houder = $('#analyse-inhoud');
  const staat = stil ? bewaarStaat(houder) : null;

  if (!stil) {
    houder.className = 'laden';
    houder.textContent = 'Bezig met rekenen...';
  }

  const [start, eind] = $('#f-uren').value.split('-').map(Number);
  const url = `/api/analyse?dagen=${$('#f-dagen').value}&startUur=${start}&eindUur=${eind}`;

  const res = await haal(url);
  const data = await res.json();

  if (!res.ok) {
    houder.className = '';
    houder.innerHTML = `<div class="melding">${ontsnap(data.fout)}</div>`;
    return;
  }

  analyseData = data;
  geladen.add('analyse');
  toonAnalyse(staat);
}

function toonAnalyse(staat = null) {
  const d = analyseData;
  const houder = $('#analyse-inhoud');
  houder.className = '';
  const k = d.kerncijfers;

  $('#kopmeta').textContent = `${d.aantalPlekken} werkplekken · historiek bijgewerkt ${tijdKort(d.opgehaald)}`;

  // Warmtekaart: gemiddelde bezetting per weekdag en uur.
  const uren = Array.from({ length: 15 }, (_, i) => i + 6); // 6 tot 20 uur
  const raster = DAGKORT.slice(0, 5).map(() => uren.map(() => 0));
  const tellers = DAGKORT.slice(0, 5).map(() => uren.map(() => 0));

  for (const dag of d.perDag) {
    if (!dag.werkdag || !dag.volledig) continue;
    uren.forEach((u, ui) => {
      const blokjes = dag.verloop.slice(u * 4, u * 4 + 4);
      raster[dag.weekdag][ui] += blokjes.reduce((a, b) => a + b, 0) / 4;
      tellers[dag.weekdag][ui]++;
    });
  }
  const warmte = raster.map((rij, ri) => rij.map((v, ui) => (tellers[ri][ui] ? v / tellers[ri][ui] : 0)));
  const warmteMax = Math.max(...warmte.flat(), 1);

  const groepSleutel = $('#f-groep').value;
  const groepen = d.groepen[groepSleutel];
  const groepTitel = { verdieping: 'verdieping', wijk: 'werkwijk', lokaal: 'lokaal' }[groepSleutel];

  houder.innerHTML = `
    <div class="tegels">
      <div class="tegel">
        <div class="titel">Gemiddeld bezet tijdens kantooruren</div>
        <div class="waarde">${pct(k.gemiddeldeBezettingsgraad)}</div>
        <div class="bij">${getal.format(k.gemiddeldeBezetting)} van ${d.aantalPlekken} plekken</div>
      </div>
      <div class="tegel">
        <div class="titel">Drukste moment</div>
        <div class="waarde">${pct(k.piekBezettingsgraad)}</div>
        <div class="bij">${getal.format(k.piekBezetting)} plekken tegelijk bezet</div>
      </div>
      <div class="tegel">
        <div class="titel">Nodig op 19 van 20 werkdagen</div>
        <div class="waarde">${getal.format(k.piekP95)}</div>
        <div class="bij">zoveel plekken volstaan, behalve op de drukste dagen</div>
      </div>
      <div class="tegel">
        <div class="titel">Nooit gebruikt in deze periode</div>
        <div class="waarde">${k.nooitGebruikt}</div>
        <div class="bij">${pct(k.nooitGebruikt / d.aantalPlekken)} van alle plekken</div>
      </div>
      <div class="tegel">
        <div class="titel">Periode</div>
        <div class="waarde">${d.venster.werkdagen}</div>
        <div class="bij">volledige werkdagen, ${d.venster.van.slice(0, 10)} tot ${d.venster.tot.slice(0, 10)}</div>
      </div>
    </div>

    <div class="kaarten">
      <div class="kaart breed">
        <h2>Verloop over de dag</h2>
        <p class="uitleg">Gemiddeld aantal bezette werkplekken per uur, over alle volledige werkdagen in de periode.</p>
        <div id="g-uur"></div>
      </div>

      <div class="kaart breed">
        <h2>Per dag</h2>
        <p class="uitleg">De staaf toont de gemiddelde bezetting tijdens kantooruren, het streepje erboven de piek van die dag. Weekends staan flauw.</p>
        <div class="legende">
          <span><i style="background:var(--serie-1)"></i>gemiddeld tijdens kantooruren</span>
          <span><i class="streep" style="background:var(--serie-2)"></i>piek van de dag</span>
        </div>
        <div id="g-dag"></div>
      </div>

      <div class="kaart">
        <h2>Per weekdag</h2>
        <p class="uitleg">Gemiddelde over de hele periode. Vrijdag is doorgaans het rustigst.</p>
        <div class="legende">
          <span><i style="background:var(--serie-1)"></i>gemiddeld</span>
          <span><i class="streep" style="background:var(--serie-2)"></i>piek</span>
        </div>
        <div id="g-weekdag"></div>
      </div>

      <div class="kaart">
        <h2>Wanneer is het druk</h2>
        <p class="uitleg">Gemiddeld aantal bezette plekken per weekdag en uur.</p>
        <div id="g-warmte"></div>
        <div class="schaal">
          <span>leeg</span>
          ${Array.from({ length: SEQ_STAPPEN }, (_, i) => `<i style="background:var(--seq-${i + 1})"></i>`).join('')}
          <span>${getal.format(warmteMax)} bezet</span>
        </div>
      </div>

      <div class="kaart breed">
        <h2>Bezetting per ${groepTitel}</h2>
        <p class="uitleg">Gemiddelde bezettingsgraad tijdens kantooruren, en de hoogste gelijktijdige bezetting.</p>
        <div class="tabelhoes">
          <table>
            <thead><tr>
              <th>${groepTitel[0].toUpperCase() + groepTitel.slice(1)}</th>
              <th class="getal">Plekken</th>
              <th class="balkcel">Gemiddelde bezetting</th>
              <th class="getal">Gemiddeld</th>
              <th class="getal">Piek</th>
              <th class="getal">Nooit gebruikt</th>
            </tr></thead>
            <tbody>${groepen.map((g) => `<tr>
              <td>${ontsnap(g.naam)}</td>
              <td class="getal">${g.aantalPlekken}</td>
              <td class="balkcel"><div class="balk"><i style="width:${Math.min(100, g.bezettingsgraad * 100)}%"></i></div></td>
              <td class="getal">${pct(g.bezettingsgraad)}</td>
              <td class="getal">${pct(g.piekgraad)}</td>
              <td class="getal">${g.nooitGebruikt || ''}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="kaart breed">
        <h2>Alle werkplekken</h2>
        <p class="uitleg">Standaard van minst naar meest gebruikt. Klik op een kolomtitel om anders te sorteren.</p>
        <div class="filters">
          <label>Zoeken
            <input type="search" id="zoek-wp" placeholder="lokaal, wijk of naam" style="min-width:220px">
          </label>
        </div>
        <div class="tabelhoes">
          <table id="tabel-wp">
            <thead><tr>
              <th class="sorteerbaar" data-veld="naam">Werkplek</th>
              <th class="sorteerbaar" data-veld="verdiepingNaam">Verdieping</th>
              <th class="sorteerbaar" data-veld="wijk">Wijk</th>
              <th class="sorteerbaar getal" data-veld="bezettingsgraad">Bezetting</th>
              <th class="sorteerbaar getal" data-veld="dagenGebruikt">Dagen gebruikt</th>
              <th class="sorteerbaar getal" data-veld="bezetteUren">Uren bezet</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;

  // Verloop over de dag
  lijnGrafiek($('#g-uur'), {
    labels: d.perUur.map((_, u) => (u % 2 === 0 ? `${String(u).padStart(2, '0')}u` : '')),
    waarden: d.perUur,
    band: [d.venster.startUur, d.venster.eindUur],
    tip: (i) => `<b>${String(i).padStart(2, '0')}:00 tot ${String(i + 1).padStart(2, '0')}:00</b>
      ${getal1.format(d.perUur[i])} bezette plekken<br>${pct(d.perUur[i] / d.aantalPlekken)} van alle werkplekken`,
  });

  // Per dag
  staafGrafiek($('#g-dag'), {
    punten: d.perDag.map((dag) => ({
      label: datumKort(dag.datum),
      waarde: dag.gemiddeld,
      tweede: dag.piek,
      flauw: !dag.werkdag || !dag.volledig,
    })),
    hoogte: 250,
    tip: (i) => {
      const dag = d.perDag[i];
      return `<b>${DAGNAMEN[dag.weekdag]} ${datumKort(dag.datum)}</b>
        gemiddeld ${getal1.format(dag.gemiddeld)} bezet (${pct(dag.bezettingsgraad)})<br>
        piek ${getal1.format(dag.piek)} (${pct(dag.piekgraad)})
        ${dag.volledig ? '' : '<br>deze dag loopt nog'}`;
    },
  });

  // Per weekdag
  staafGrafiek($('#g-weekdag'), {
    punten: d.perWeekdag.map((w, i) => ({
      label: DAGKORT[i],
      waarde: w.gemiddeld,
      tweede: w.piek,
      flauw: i > 4,
    })),
    tip: (i) => {
      const w = d.perWeekdag[i];
      return `<b>${DAGNAMEN[i]}</b>gemiddeld ${getal1.format(w.gemiddeld)} bezet (${pct(w.gemiddeld / d.aantalPlekken)})<br>
        piek gemiddeld ${getal1.format(w.piek)}<br>over ${w.dagen} dagen`;
    },
  });

  // Warmtekaart
  warmteKaart($('#g-warmte'), {
    rijen: DAGNAMEN.slice(0, 5).map((n) => n.slice(0, 2)),
    uren: uren.map((u) => String(u).padStart(2, '0')),
    waarden: warmte,
    max: warmteMax,
    tip: (r, u) => `<b>${DAGNAMEN[r]} ${String(uren[u]).padStart(2, '0')}:00</b>
      ${getal1.format(warmte[r][u])} bezette plekken<br>${pct(warmte[r][u] / d.aantalPlekken)} van alle werkplekken`,
  });

  herstelVelden(staat);
  vulWerkplekTabel();
  herstelScroll(houder, staat);

  $('#zoek-wp').addEventListener('input', vulWerkplekTabel);
  $$('#tabel-wp th.sorteerbaar').forEach((th) => th.addEventListener('click', () => {
    const veld = th.dataset.veld;
    sortering = { veld, op: sortering.veld === veld ? !sortering.op : true };
    vulWerkplekTabel();
  }));
}

let sortering = { veld: 'bezettingsgraad', op: true };

function vulWerkplekTabel() {
  const zoek = ($('#zoek-wp')?.value || '').toLowerCase().trim();
  const rijen = analyseData.perWerkplek
    .filter((w) => !zoek || `${w.naam} ${w.wijk} ${w.verdiepingNaam} ${w.lokaal ?? ''}`.toLowerCase().includes(zoek))
    .sort((a, b) => {
      const va = a[sortering.veld];
      const vb = b[sortering.veld];
      const r = typeof va === 'string' ? String(va).localeCompare(String(vb), 'nl') : (va ?? 0) - (vb ?? 0);
      return sortering.op ? r : -r;
    });

  $('#tabel-wp tbody').innerHTML = rijen.slice(0, 600).map((w) => `<tr>
      <td>${ontsnap(w.naam)}</td>
      <td>${ontsnap(w.verdiepingNaam)}</td>
      <td>${ontsnap(w.wijk)}</td>
      <td class="getal">${pct(w.bezettingsgraad)}</td>
      <td class="getal">${w.dagenGebruikt} / ${w.werkdagen}</td>
      <td class="getal">${getal1.format(w.bezetteUren)}</td>
    </tr>`).join('');
}

laders.analyse = laadAnalyse;
['#f-dagen', '#f-uren'].forEach((s) => $(s).addEventListener('change', () => laadAnalyse().catch(negeerAanmelding)));
$('#f-groep').addEventListener('change', () => analyseData && toonAnalyse());

/* ── Tabblad: nu ─────────────────────────────────────────────────────────── */

async function laadNu({ stil = false } = {}) {
  const houder = $('#nu-inhoud');
  const staat = stil ? bewaarStaat(houder) : null;

  if (!stil) {
    houder.className = 'laden';
    houder.textContent = 'Bezig met laden...';
  }

  const d = await (await haal('/api/nu')).json();
  geladen.add('nu');
  houder.className = '';

  const maxTotaal = Math.max(...d.perVerdieping.map((g) => g.totaal), 1);

  houder.innerHTML = `
    <div class="tegels">
      <div class="tegel">
        <div class="titel">Nu bezet</div>
        <div class="waarde">${d.bezet}</div>
        <div class="bij">${pct(d.graad)} van ${d.totaal} werkplekken</div>
      </div>
      <div class="tegel">
        <div class="titel">Nu vrij</div>
        <div class="waarde">${d.vrij}</div>
        <div class="bij">${pct(d.vrij / d.totaal)} van alle werkplekken</div>
      </div>
      <div class="tegel">
        <div class="titel">Geen toestand bekend</div>
        <div class="waarde">${d.onbekend}</div>
        <div class="bij">sensor heeft nog niets doorgestuurd</div>
      </div>
      <div class="tegel">
        <div class="titel">Stand van</div>
        <div class="waarde" style="font-size:22px">${tijdKort(d.opgehaald)}</div>
        <div class="bij">${geleden(d.opgehaald)} geleden opgehaald</div>
      </div>
    </div>

    <div class="kaarten">
      <div class="kaart breed">
        <h2>Per verdieping</h2>
        <p class="uitleg">Bezette en vrije plekken op dit moment.</p>
        <div class="legende">
          <span><i style="background:var(--serie-1)"></i>bezet</span>
          <span><i style="background:var(--raster);border:1px solid var(--as)"></i>vrij</span>
        </div>
        <div id="g-nu-verdieping"></div>
      </div>

      <div class="kaart breed">
        <h2>Per werkwijk</h2>
        <div class="tabelhoes">
          <table>
            <thead><tr>
              <th>Werkwijk</th><th class="getal">Plekken</th>
              <th class="balkcel">Bezettingsgraad</th><th class="getal">Bezet</th>
              <th class="getal">Aantal bezet</th><th class="getal">Aantal vrij</th>
            </tr></thead>
            <tbody>${d.perWijk.map((g) => `<tr>
              <td>${ontsnap(g.naam)}</td>
              <td class="getal">${g.totaal}</td>
              <td class="balkcel"><div class="balk"><i style="width:${g.graad * 100}%"></i></div></td>
              <td class="getal">${pct(g.graad)}</td>
              <td class="getal">${g.bezet}</td>
              <td class="getal">${g.vrij}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="kaart breed">
        <h2>Alle werkplekken</h2>
        <div class="filters">
          <label>Zoeken<input type="search" id="zoek-nu" placeholder="lokaal, wijk of naam" style="min-width:220px"></label>
          <label>Tonen
            <select id="f-nu-status">
              <option value="alle">alle plekken</option>
              <option value="vrij">enkel vrije plekken</option>
              <option value="bezet">enkel bezette plekken</option>
            </select>
          </label>
        </div>
        <div class="tabelhoes">
          <table><thead><tr>
            <th>Werkplek</th><th>Verdieping</th><th>Wijk</th><th>Toestand</th><th>Al</th>
          </tr></thead><tbody id="nu-rijen"></tbody></table>
        </div>
      </div>
    </div>`;

  // Gestapelde staven: bezet plus vrij, met 2 px lucht ertussen.
  tekenIn($('#g-nu-verdieping'), (el) => {
    const groepen = d.perVerdieping;
    const b = Math.max(320, el.clientWidth);
    const m = { l: 100, r: 50, t: 6, o: 6 };
    const rijH = 34;
    const h = m.t + groepen.length * rijH + m.o;
    const bb = b - m.l - m.r;
    const schaal = (v) => (v / maxTotaal) * bb;

    el.innerHTML = `<svg viewBox="0 0 ${b} ${h}" width="${b}" height="${h}" role="img">
      ${groepen.map((g, i) => {
        const y = m.t + i * rijH + 6;
        const hoog = rijH - 16;
        const bezet = schaal(g.bezet);
        const vrij = schaal(g.vrij);
        return `<text x="${m.l - 10}" y="${y + hoog / 2 + 4}" text-anchor="end" fill="var(--ink-2)">${ontsnap(g.naam)}</text>
          <rect data-i="${i}" x="${m.l}" y="${y}" width="${Math.max(0, bezet)}" height="${hoog}" rx="4" class="mark"></rect>
          <rect data-i="${i}" x="${m.l + bezet + 2}" y="${y}" width="${Math.max(0, vrij - 2)}" height="${hoog}" rx="4" fill="var(--raster)"></rect>
          <text x="${m.l + schaal(g.totaal) + 8}" y="${y + hoog / 2 + 4}" class="waardelabel">${pct(g.graad)}</text>`;
      }).join('')}
    </svg>`;

    el.firstElementChild.querySelectorAll('rect').forEach((r) => {
      r.addEventListener('mousemove', (evt) => {
        const g = groepen[+r.dataset.i];
        toonTip(evt, `<b>${ontsnap(g.naam)}</b>${g.bezet} bezet, ${g.vrij} vrij van ${g.totaal}<br>${pct(g.graad)} bezet`);
      });
      r.addEventListener('mouseleave', verbergTip);
    });
  });

  const vulNu = () => {
    const zoek = $('#zoek-nu').value.toLowerCase().trim();
    const status = $('#f-nu-status').value;
    const rijen = d.werkplekken
      .filter((w) => (status === 'alle') || (status === 'vrij' ? w.toestand === 'NOT_OCCUPIED' : w.toestand === 'OCCUPIED'))
      .filter((w) => !zoek || `${w.naam} ${w.wijk} ${w.verdiepingNaam}`.toLowerCase().includes(zoek))
      .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));

    $('#nu-rijen').innerHTML = rijen.slice(0, 600).map((w) => `<tr>
      <td>${ontsnap(w.naam)}</td>
      <td>${ontsnap(w.verdiepingNaam)}</td>
      <td>${ontsnap(w.wijk)}</td>
      <td><span class="stip ${w.toestand === 'OCCUPIED' ? 'bezet' : 'vrij'}"></span>${w.toestand === 'OCCUPIED' ? 'bezet' : w.toestand === 'NOT_OCCUPIED' ? 'vrij' : 'onbekend'}</td>
      <td>${geleden(w.toestandSinds)}</td>
    </tr>`).join('') || '<tr><td colspan="5">Geen werkplekken gevonden.</td></tr>';
  };

  $('#zoek-nu').addEventListener('input', vulNu);
  $('#f-nu-status').addEventListener('change', vulNu);

  herstelVelden(staat);
  vulNu();
  herstelScroll(houder, staat);
}

laders.nu = laadNu;

/* ── Tabblad: sensoren ───────────────────────────────────────────────────── */

async function laadSensoren({ stil = false } = {}) {
  const houder = $('#sensoren-inhoud');
  const staat = stil ? bewaarStaat(houder) : null;

  if (!stil) {
    houder.className = 'laden';
    houder.textContent = 'Bezig met laden...';
  }

  const d = await (await haal('/api/sensoren')).json();
  geladen.add('sensoren');
  houder.className = '';

  houder.innerHTML = `
    <div class="tegels">
      <div class="tegel">
        <div class="titel">Sensoren in orde</div>
        <div class="waarde">${d.inOrde}</div>
        <div class="bij">van ${d.totaal} sensoren</div>
      </div>
      <div class="tegel">
        <div class="titel">Aandacht nodig</div>
        <div class="waarde">${d.aandacht}</div>
        <div class="bij">zwak signaal, lage batterij of vastgelopen</div>
      </div>
      <div class="tegel">
        <div class="titel">Kritiek</div>
        <div class="waarde">${d.kritiek}</div>
        <div class="bij">meer dan 24 uur geen signaal</div>
      </div>
      <div class="tegel">
        <div class="titel">Cloud connectors</div>
        <div class="waarde">${d.cloudConnectors}</div>
        <div class="bij">verzamelen het signaal van de sensoren</div>
      </div>
    </div>

    <div class="kaart breed">
      <h2>Sensoren die aandacht vragen</h2>
      <p class="uitleg">Sensoren zonder probleem staan niet in de lijst. "Staat al dagen bezet" wijst meestal op een sensor die niet meer terugschakelt.</p>
      <div class="tabelhoes">
        <table><thead><tr>
          <th>Sensor</th><th>Soort</th><th>Verdieping</th><th>Toestand</th><th>Probleem</th>
          <th class="getal">Batterij</th><th class="getal">Signaal</th><th class="getal">Laatst gehoord</th>
        </tr></thead><tbody>
        ${d.sensoren.map((s) => `<tr>
          <td>${ontsnap(s.naam)}</td>
          <td>${s.type === 'deskOccupancy' ? 'werkplek' : s.type === 'motion' ? 'beweging' : ontsnap(s.type)}</td>
          <td>${ontsnap(s.verdiepingNaam)}</td>
          <td><span class="status ${s.ernst === 'critical' ? 'kritiek' : 'aandacht'}">${s.ernst === 'critical' ? 'kritiek' : 'aandacht'}</span></td>
          <td>${ontsnap(s.problemen.join(', '))}</td>
          <td class="getal">${s.batterij === null ? '' : s.batterij + '%'}</td>
          <td class="getal">${s.signaal === null ? '' : s.signaal}</td>
          <td class="getal">${s.urenStil === null ? 'nooit' : geleden(s.laatsteSignaal)}</td>
        </tr>`).join('') || '<tr><td colspan="8"><span class="status goed">alle sensoren in orde</span></td></tr>'}
        </tbody></table>
      </div>
    </div>`;

  herstelScroll(houder, staat);
}

laders.sensoren = laadSensoren;

/* ── Verversen ───────────────────────────────────────────────────────────── */

/* ── Automatisch bijwerken ───────────────────────────────────────────────── */

const NU_MS = 60 * 1000;
const SENSOREN_MS = 5 * 60 * 1000;
const HISTORIEK_CONTROLE_MS = 5 * 60 * 1000;

/** Alleen bijwerken wat de gebruiker op dit moment ook echt ziet. */
function zichtbaar(tab) {
  return document.visibilityState === 'visible' && !$(`#tab-${tab}`).hidden && geladen.has(tab);
}

/** Niet vernieuwen terwijl iemand in een zoekveld of keuzelijst bezig is. */
function bezigIn(tab) {
  const actief = document.activeElement;
  return Boolean(actief) && $(`#tab-${tab}`).contains(actief) && ['INPUT', 'SELECT'].includes(actief.tagName);
}

async function stilBijwerken(tab, lader) {
  if (!zichtbaar(tab) || bezigIn(tab)) return;
  try {
    await lader({ stil: true });
  } catch (err) {
    console.warn(`Bijwerken van ${tab} mislukt:`, err.message);
  }
}

setInterval(() => stilBijwerken('nu', laadNu), NU_MS);
setInterval(() => stilBijwerken('sensoren', laadSensoren), SENSOREN_MS);

// De server werkt de historiek elk uur bij. Zodra dat gebeurd is, herrekenen we
// de analyse, maar alleen als dat tabblad openstaat.
setInterval(async () => {
  if (!zichtbaar('analyse') || bezigIn('analyse') || !analyseData) return;
  try {
    const status = await (await haal('/api/status')).json();
    if (status.historiek && status.historiek.opgehaald !== analyseData.opgehaald) {
      await laadAnalyse({ stil: true });
    }
  } catch (err) {
    console.warn('Controle op nieuwe historiek mislukt:', err.message);
  }
}, HISTORIEK_CONTROLE_MS);

// Wie terugkomt naar het venster wil geen oud beeld zien.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  stilBijwerken('nu', laadNu);
  stilBijwerken('sensoren', laadSensoren);
});

/* ── Handmatig verversen ─────────────────────────────────────────────────── */

$('#ververs').addEventListener('click', async () => {
  const knop = $('#ververs');
  knop.disabled = true;
  knop.textContent = 'Bezig met ophalen...';
  try {
    await haal('/api/ververs?dagen=60', { method: 'POST' });
    geladen.clear();
    await laadAnalyse();
  } finally {
    knop.disabled = false;
    knop.textContent = 'Historiek verversen';
  }
});

/* ── Opstarten ───────────────────────────────────────────────────────────── */

/**
 * Online wordt de analyse niet live berekend maar periodiek klaargezet, dus
 * daar zijn alleen de vooraf berekende periodes en kantooruren beschikbaar.
 */
function pasModusToe(status) {
  $('#afmelden').hidden = !(status.authActief && status.aangemeld);

  if (status.modus !== 'online') return;

  $('#ververs').hidden = true;

  // Welke periodes klaarstaan weten we pas na de aanmelding.
  if (!status.periodes) return;

  const beschikbaar = new Set(status.periodes.map(String));
  [...$('#f-dagen').options].forEach((o) => { if (!beschikbaar.has(o.value)) o.remove(); });

  const uren = $('#f-uren');
  const vast = `${status.startUur}-${status.eindUur}`;
  [...uren.options].forEach((o) => { if (o.value !== vast) o.remove(); });
  uren.value = vast;
  uren.disabled = true;
  uren.title = 'Online staan de kantooruren vast, omdat de cijfers vooraf berekend worden.';
}

$('#aanmeldformulier').addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const knop = evt.target.querySelector('button');
  const fout = $('#aanmeldfout');
  knop.disabled = true;
  fout.hidden = true;

  try {
    const res = await fetch('/api/aanmelden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wachtwoord: $('#wachtwoord').value }),
    });
    if (!res.ok) {
      fout.textContent = 'Dat wachtwoord klopt niet.';
      fout.hidden = false;
      $('#wachtwoord').select();
      return;
    }
    $('#wachtwoord').value = '';
    $('#aanmelden').hidden = true;
    geladen.clear();
    await start();
  } catch {
    fout.textContent = 'De server antwoordde niet. Probeer opnieuw.';
    fout.hidden = false;
  } finally {
    knop.disabled = false;
  }
});

$('#afmelden').addEventListener('click', async () => {
  await fetch('/api/afmelden');
  geladen.clear();
  toonAanmelden();
});

async function start() {
  let status = { modus: 'lokaal', authActief: false, aangemeld: true };
  try {
    status = await (await fetch('/api/status')).json();
  } catch {
    // Geen antwoord: dan proberen we gewoon te laden en zien we de fout daar.
  }

  pasModusToe(status);

  if (status.authActief && !status.aangemeld) {
    toonAanmelden();
    return;
  }

  try {
    await laadAnalyse();
  } catch (err) {
    if (!err.aanmeldenNodig) throw err;
  }
}

start();
