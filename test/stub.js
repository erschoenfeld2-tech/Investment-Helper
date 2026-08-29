// Testdouble: fängt fetch ab und antwortet im Format der Edge Function.
(function () {
  function weekly(startYear, n, seed) {
    let p = 40, r = seed;
    const out = [];
    const d = new Date(startYear, 0, 5);
    const shocks = [[90, -0.055, 14], [230, -0.075, 10], [430, -0.06, 18], [660, -0.05, 12], [735, -0.07, 9]];
    for (let i = 0; i < n; i++) {
      r = (r * 1103515245 + 12345) % 2147483648;
      let drift = 0.0052 + ((r / 2147483648) - 0.5) * 0.045;
      for (const [at, mag, dec] of shocks) if (i >= at && i < at + 40) drift += mag * Math.exp(-(i - at) / dec);
      p = Math.max(4, p * (1 + drift));
      out.push({ t: d.toISOString().slice(0, 10), c: +p.toFixed(2) });
      d.setDate(d.getDate() + 7);
    }
    return out;
  }

  const budget = { used: 6, limit: 25 };
  const DB = {
    search: [
      { symbol: "BMW.DEX", name: "Bayerische Motoren Werke AG", type: "Aktie", region: "XETRA", currency: "EUR" },
      { symbol: "BMWYY", name: "Bayerische Motoren Werke AG ADR", type: "Aktie", region: "United States", currency: "USD" },
    ],
    series: weekly(2011, 760, 7),
    earnings: [
      { date: "2026-06-30", reportedOn: "2026-08-06", reported: 0.94, estimated: 1.61, surprise: -41.6 },
      { date: "2026-03-31", reportedOn: "2026-05-07", reported: 2.02, estimated: 2.14, surprise: -5.6 },
      { date: "2025-12-31", reportedOn: "2026-03-14", reported: 2.51, estimated: 2.33, surprise: 7.7 },
      { date: "2025-09-30", reportedOn: "2025-11-06", reported: 1.88, estimated: 1.90, surprise: -1.1 },
      { date: "2025-06-30", reportedOn: "2025-08-01", reported: 2.71, estimated: 2.44, surprise: 11.1 },
      { date: "2025-03-31", reportedOn: "2025-05-08", reported: 2.30, estimated: 2.35, surprise: -2.1 },
    ],
    overview: { symbol: "BMW.DEX", name: "Bayerische Motoren Werke AG", sector: "Consumer Cyclical", currency: "EUR" },
    notes: [{
      drivers: [
        { name: "China-Absatz", note: "Ein großer Teil des Konzernabsatzes hängt am chinesischen Markt.", last: "Jun 2026", risk: "hoch" },
        { name: "Zölle", note: "Handelsbarrieren zwischen EU, USA und China treffen Export und Marge.", last: "Mrz 2026", risk: "mittel" },
        { name: "Zinsniveau", note: "Höhere Zinsen verteuern Finanzierungsangebote und dämpfen die Nachfrage.", last: "Okt 2025", risk: "mittel" },
        { name: "Lieferketten", note: "Engpässe bei Halbleitern und Bremssystemen bremsen die Auslieferung.", last: "Feb 2026", risk: "niedrig" },
      ],
      episodes: [],
    }],
  };

  const mode = new URLSearchParams(location.search).get("mode") || "ok";
  const reply = (obj, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));

  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String(input?.url || input);
    if (!/supabase\.co/.test(url)) return real(input, init);
    if (mode === "offline") return Promise.reject(new TypeError("Failed to fetch"));

    if (/rpc\/kurslot_notes/.test(url)) return reply(mode === "nonotes" ? [] : DB.notes);

    const op = new URL(url).searchParams.get("op");
    if (op === "budget") return reply(budget);
    if (mode === "budget") return reply({ error: { code: "budget_exhausted", message: "aufgebraucht" }, budget: { used: 25, limit: 25 } }, 429);
    if (mode === "nokey") return reply({ error: { code: "no_key", message: "kein Schlüssel" }, budget }, 503);

    const envelope = (data) => reply({ data, fetchedAt: new Date().toISOString(), stale: mode === "stale", budget });
    if (op === "search") return envelope(DB.search);
    if (op === "series") return envelope(DB.series);
    if (op === "earnings") return envelope(DB.earnings);
    if (op === "overview") return envelope(DB.overview);
    return reply({ error: { code: "bad_request", message: "unbekannt" } }, 400);
  };
})();
