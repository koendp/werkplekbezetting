# Briefing: overzicht van alle werkwijken

Plak dit in een nieuw gesprek met de map `C:\Users\L0003\Claude\Projects\disruptive`
als werkmap. Het bestaande W3.3-rapport is het model; dit wordt de versie voor
alle wijken samen.

## Wat er moet komen

Eén pagina met twee lagen:

1. **Bovenaan een vergelijking** van de veertien groepen naast elkaar: aantal
   plekken, gemiddelde bezetting, piek, verschillende plekken per dag, dagen
   waarop alle plekken van die groep gebruikt werden, en het verschil tussen
   zomer en de rest van het jaar.
2. **Daaronder een keuzelijst per groep**, die de grafieken toont die nu al voor
   W3.3 bestaan (per dag, per maand, per weekdag, stamtijden, inzoomen op een
   weekdag, per werkplek).

Af te leveren zoals W3.3: als Artifact én als los HTML-bestand met de logo's
erin, want dat laatste kan doorgestuurd worden zonder account.

## Beslissingen die al vastliggen

- **Veertien groepen, 459 werkplekken**: de dertien werkwijken (W1.4, W1.5,
  W1.6, W2.2, W2.3, W2.4, W2.5, W2.6, W3.2, W3.3, W3.4, W3.5, W3.6) plus **MOR**
  (26 plekken).
- **93 plekken vallen eruit**: 70 zonder wijkcode in hun naam, 11 MT, 6
  facilitaire balie, 6 stock. Niet meetellen, ook niet in een totaal.
- **Periode**: 1 oktober 2025 tot en met 30 september 2026, twaalf volledige
  maanden. Staat hard ingesteld in `src/w33-jaar.js` (`VAN` en `TOT`).
- **Kantooruren** 8 tot 17 uur, **stamtijden** 9 tot 12 en 14 tot 16 uur.
- **Zomer** is juli en augustus. Elk cijfer komt met en zonder die twee maanden.
- **Feestdagen en de kerstsluiting** (16 werkdagen) worden apart gehouden, niet
  stilletjes weggelaten. De lijst staat in `src/w33-jaar.js` onder `GESLOTEN`.

## Wat er al werkt

| Bestand | Doet |
|---|---|
| `src/w33-jaar.js [wijk]` | haalt een jaar op voor één wijk en rekent alles uit naar `data/<wijk>-jaar.json` |
| `src/bouw-rapport.js [wijk]` | giet die cijfers in het sjabloon, maakt ook de losse versie |
| `rapporten/sjabloon-wijk-jaar.html` | de pagina zelf, met alle grafieken |
| `src/aggregate.js` | de kern: wissels omrekenen naar bezetting per kwartier |
| `src/logo-omzetten.js` | maakt de twee logovarianten in `public/` |

Het ophaalscript neemt de wijk al als parameter, dus de datakant is vooral een
lus over de veertien groepen. Verwerk wijk per wijk en gooi de ruwe
gebeurtenissen daarna weg: alles samen is ongeveer 150 MB, de berekende cijfers
maar 1,5 MB.

Reken op **70 tot 90 seconden** ophalen voor alle 459 plekken.

## Technische feiten die anders veel uitzoekwerk kosten

- De API aanvaardt gewone **basic auth** met key id en secret. Sleutels staan in
  `.env` (niet in git). Geen OAuth of SDK nodig.
- De API **bewaart gebeurtenissen tot minstens maart 2025**, dus een jaar
  opvragen kan gewoon.
- Sensoren sturen **enkel toestandswissels**, geen periodieke metingen. Om de
  bezetting op een tijdstip te kennen moet je per werkplek een tijdlijn bouwen
  en de begintoestand seeden met een event van vóór het venster. Er wordt 21
  dagen aanloop opgehaald.
- Tussen meting en aflevering zit mediaan 5,7 minuten.
- **Verschillende plekken gebruikt** is iets anders dan de piek: het telt
  plekken die in de loop van de dag aan bod kwamen, niet gelijktijdig. Drempel:
  meer dan 7,5 minuten gebruik op die dag.

## Controleer de datakwaliteit per wijk

W3.3 was kraaknet, maar gebouwbreed is dat niet zo. Draai per groep dezelfde
controle en zet het resultaat op de pagina:

- **Weekendgemiddelde.** Bij W3.3 is dat 0,05 plek. Ligt het hoger, dan hangen er
  sensoren vast op bezet en lijkt die wijk drukker dan ze is.
- **Sensoren die zwijgen.** In augustus stonden er gebouwbreed 17 al maanden
  stil. Controleer of elke werkplek in elke maand gegevens stuurde.
- **Dagen zonder enige meting**, om gaten te onderscheiden van echt lege dagen.

Een wijk met zo'n probleem mag niet zonder waarschuwing in een vergelijking
staan.

## Huisstijl

Primaire kleuren: oranje `C86B02`, donkergrijs `565555`, plus tints daarvan.
Geen kleuren van buiten dat palet, ook niet in grafieken.

- Oranje haalt op wit maar 3,78:1, dus **alleen voor grote vette titels, vlakken
  en grafiekbalken**. Kaarttitels en bodytekst in donkergrijs (7,43:1). Voor
  witte tekst op een oranje vlak `985102` gebruiken.
- Een as die werkplekken telt mag **nooit verder lopen dan het aantal plekken**
  van die groep. Zie `stappenTot()` in het sjabloon.
- Meta Pro en Aptos staan niet op dit toestel; de fontstack valt terug op
  system-ui. Niet insluiten, beide zijn commercieel gelicentieerd.
- Het meegeleverde logo heeft geen transparantie. `src/logo-omzetten.js` maakt
  er een transparante en een witte negatiefversie van.

## Let op bij publiceren

Het W3.3-rapport staat op <https://claude.ai/artifact/AG6MfH56VFQgPGssMz2iej> en
is **buiten dit project ook bewerkt** (het stamtijdenblok kwam zo binnen). Lees
een artifact altijd eerst voor je eroverheen publiceert, en voeg wijzigingen
terug in het sjabloon, anders wist de volgende herbouw ze.

## Nog open

- De GitHub-repo `koendp/werkplekbezetting` is nog niet aangemaakt, dus er is
  niets gepusht en de Vercel-versie bestaat niet.
- De lokale historiek voor het dashboard is sinds 19 augustus niet bijgewerkt,
  omdat de server niet draaide.
- Dit rapport is een momentopname: de periode staat vast en de pagina bevraagt
  de API niet.
