# Kurslot

Eine Aktie, einen ETF oder eine Kryptowährung eingeben und eine faktenbasierte
Einordnung bekommen — echter Kursverlauf, Guidance gegen tatsächliche Zahlen,
wiederkehrende Schwankungstreiber und wie lange frühere Erholungen gedauert haben.

**Keine Anlageberatung.** Kurslot gibt keine Empfehlung ab und prognostiziert keinen
Kurs. Es zeigt Vergangenes und daraus Gemessenes, damit man selbst entscheiden kann.

---

## Die vier Bausteine

| # | Baustein | Woher die Zahlen kommen |
|---|----------|-------------------------|
| 1 | **Kursverlauf** — Wochenschlusskurse, Zeitraum 6M/1J/2J/5J/Max, Schockphasen als Bänder | Alpha Vantage, `TIME_SERIES_WEEKLY_ADJUSTED` |
| 2 | **Ziel gegen Ist** — Analystenerwartung gegen berichteten Gewinn je Aktie, Ampel | Alpha Vantage, `EARNINGS` (nur US-Notierungen) |
| 3 | **Schwankungstreiber** — wiederkehrende Risiken mit Wiederholungswahrscheinlichkeit, dazu Schwankungsbreite je Jahr | Tabelle `kurslot.notes` (redaktionell) + aus der Kursreihe gerechnet |
| 4 | **Schock und Erholung** — alle Rückgänge ≥ 18 % vom Hoch, ab ihrem jeweiligen Hoch übereinandergelegt | vollständig aus der Kursreihe gerechnet |

Baustein 4 ist die Antwort auf die Frage „wie könnte es weitergehen": **keine erfundene
Zukunftslinie**, sondern die tatsächlich gelaufenen Verläufe früherer Schocks, gegen die
laufende Phase gelegt. Eine Analogie, ausdrücklich keine Prognose.

---

## Architektur

```
Browser (index.html — eine Datei, kein Framework, kein Build zur Laufzeit)
   │
   └─ fetch → Supabase Edge Function "market"      ← hier liegen die API-Schlüssel
                 ├─ Cache in Postgres (Schema kurslot)
                 ├─ Twelve Data (Kursreihen, nur US-Symbole ohne Börsensuffix)
                 └─ Alpha Vantage (alles andere + Fallback, wenn Twelve Data nicht greift)
```

Warum der Umweg über eine eigene Funktion:

1. **Die API-Schlüssel bleiben auf dem Server.** Im Browser steht nur der
   öffentliche Supabase-Schlüssel, der genau dafür gedacht ist.
2. **Alpha Vantages Gratis-Tarif erlaubt nur 25 Abrufe pro Tag.** Jede Antwort wird
   roh zwischengespeichert; ein zweiter Blick auf dasselbe Symbol kostet nichts. Für
   US-Symbole ohne Börsensuffix übernimmt zusätzlich Twelve Data (800 Abrufe/Tag) den
   größten Posten — die Kursreihe —, wodurch Alpha Vantage vor allem für Earnings,
   Overview und internationale Titel übrigbleibt.
3. **Zwischengespeichert wird roh, normalisiert wird beim Ausliefern.** So lässt sich ein
   Fehler im Parser beheben, ohne erneut Abrufe zu verbrauchen.

### Gemessene Grenzen der Datenquellen

| Anbieter | Abrufe/Tag | Deckt ab | Umgang im Code |
|---|---|---|---|
| Twelve Data | 800 | Kursreihen, nur US-Symbole ohne Börsensuffix, keine Krypto | Wird zuerst versucht; Fehlschlag fällt automatisch auf Alpha Vantage zurück |
| Alpha Vantage | 25 | Alles andere: Kursreihen mit Börsensuffix, Krypto, Earnings, Overview, Suche | Zähler in `kurslot.api_usage` je Anbieter, Restbudget steht im Fuß der Seite |

Beide Zähler laufen getrennt (`kurslot.api_usage`, Spalte `provider`) und werden bei
Fehlversuchen zurückgebucht (`kurslot_refund`), damit Bremsungen oder unbekannte Symbole
kein Budget kosten. Fundamentaldaten (`EARNINGS`/`OVERVIEW`) liefern bei Alpha Vantage für
`BMW.DEX` ein leeres `{}` — das Frontend fragt sie für Symbole mit Börsensuffix gar nicht
erst ab.

Folge für deutsche Papiere: Baustein 2 entfällt, stattdessen stehen dort die
Jahresrenditen. Wer Erwartung gegen Ist sehen will, sucht dieselbe Firma unter ihrer
US-Notierung — BMW etwa als `BMWYY`. Ein deutsches Symbol kostet dadurch **einen** Alpha-
Vantage-Abruf statt drei, ein US-Symbol in der Regel **keinen einzigen** (Kursreihe über
Twelve Data).

### Cache-Fristen

Kursreihen 2 Tage · Krypto 1 Tag · Earnings und Overview 20 Tage · Symbolsuche 30 Tage.

Ist das Tagesbudget leer, liefert die Funktion die alten Daten **mit Kennzeichnung**
statt eines Fehlers — veraltete Zahlen mit Datum sind brauchbarer als keine.

---

## Aufbau des Repositorys

