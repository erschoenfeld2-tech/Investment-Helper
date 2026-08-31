# Architektur

Ergänzung zur README: warum die Dinge so gebaut sind, wie sie gebaut sind.

## Datenfluss einer Anfrage

```
Nutzer tippt "BMW"
   │
   ├─ Frontend: ist es eine bekannte Kryptowährung?      → nein
   │
   ├─ GET market?op=search&q=BMW
   │     Edge Function: kurslot_get('search','bmw')
   │       Treffer und jünger als 30 Tage?  → zurückgeben, 0 Abrufe
   │       sonst: Schlüssel da? → kurslot_spend() → Alpha Vantage → kurslot_put()
   │
   ├─ Nutzer wählt BMW.DEX aus der Vorschlagsliste
   │
   ├─ GET market?op=series&symbol=BMW.DEX
   │     wie oben, Frist 2 Tage; Antwort wird zu [{t,c}, …] normalisiert
   │
   ├─ Symbol enthält einen Punkt → keine US-Notierung
   │     ⇒ earnings und overview werden übersprungen (sie lieferten nur {})
   │
   └─ POST rest/v1/rpc/kurslot_notes  → redaktionelle Einordnung, kein Abruf
```

Alles Weitere — Schockphasen, Erholungsdauern, Volatilität, Jahresrenditen — rechnet das
Frontend aus der Kursreihe. Es gibt keinen zweiten Weg, auf dem Zahlen in die Seite
kommen.

## Zwei Anbieter für Kursreihen: Twelve Data zuerst, Alpha Vantage als Fallback

Alpha Vantages 25 Abrufe/Tag sind knapp bemessen, und `series` wird bei jeder
Symbolansicht mindestens einmal gebraucht — der größte Einzelposten im Budget.
Twelve Data bietet im Gratis-Tarif 800 Abrufe/Tag, deckt dort aber nur
US-Notierungen ohne Börsensuffix ab (kein XETRA, keine Krypto).

Für ein Symbol ohne Punkt im Kürzel (`AAPL`, nicht `BMW.DEX`) und ohne
Krypto-Kennzeichnung versucht die Funktion deshalb zuerst Twelve Data. Schlägt
das fehl — kein Schlüssel hinterlegt, Tagesbudget leer, Symbol dort unbekannt —
fällt sie automatisch und unbemerkt auf Alpha Vantage zurück. Jeder Anbieter
cacht unter einem eigenen `kind` (`series_td` bzw. `series`), damit sich die
beiden Rohantworten nicht überschreiben; die Normalisierung zu `[{t,c}, …]`
läuft danach über den zum jeweiligen Anbieter passenden Parser.

Earnings und Overview bleiben ausschließlich bei Alpha Vantage — Twelve Data
führt Analystenschätzungen und Firmenprofile erst ab einem bezahlten Tarif.
Börsensuffixe und Krypto sparen sich den Twelve-Data-Versuch von vornherein,
weil er dort ohnehin scheitern würde.

## Warum roh zwischenspeichern

`kurslot.cache` hält die unveränderte Antwort von Alpha Vantage, nicht das normalisierte
Ergebnis. Kostet etwas Speicher, kauft aber Bewegungsfreiheit: Stellt sich heraus, dass
der Parser ein Feld falsch liest, lässt sich das beheben, ohne für jedes betroffene
Symbol erneut einen der 25 Tagesabrufe auszugeben. Bei einem so knappen Kontingent ist
das die entscheidende Eigenschaft.

## Warum das Schema `kurslot` nicht über die REST-API erreichbar ist

Supabase gibt standardmäßig nur `public` über PostgREST frei. `kurslot` bleibt bewusst
außen vor: Cache, Tagesbudget und vor allem `app_secrets` sollen von außen nicht
adressierbar sein. Die Edge Function greift über schmale SECURITY-DEFINER-Funktionen in
`public` zu, deren Ausführungsrecht auf `service_role` beschränkt ist.

Einzige Ausnahme ist `kurslot_notes(text)` — lesend, auch für `anon`. Die Inhalte sind
redaktioneller Text ohne Schutzbedarf, und die Seite braucht sie ohne Umweg über die
Edge Function.

