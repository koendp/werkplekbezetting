# Bezetting werkplekken

Dashboard op basis van de Disruptive Technologies-sensoren. Het toont hoe de
552 werkplekken gebruikt worden: over tijd, op dit moment, en of de sensoren
zelf nog naar behoren werken.

Alles draait lokaal. De sleutels blijven in `.env` op deze pc en gaan nergens
anders heen.

## Starten

Dubbelklik op `start.bat`, of:

```bash
node server.js
```

Het dashboard staat dan op http://localhost:5180

## Hoe actueel zijn de cijfers

| Onderdeel | Bron | Hoe vers |
|---|---|---|
| Tabblad Nu | rechtstreeks bij de API | werkt zichzelf elke minuut bij |
| Tabblad Sensoren | rechtstreeks bij de API | werkt zichzelf elke 5 minuten bij |
| Tabblad Bezetting over tijd | lokale kopie van de historiek | de server haalt elk kwartier het nieuwe stuk op |

Het bijwerken gebeurt alleen voor het tabblad dat je op dat moment ziet, en niet
terwijl je in een zoekveld of keuzelijst bezig bent. Kom je terug naar het
venster, dan wordt meteen bijgewerkt. Je zoekterm, filter en scrollpositie
blijven daarbij staan.

Eén beperking zit in de sensoren zelf: tussen het moment dat een sensor een
wissel vaststelt en het moment dat die bij de API binnenkomt zit mediaan 5,7
minuten, gemeten over 155.750 gebeurtenissen. De sensor wacht bewust even zodat
hij niet flikkert bij iemand die kort rechtstaat. Realtime tot op de seconde
bestaat hier dus niet.

## Historiek zelf ophalen

De cijfers over tijd komen uit een lokale kopie van de sensorgeschiedenis. Naast
de verversing per kwartier kan je die kopie ook met de knop **Historiek
verversen** in het dashboard bijwerken, of vanaf de opdrachtregel:

```bash
node src/refresh.js 60
```

De eerste keer duurt dat ongeveer 75 seconden: de API kent geen oproep die de
geschiedenis van alle sensoren tegelijk teruggeeft, dus er gaat één oproep per
werkplek uit.

Een verversing daarna duurt minder dan een seconde. De toestellenlijst, die in
één oproep binnenkomt, bevat per sensor het tijdstip van de laatste wissel.
Werkplekken waar sindsdien niets veranderd is, worden overgeslagen. Bij een
verversing per kwartier zijn dat er doorgaans meer dan vijfhonderd van de
vijfhonderdtweeënvijftig.

Met `--alles` haal je de volledige periode opnieuw op. Dat is zelden nodig;
`src/test-vergelijk.js` toont hoe je de incrementele uitkomst tegen een volledige
ophaling kan controleren (kopieer daarvoor eerst `data/historiek.json` naar
`data/historiek-incrementeel.json`, en haal dan alles opnieuw op).

Draait de server niet, dan wordt er niets bijgewerkt. De historiek loopt dan
gewoon achter tot de volgende keer dat je hem start.

## Wat de cijfers betekenen

- **Gemiddeld bezet**: het gemiddelde aantal bezette plekken tijdens de gekozen
  kantooruren, over alle volledige werkdagen in de periode.
- **Drukste moment**: de hoogste gelijktijdige bezetting die in de periode
  gemeten is.
- **Nodig op 19 van 20 werkdagen**: het 95e percentiel van de dagpieken. Dit is
  het cijfer om op te sturen bij beslissingen over desksharing: zoveel plekken
  volstonden op alle dagen behalve de allerdrukste.
- **Nooit gebruikt**: plekken die in de hele periode geen enkele keer bezet zijn
  geweest.

De sensoren sturen enkel toestandswissels door. Het dashboard bouwt daaruit per
werkplek een tijdlijn en verdeelt die over blokjes van 15 minuten. Een blokje
krijgt de fractie van de tijd dat de plek bezet was, zodat de som over alle
plekken het verwachte aantal bezette plekken geeft. Alle tijden staan in de
tijdzone Brussel.