```
index.html                     das Ergebnis des Builds — direkt lauffähig
src/
  shell.html                   Markup und CSS (Design-Tokens, hell und dunkel)
  app.js                       Episoden-Erkennung, Volatilität, SVG-Charts
  app2.js                      API-Schicht und Rendering
build.py                       src/ → index.html
minify.js                      src/ → dist/index.min.html (kleiner, gleiche Funktion)
supabase/
  migrations/*.sql             Schema, Cache, Budget, Notizen
  functions/market/index.ts    Marktdaten-Proxy mit Cache und Drosselung
  functions/web/index.ts       Platzhalter für die spätere Auslieferung der Seite
test/
  stub.js                      Testdouble: fängt fetch ab, antwortet wie die Edge Function
  shot.js                      rendert acht Zustände, prüft auf JS-Fehler und Überlauf
docs/ARCHITEKTUR.md            Datenfluss, Datenmodell, Entwurfsentscheidungen
```

---

## Einrichten

Voraussetzungen: Python 3, Node 18+, ein Supabase-Projekt, ein Alpha-Vantage-Schlüssel
(kostenlos unter <https://www.alphavantage.co/support/#api-key>) und optional ein
Twelve-Data-Schlüssel (kostenlos unter <https://twelvedata.com/pricing>, Basic-Plan) —
ohne ihn läuft alles weiter, nur eben komplett über Alpha Vantages engeres Kontingent.

```bash
# 1  Datenbank aufsetzen
supabase link --project-ref <PROJECT_REF>
supabase db push

# 2  Schlüssel hinterlegen (nur über service_role lesbar)
#    im SQL-Editor von Supabase:
#    insert into kurslot.app_secrets (name, value) values
#      ('alphavantage_key', 'DEIN_ALPHA_VANTAGE_SCHLUESSEL'),
#      ('twelvedata_key', 'DEIN_TWELVE_DATA_SCHLUESSEL')
#    on conflict (name) do update set value = excluded.value, updated_at = now();

# 3  Edge Functions deployen
supabase functions deploy market

# 4  Frontend auf das eigene Projekt zeigen lassen
#    in src/app2.js oben: API und API_KEY anpassen
#    (API_KEY ist der publishable key — der gehört ins Frontend)

# 5  Bauen und prüfen
python build.py
npm install && node test/shot.js     # legt Screenshots in test/ ab
```

`index.html` lässt sich danach direkt im Browser öffnen oder von einem beliebigen
Static Host ausliefern.

### Was **nicht** ins Repository gehört

Die Alpha-Vantage- und Twelve-Data-Schlüssel. Sie liegen ausschließlich in
`kurslot.app_secrets` und werden von der Edge Function über `kurslot_secret()` gelesen.
Der Supabase-Schlüssel in
`src/app2.js` ist der *publishable key* — der ist zur Veröffentlichung bestimmt und
gibt allein keinen Zugriff auf Daten.

---

## Einordnung eines Symbols pflegen

Baustein 3 liest aus `kurslot.notes`. Ist für ein Symbol nichts hinterlegt, zeigt die
Seite das offen an und stützt sich auf die gemessenen Werte.

```sql
select public.kurslot_notes_put(
  'BMW.DEX',
  '[{"name":"China-Geschäft",
     "note":"Ein großer Teil von Absatz und Gewinn hängt am chinesischen Markt.",
     "last":"2026","risk":"hoch"}]'::jsonb,
  '[{"peakDate":"2020-01-10","event":"Corona-Crash",
     "why":"Der Lockdown setzte den Tiefpunkt."}]'::jsonb
);
```

`risk` ist `hoch`, `mittel` oder `niedrig` und steuert die Farbe des Streifens.
`peakDate` muss auf das Datum passen, das die Episoden-Erkennung ermittelt hat.

---

## Wie die Schockphasen erkannt werden

Rein mechanisch, ohne Interpretation (`src/app.js`, `detectEpisodes`):

1. Laufendes Hoch mitführen.
2. Fällt der Kurs **18 % oder mehr** darunter, beginnt eine Phase.
3. Tiefster Punkt bis zur Rückkehr auf das alte Hoch ist das Tief.
4. Erreicht der Kurs das alte Hoch wieder, ist die Phase abgeschlossen — sonst läuft sie.

Je Phase werden Rückgang, Zeit bis zum Tief und Zeit bis zurück am Hoch berechnet.
Der Analogie-Chart legt alle Phasen auf ihren Startpunkt (Woche 0 = Hoch, y = Prozent
vom Hoch) und zeichnet die laufende hervorgehoben darüber.

---

## Gestaltung

Kobaltblauer Akzent (`#2f55c4` hell, `#6e88e4` dunkel) auf olivgrauen Neutraltönen.
Bricolage Grotesque für Überschriften, Instrument Sans für Fließtext, IBM Plex Mono für
alle Zahlen (Tabellenziffern, damit Spalten fluchten). Hell und Dunkel laufen vollständig
über CSS-Variablen und folgen dem System, mit Umschalter.

Die Charts sind handgeschriebenes SVG ohne Bibliothek — nötig, weil Gitternetz,
hervorgehobener Endpunkt und Crosshair genau sitzen sollten. Die Ampelfarben sind gegen
Farbfehlsichtigkeit geprüft und werden nie allein durch Farbe kodiert: immer Punkt,
Wortlabel und Zahl.