## Warum das Tagesbudget in der Datenbank zählt

Eine Edge Function kann in mehreren Instanzen gleichzeitig laufen; ein Zähler im
Arbeitsspeicher wäre wertlos. `kurslot_spend()` erhöht deshalb in einer einzigen
Anweisung und nur dann, wenn noch Budget übrig ist. Seit es zwei Anbieter gibt,
trägt `kurslot.api_usage` zusätzlich `provider` als Teil des Primärschlüssels
(`day, provider`) — Alpha Vantage und Twelve Data führen getrennte Konten,
sonst würde Twelve Datas großzügigeres Kontingent das knappe von Alpha Vantage
verdecken oder umgekehrt:

```sql
insert into kurslot.api_usage (day, provider, calls) values (heute, 'alphavantage', 1)
on conflict (day, provider) do update set calls = calls + 1 where calls < p_limit
returning calls;
```

Greift die `where`-Bedingung nicht, liefert `returning` nichts — `NULL` bedeutet also
„Budget erschöpft". Kein Zählerstand kann dabei verlorengehen.

Gegenstück ist `kurslot_refund()`: Scheitert ein Abruf, hat er keine Daten geliefert und
darf nicht zählen. Ohne diese Rückbuchung hätten die Fehlversuche an der Sekundenbremse
das Kontingent aufgezehrt, ohne dass eine einzige Zahl angekommen wäre.

## Warum Fehler nicht in einen Topf geworfen werden

Jeder Fehlercode der Edge Function hat im Frontend einen eigenen Text, weil jeder eine
andere Handlung nahelegt:

| Code | Was der Nutzer tun kann |
|---|---|
| `budget_exhausted` | bis morgen warten; bereits abgerufene Symbole gehen weiter |
| `rate_limited` | kurz warten, nochmal — kostet kein Budget |
| `no_key` | Schlüssel auf dem Server hinterlegen |
| `db` | nichts — Serverfehler, ausdrücklich nicht die Schuld der Eingabe |
| `api` / `notfound` | Börsenkürzel mit Suffix probieren |
| `thin` | anderes Symbol; für dieses reicht die Historie nicht |
| `offline` | Verbindung prüfen |

Ein einziger Sammelbanner würde genau die Information verbergen, die weiterhilft.

## Warum die Charts von Hand geschrieben sind

Eine Chart-Bibliothek hätte gut 100 KB gekostet und trotzdem an drei Stellen
Nacharbeit gebraucht: der hervorgehobene letzte Punkt, die schattierten Schockphasen im
Kursverlauf, und der Analogie-Chart, bei dem mehrere Zeitreihen auf einen gemeinsamen
Startpunkt normalisiert übereinanderliegen. Zwei Funktionen in `src/app.js` mit rund 200
Zeilen erledigen das direkt und ohne Abhängigkeit.

Die Größe des `viewBox` richtet sich nach der Breite des Containers, damit
Schriftgrößen im SVG bei jeder Fenstergröße ungefähr 1:1 gerendert werden. Bei einem
festen `viewBox` wären die Achsenbeschriftungen auf dem Telefon unlesbar klein geworden.

## Grenzen, die bewusst so stehen

* **Wochenschlusskurse, nicht Tageskurse.** Für Schockphasen über Jahre ist das die
  richtige Auflösung, und es spart Datenmenge. Ein Tageschart wäre ein eigener Abruf.
* **Die Suche zeigt Alpha Vantages Reihenfolge.** Bei „BMW" steht deshalb `BMW.FRK`
  (Frankfurt) vor `BMW.DEX` (XETRA), obwohl XETRA der übliche Handelsplatz ist.
* **Schwelle 18 %.** Tiefer angesetzt würde jedes Marktrauschen zur „Phase"; höher
  blieben normale Rücksetzer unsichtbar. Der Wert steht in `src/app.js` als `THRESHOLD`.
* **Kryptowährungen** werden gegen eine feste Liste erkannt und in EUR geladen. Wer eine
  seltene Münze braucht, muss die Liste in `src/app2.js` ergänzen.