## Aandachtspunten in de brondata

- **111 sensoren hebben geen werkwijkcode** in hun naam. Die vallen onder "Niet
  toegewezen". Een naam als `224.B01` of `108.B02` mist het `-W2.4`-deel.
- **Een handvol sensoren heet `onbekend 1` tot `onbekend 5`, `vrij` of `Test01`.**
  Die tellen nu mee in de noemer en drukken de bezettingsgraad licht. Zodra ze in
  Disruptive Studio een nette naam krijgen, komen ze vanzelf in de juiste groep.
- **Ruimtes zoals Stock, MT en de facilitaire balie** zijn geen gewone
  werkplekken, maar staan wel tussen de deskOccupancy-sensoren. Ze zijn
  herkenbaar aan hun wijknaam.
- **Sensoren die blijven hangen op bezet** zorgen voor een basislijn van ongeveer
  2 tot 3 "bezette" plekken in het weekend. Het tabblad Sensoren zet ze op een
  rij onder "staat al dagen bezet".

## Online versie

Naast de lokale server draait het dashboard ook op Vercel. Dat werkt anders,
omdat een functie daar niet lang mag draaien en niets naar schijf kan schrijven.

| Onderdeel | Lokaal | Online |
|---|---|---|
| Nu en Sensoren | via de lokale kopie van de toestellenlijst | rechtstreeks bij de API, per oproep |
| Bezetting over tijd | live berekend uit de volledige historiek | vooraf berekende momentopname |
| Periodes | 7, 30 en 60 dagen | dezelfde drie |
| Kantooruren | vrij instelbaar | vast op 8 tot 17 uur |
| Historiek verversen | knop in het dashboard, elk kwartier automatisch | geplande taak op GitHub, elke drie uur |

De analyse kan online niet live berekend worden: ze heeft 552 API-oproepen en
ruim 25 MB historiek nodig. Daarom rekent de taak in
`.github/workflows/momentopname.yml` de uitkomst periodiek uit en zet ze in
`data/momentopname.js` (ongeveer 560 kB). Vercel publiceert daarna vanzelf
opnieuw. De ruwe historiek blijft buiten de repository en wordt bewaard in de
cache van GitHub Actions, zodat elke beurt enkel het nieuwe stuk hoeft op te
halen.

### Afscherming

De online versie vraagt één gedeeld wachtwoord. Na een geslaagde aanmelding
krijgt de browser een koekje met een vervaltijd en een handtekening; het
wachtwoord zelf gaat niet mee terug. Alle gegevens lopen via `/api/`, en die
eindpunten geven zonder geldig koekje een 401 terug. De statische pagina zelf is
wel gewoon bereikbaar, maar bevat geen cijfers.

**Wat dit niet is:** dit zijn geen persoonlijke accounts, er is geen logging van
wie wat bekijkt, en een gedeeld wachtwoord lekt in de praktijk. Voor een
dashboard met aanwezigheidsgegevens over herkenbare collega's is dat op termijn
te mager. Overleg met IT of de functionaris gegevensbescherming voor je de link
breder verspreidt.

### Instellen

Op Vercel, bij Settings en dan Environment Variables:

| Variabele | Waarde |
|---|---|
| `DT_KEY_ID` | uit Disruptive Studio |
| `DT_SECRET` | uit Disruptive Studio |
| `DT_PROJECT_ID` | uit Disruptive Studio |
| `AUTH_WACHTWOORD` | het gedeelde wachtwoord dat je zelf kiest |
| `SESSIE_GEHEIM` | optioneel, een lange willekeurige tekst om koekjes mee te tekenen |

Zonder `AUTH_WACHTWOORD` staat de afscherming uit en is alles publiek. Zonder
`SESSIE_GEHEIM` wordt de handtekeningsleutel van het wachtwoord afgeleid, wat
ook werkt; verander je het wachtwoord, dan vervallen alle lopende sessies.

Op GitHub, bij Settings, Secrets and variables, Actions, dezelfde vier
`DT_`-waarden als repository secrets. Die heeft de geplande taak nodig.

## Huisstijl

Het dashboard volgt de primaire huisstijl van Provincie Oost-Vlaanderen: oranje
`C86B02` en donkergrijs `565555`, met tints van diezelfde twee kleuren. Er komt
geen kleur van buiten het palet bij, ook niet in de grafieken.

Elke kleurcombinatie is nagerekend in plaats van geschat:

| Toepassing | Kleur | Contrast |
|---|---|---|
| Hoofdtitel op wit | `C86B02` | 3,78:1, voldoet als grote vetgedrukte tekst |
| Bodytekst op wit | `565555` | 7,43:1 |
| Grafiekbalken op wit | `C86B02` | 3,78:1, ruim boven de 3:1 voor vlakken |
| Grafiekbalken op donker | `C86B02` | 4,61:1 |

Omdat oranje op deze korpsgrootte de tekstnorm niet haalt, staan kaarttitels in
donkergrijs. Oranje is voorbehouden aan de hoofdtitel, aan vlakken en aan de
grafieken. Dat sluit ook aan bij de regel uit het handboek om karig te zijn met
kleur in tekst.

De warmtekaart gebruikt een verloopschaal die volledig uit tints en shades van
het huisstijloranje bestaat. Op een donker vlak loopt die schaal omgekeerd, want
daar betekent lichter juist drukker.

Statuskleuren in het tabblad Sensoren komen uit het provinciepalet: groen
`375D28`, oranje `C86B02` en rood `AA2126`. Ze staan er nooit alleen: elke status
draagt ook een icoon en het woord zelf, zoals het handboek vraagt.

Het logo staat verticaal rechtsonder in de voettekst, met ruim meer witruimte
dan het voorgeschreven minimum. Het meegeleverde bestand heeft een witte
achtergrond zonder transparantie, wat op een donker vlak een wit blok geeft.
`src/logo-omzetten.js` maakt daar twee bruikbare varianten van: één met de
originele kleuren en één volledig witte, de officiële negatiefversie voor donkere
achtergronden. Beide staan in `public/`.

**Wat niet lukt:** de huisstijlfonts Meta Pro en Aptos staan niet op dit toestel,
dus de pagina valt terug op het systeemlettertype. De fontstack staat wel goed
ingesteld, dus zodra een van beide geïnstalleerd is, klopt de typografie
vanzelf. Ze meeleveren als webfont kan niet, want beide zijn commercieel
gelicentieerd.

## Opbouw

| Bestand | Rol |
|---|---|
| `server.js` | lokale webserver en API-eindpunten |
| `src/dt.js` | verbinding met de Disruptive-API (basic auth, paginering, herkansing) |
| `src/parse.js` | ontleedt sensornamen naar lokaal, verdieping en werkwijk |
| `src/aggregate.js` | rekent toestandswissels om naar bezettingscijfers |
| `src/cache.js` | haalt data op en bewaart ze in `data/` |
| `src/refresh.js` | verversen vanaf de opdrachtregel |
| `src/test-berekening.js` | snelle controle van de berekening in de terminal |
| `src/test-vergelijk.js` | controle of de incrementele verversing niets verliest |
| `src/logo-omzetten.js` | maakt de transparante en witte logovarianten aan |
| `public/` | het dashboard zelf |

`data/` en `.env` staan in `.gitignore` en horen niet in een repository.

## API-toegang

De service account staat in [Disruptive Studio](https://studio.disruptive-technologies.com/projects/ckftivh3o7qfgaaaf29g/serviceaccounts/d3eeod324te000b24vj0).
De sleutels staan in `.env`. Wordt de sleutel ooit vervangen, dan volstaat het om
`DT_KEY_ID` en `DT_SECRET` daar bij te werken.
