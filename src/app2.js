/* ==========================================================================
   Datenschicht — spricht mit der eigenen Edge Function, nicht mit Alpha
   Vantage. Der API-Schlüssel liegt dort auf dem Server; hier steht nur der
   öffentliche Supabase-Schlüssel, der genau dafür gedacht ist.
   ========================================================================== */

const API = "https://lkxfxsadfxrxpsxnsqnb.supabase.co/functions/v1/market";
const API_KEY = "sb_publishable_jy_QnFrhB3RNZIItB4_8SQ_4SE9ahtz";

const state = {
  range: "2J", sym: null, series: null, episodes: [], vols: [],
  earnings: null, overview: null, notes: null, notesPending: false,
  budget: null, stale: false, fetchedAt: null, busy: false, err: null,
};

function mkErr(kind, msg) { const e = new Error(msg); e.kind = kind; return e; }

async function call(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: "Bearer " + API_KEY, apikey: API_KEY } });
  } catch {
    throw mkErr("offline", "Der Server ist nicht erreichbar.");
  }

  let body = null;
  try { body = await res.json(); } catch { /* fällt unten durch */ }
  if (body?.budget) state.budget = body.budget;

  if (!res.ok || body?.error) {
    throw mkErr(body?.error?.code || "http_" + res.status, body?.error?.message || `HTTP ${res.status}`);
  }
  state.stale = !!body.stale;
  state.fetchedAt = body.fetchedAt || null;
  return body;
}

/* --------------------------- Symbol-Auflösung ---------------------------- */
const CRYPTO = new Set(["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "AVAX", "LINK", "LTC",
  "MATIC", "BCH", "XLM", "ATOM", "UNI", "ETC", "NEAR", "ALGO", "FIL", "AAVE", "TRX", "SHIB"]);
const CRYPTO_ALIAS = {
  BITCOIN: "BTC", ETHEREUM: "ETH", ETHER: "ETH", SOLANA: "SOL", RIPPLE: "XRP", CARDANO: "ADA",
  DOGECOIN: "DOGE", POLKADOT: "DOT", LITECOIN: "LTC", POLYGON: "MATIC", CHAINLINK: "LINK",
};

function asCrypto(raw) {
  const k = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const sym = CRYPTO_ALIAS[k] || (CRYPTO.has(k) ? k : null);
  if (!sym) return null;
  const nice = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", XRP: "XRP", ADA: "Cardano", DOGE: "Dogecoin" };
  return { symbol: sym, name: nice[sym] || sym, type: "Krypto", region: "global", currency: "EUR" };
}

async function searchSymbols(q) {
  return (await call({ op: "search", q })).data;
}

async function loadSeries(sym) {
  const p = sym.type === "Krypto"
    ? { op: "series", symbol: sym.symbol, kind: "crypto", market: "EUR" }
    : { op: "series", symbol: sym.symbol };
  return (await call(p)).data;
}

/* Alpha Vantage hat Fundamentaldaten nur für US-Notierungen. Für alles mit
   Börsensuffix (BMW.DEX, ASML.AMS …) sparen wir uns die leeren Abrufe —
   sie würden vom Tagesbudget abgehen, ohne etwas zu liefern. */
const isUS = (sym) => !sym.symbol.includes(".") || /united states/i.test(sym.region || "");

async function loadEarnings(sym) {
  if (sym.type !== "Aktie" || !isUS(sym)) return null;
  const d = (await call({ op: "earnings", symbol: sym.symbol })).data;
  return d && d.length ? d : null;
}

async function loadOverview(sym) {
  if (sym.type === "Krypto" || !isUS(sym)) return null;
  return (await call({ op: "overview", symbol: sym.symbol })).data;
}

/* ---- Redaktionelle Einordnung: gepflegt im Chat, hier nur gelesen ------- */
async function loadNotes(sym) {
  try {
    const res = await fetch(
      `https://lkxfxsadfxrxpsxnsqnb.supabase.co/rest/v1/rpc/kurslot_notes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: API_KEY, Authorization: "Bearer " + API_KEY },
        body: JSON.stringify({ p_symbol: sym.symbol }),
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row && (row.drivers?.length || row.episodes?.length) ? row : null;
  } catch { return null; }
}
/* ==========================================================================
   Rendering
   ========================================================================== */
const main = document.getElementById("main");

function render() {
  if (state.err) return renderError();
  if (state.busy) return renderBusy();
  if (!state.sym || !state.series) return renderEmpty();
  renderReport();
}

/* ------------------------------- Leerbild -------------------------------- */
function renderEmpty() {
  const off = state.offline;
  main.innerHTML = `
  <div style="padding:56px 0 40px">
    <div class="pane">
      <h2>${off ? "Server nicht erreichbar" : "Was willst du dir ansehen?"}</h2>
      <p>${off
        ? "Der Marktdaten-Server antwortet gerade nicht. Prüf deine Verbindung und lade die Seite neu — ohne echte Kurse zeigt Kurslot bewusst gar keine Zahlen statt geschätzter."
        : "Gib oben ein Symbol, einen Firmennamen oder eine Kryptowährung ein. Kurslot zieht die echte Kurshistorie, misst daraus Schockphasen und Erholungsdauern und stellt Guidance gegen tatsächliche Zahlen."}</p>
      ${off ? "" : `<div class="ex">
        <button data-ex="BMW.DEX">BMW.DEX</button>
        <button data-ex="AAPL">AAPL</button>
        <button data-ex="ASML">ASML</button>
        <button data-ex="Bitcoin">Bitcoin</button>
      </div>`}
    </div>
    ${renderFoot()}
  </div>`;
  main.querySelectorAll("[data-ex]").forEach(b => b.addEventListener("click", () => {
    document.getElementById("q").value = b.dataset.ex; go(b.dataset.ex);
  }));
}

function renderBusy() {
  main.innerHTML = `
  <div style="padding:34px 0">
    <div class="skel" style="height:34px;width:280px;margin-bottom:12px"></div>
    <div class="skel" style="height:56px;width:200px;margin-bottom:26px"></div>
    <div class="card"><div class="loading-line"><span class="spin"></span>${esc(state.busy)}</div>
      <div class="skel" style="height:250px;margin-top:14px"></div></div>
  </div>`;
}

function renderError() {
  const e = state.err;
  const fixes = {
    budget_exhausted: `Das Tageskontingent bei Alpha Vantage ist aufgebraucht (${state.budget?.limit ?? 25} Abrufe). Symbole, die heute schon abgerufen wurden, funktionieren weiterhin — für neue heißt es warten bis morgen. Um Mitternacht UTC setzt der Zähler zurück.`,
    rate_limited: "Alpha Vantage lässt im Gratis-Tarif nur einen Abruf pro Sekunde zu und hat gebremst. Warte einen Moment und versuch es erneut — dieser Fehlversuch zählt nicht gegen dein Tagesbudget.",
    no_key: "Auf dem Server ist kein Alpha-Vantage-Schlüssel hinterlegt. Ohne ihn kann Kurslot keine Kurse laden.",
    db: "Die Datenbank hinter Kurslot antwortet nicht wie erwartet. Das ist ein Fehler auf Serverseite, keiner deiner Eingabe.",
    offline: "Der Marktdaten-Server ist nicht erreichbar. Prüf deine Internetverbindung und versuch es erneut.",
    upstream: "Alpha Vantage antwortet gerade nicht. Das ist meist vorübergehend — probier es in einer Minute noch einmal.",
    thin: "Für dieses Symbol gibt es zu wenig Kurshistorie, um Schockphasen und Erholungsdauern zu messen.",
    shape: "Die Datenquelle hat in einem unerwarteten Format geantwortet. Das ist ein Fehler in Kurslot, keiner deiner Eingabe.",
    api: "Alpha Vantage kennt dieses Symbol nicht. Versuch das Börsenkürzel mit Suffix, z. B. BMW.DEX für XETRA oder AAPL für die Nasdaq.",
    notfound: "Zu dieser Eingabe gibt es keine Kursreihe. Versuch das Börsenkürzel mit Suffix, z. B. BMW.DEX für XETRA oder AAPL für die Nasdaq.",
    bad_request: "Diese Anfrage war unvollständig. Gib das Symbol noch einmal ein.",
  };
  const titles = {
    budget_exhausted: "Tageskontingent aufgebraucht", rate_limited: "Zu viele Abrufe",
    no_key: "Kein Zugangsschlüssel", db: "Datenbankfehler", offline: "Keine Verbindung",
    upstream: "Datenquelle antwortet nicht", thin: "Zu wenig Historie",
    shape: "Unerwartetes Datenformat", api: "Symbol unbekannt", notfound: "Nichts gefunden",
    bad_request: "Unvollständige Anfrage",
  };
  main.innerHTML = `
  <div style="padding:48px 0">
    <div class="pane err">
      <h2>${esc(titles[e.kind] || "Das hat nicht geklappt")}</h2>
      <p>${esc(fixes[e.kind] || e.msg || "Unbekannter Fehler.")}</p>
      <div class="ex"><button id="again">Erneut versuchen</button></div>
    </div>
    ${renderFoot()}
  </div>`;
  const b = main.querySelector("#again");
  if (b) b.addEventListener("click", () => { state.err = null; if (state.sym) load(state.sym); else render(); });
}

/* ------------------------------- Bericht --------------------------------- */
function renderReport() {
  const { sym, series, episodes, vols } = state;
  const cur = sym.currency || "";
  const last = series[series.length - 1];
  const view = sliceRange(series, state.range);
  const chgWin = (last.c / view[0].c - 1) * 100;
  const prev = series[series.length - 2];
  const chgWk = prev ? (last.c / prev.c - 1) * 100 : null;
  const ath = Math.max(...series.map(p => p.c));
  const fromAth = (last.c / ath - 1) * 100;

  main.innerHTML = `
  ${staleBanner()}
  <div class="headstrip">
    <div class="ident">
      <div class="chips">
        <span class="chip k">${esc(sym.type)}</span>
        <span class="chip">${esc(sym.symbol)}</span>
        ${sym.region ? `<span class="chip">${esc(sym.region)}</span>` : ""}
        ${state.overview?.sector ? `<span class="chip">${esc(state.overview.sector)}</span>` : ""}
      </div>
      <h1>${esc(sym.name || sym.symbol)}</h1>
      <div class="meta">Wochenschlusskurse seit ${mDE(series[0].t)} · zuletzt ${dDE(last.t)}</div>
    </div>
    <div class="quote">
      <div class="px">${fmt(last.c, last.c < 1 ? 4 : 2)}<span class="cur">${esc(cur)}</span></div>
      <div class="delta">
        <span><em>Woche</em><b class="${dirClass(chgWk)}">${pct(chgWk)}</b></span>
        <span><em>${esc(state.range)}</em><b class="${dirClass(chgWin)}">${pct(chgWin)}</b></span>
        <span><em>zum Hoch</em><b class="${dirClass(fromAth)}">${pct(fromAth)}</b></span>
      </div>
    </div>
  </div>

  <div class="stack">
    <section class="card">
      <div class="card-head">
        <div><span class="eyebrow">Baustein 1</span><h2>Kursverlauf</h2></div>
        <div class="seg" role="group" aria-label="Zeitraum">
          ${Object.keys(RANGES).map(k => `<button data-r="${k}" aria-pressed="${k === state.range}">${k}</button>`).join("")}
        </div>
      </div>
      <div id="chart1"></div>
    </section>

    <div class="grid">
      <section class="card">
        <div class="card-head"><div><span class="eyebrow">Baustein 2</span><h2>Ziel gegen Ist</h2></div></div>
        ${renderTargets()}
      </section>

      <section class="card">
        <div class="card-head"><div><span class="eyebrow">Baustein 3</span><h2>Schwankungstreiber</h2></div></div>
        ${renderDrivers()}
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div><span class="eyebrow">Baustein 4</span><h2>Schock und Erholung</h2></div>
        <span class="mono" style="font-size:12px;color:var(--ink-3)">${episodes.length} Phase${episodes.length === 1 ? "" : "n"} seit ${new Date(series[0].t).getFullYear()}</span>
      </div>
      <p class="card-note">Jede Linie ist ein tatsächlich gelaufener Verlauf, ab dem jeweiligen Hoch übereinandergelegt. Die blaue Linie ist die laufende Phase. Das ist eine Analogie, keine Prognose — wie oft und wie schnell sich der Kurs früher zurückgeholt hat, sagt nichts darüber, ob er es diesmal tut.</p>
      <div id="chart2"></div>
      ${renderEpisodes()}
    </section>
  </div>
  ${renderFoot()}`;

  priceChart(main.querySelector("#chart1"), view, { episodes, currency: cur });
  analogyChart(main.querySelector("#chart2"), episodes);
  const vb = main.querySelector("#volbars");
  if (vb) volBars(vb, vols);
  main.querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => {
    state.range = b.dataset.r; render(); window.scrollTo({ top: 0, behavior: "instant" });
  }));
}

/* -------------------------- Baustein 2: Ziel/Ist -------------------------- */
function renderTargets() {
  const e = state.earnings;
  if (!e) {
    const t = state.sym.type;
    return `<p class="card-note">${t === "Krypto"
      ? "Kryptowährungen veröffentlichen keine Ergebnisziele — es gibt hier nichts, wogegen sich ein Ist messen ließe. Für die Einordnung zählen deshalb Bausteine 3 und 4."
      : t === "ETF"
        ? "Ein Fonds hat keine eigene Ergebnis-Guidance, sondern folgt seinem Index. Statt Ziel gegen Ist siehst du hier die Jahresrenditen."
        : "Alpha Vantage führt Quartalszahlen nur für US-Notierungen. Für ein Papier mit Börsensuffix wie diesem fragt Kurslot sie gar nicht erst ab — das würde nur Tagesbudget kosten. Willst du Erwartung gegen Ist sehen, such dieselbe Firma unter ihrer US-Notierung (BMW etwa als BMWYY). Hier stattdessen: die Jahresrenditen."}</p>
      ${renderYearly()}`;
  }
  const rows = e.map(r => {
    const s = isFinite(r.surprise) ? r.surprise : (isFinite(r.estimated) ? (r.reported / r.estimated - 1) * 100 : null);
    const cls = s == null ? "n" : s >= 0 ? "g" : s > -8 ? "y" : "r";
    const lab = s == null ? "keine Schätzung" : s >= 0 ? "erreicht" : s > -8 ? "knapp verfehlt" : "verfehlt";
    const q = new Date(r.date);
    return `<div class="row">
      <span class="dot ${cls}"></span>
      <div class="lab">
        <b>Q${Math.floor(q.getMonth() / 3) + 1} ${q.getFullYear()}</b>
        <span>erwartet ${fmt(r.estimated)} · berichtet ${fmt(r.reported)}</span>
      </div>
      <div class="num"><span class="tag ${cls}">${lab}</span><br><span style="color:var(--ink-2)">${s == null ? "" : pct(s, 1)}</span></div>
    </div>`;
  }).join("");
  const hit = e.filter(r => (isFinite(r.surprise) ? r.surprise : 0) >= 0).length;
  return `<p class="card-note">Gewinn je Aktie: Analystenerwartung zum Zeitpunkt der Meldung gegen die tatsächlich berichtete Zahl. <b>${hit} von ${e.length}</b> der letzten Quartale erreicht oder übertroffen.</p>
    <div class="rows">${rows}</div>`;
}

function renderYearly() {
  const s = state.series;
  const byYear = new Map();
  s.forEach(p => byYear.set(new Date(p.t).getFullYear(), p.c));
  const yrs = [...byYear.keys()].sort().slice(-6);
  if (yrs.length < 2) return "";
  const rows = yrs.slice(1).map((y, i) => {
    const r = (byYear.get(y) / byYear.get(yrs[i]) - 1) * 100;
    const cls = r >= 0 ? "g" : r > -10 ? "y" : "r";
    return `<div class="row"><span class="dot ${cls}"></span>
      <div class="lab"><b>${y}</b><span>Jahresende gegen Vorjahresende</span></div>
      <div class="num ${dirClass(r)}">${pct(r)}</div></div>`;
  }).join("");
  return `<div class="rows" style="margin-top:14px">${rows}</div>`;
}

/* ------------------------ Baustein 3: Treiber ---------------------------- */
function renderDrivers() {
  const d = state.notes?.drivers;
  const risk = { hoch: ["var(--bad)", "wiederholt sich wahrscheinlich"], mittel: ["var(--warn)", "kann wiederkehren"], niedrig: ["var(--good)", "eher einmalig"] };
  const list = d ? d.map(x => {
    const [col, lab] = risk[String(x.risk || "").toLowerCase()] || risk.mittel;
    return `<div class="driver">
      <span class="stripe" style="background:${col}"></span>
      <div><h3>${esc(x.name)}</h3><p>${esc(x.note)}</p>
        <p style="color:var(--ink-3);font-size:11.5px;margin-top:4px">${esc(lab)}</p></div>
      <span class="when">${esc(x.last || "")}</span>
    </div>`;
  }).join("") : `<p class="card-note">${state.notesPending ? '<span class="spin"></span> Einordnung wird geladen …' : "Für dieses Symbol ist noch keine inhaltliche Einordnung hinterlegt. Die gemessenen Phasen und die Schwankungsbreite stehen unten trotzdem — sie kommen aus der Kursreihe, nicht aus einer Einschätzung."}</p>`;
  return `<p class="card-note">Was den Kurs in der Vergangenheit bewegt hat — und wie wahrscheinlich es wieder auftritt.</p>
    <div class="drivers">${list}</div>
    <div id="volbars" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--rule-2)"></div>`;
}

/* ----------------------- Baustein 4: Episodentabelle --------------------- */
function renderEpisodes() {
  const eps = state.episodes;
  if (!eps.length) return "";
  const named = new Map((state.notes?.episodes || []).map(e => [e.peakDate, e]));
  const done = eps.filter(e => !e.ongoing);
  const med = done.length ? [...done.map(e => e.toRecover)].sort((a, b) => a - b)[Math.floor(done.length / 2)] : null;
  const rows = [...eps].reverse().map(e => {
    const n = named.get(e.peakDate);
    return `<tr class="${e.ongoing ? "now" : ""}">
      <td class="ev">${esc(n?.event || "Rückgang " + mDE(e.peakDate))}${n?.why ? `<small>${esc(n.why)}</small>` : ""}</td>
      <td class="mono">${mDE(e.peakDate)}</td>
      <td class="mono r down">${fmt(e.drawdown, 0)} %</td>
      <td class="mono r">${fmtDuration(e.toTrough)}</td>
      <td class="r">${e.ongoing
        ? `<span class="tag y">läuft · ${fmtDuration(e.fromTrough)} seit Tief</span>`
        : `<span class="mono">${fmtDuration(e.toRecover)}</span>`}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto">
    <table class="eps">
      <thead><tr>
        <th>Phase</th><th>Hoch</th><th class="r">Rückgang</th><th class="r">bis zum Tief</th><th class="r">bis zurück am Hoch</th>
      </tr></thead><tbody>${rows}</tbody>
    </table></div>
    ${summaryLine(done, med)}`;
}

function summaryLine(done, med) {
  if (!done.length) return `<p class="card-note" style="margin:16px 0 0">Keine dieser Phasen ist bisher abgeschlossen — es gibt also keine Erholungsdauer, an der sich die laufende messen ließe.</p>`;
  if (done.length === 1) return `<p class="card-note" style="margin:16px 0 0">Die einzige abgeschlossene Phase brauchte <b>${fmtDuration(done[0].toRecover)}</b> vom Hoch zurück zum Hoch. Eine einzelne Erholung ist kein Muster.</p>`;
  const lo = Math.min(...done.map(x => x.toRecover)), hi = Math.max(...done.map(x => x.toRecover));
  return `<p class="card-note" style="margin:16px 0 0">Von ${done.length} abgeschlossenen Phasen brauchte die mittlere <b>${fmtDuration(med)}</b> vom Hoch zurück zum Hoch, die schnellste ${fmtDuration(lo)}, die längste ${fmtDuration(hi)}.</p>`;
}

function renderFoot() {
  return `<footer class="foot">
    <p><b>Keine Anlageberatung.</b> Kurslot zeigt vergangene Kurse und daraus gemessene Kennzahlen. Es gibt keine Empfehlung ab, prognostiziert keinen Kurs und kennt deine Situation nicht. Vergangene Erholungen sind kein Versprechen für kommende.</p>
    <p style="text-align:right">Kurse und Fundamentaldaten: Alpha Vantage,<br>Wochenschlusskurse, verzögert.${budgetLine()}</p>
  </footer>`;
}

function budgetLine() {
  const b = state.budget;
  if (!b || b.used == null) return "";
  const left = Math.max(0, b.limit - b.used);
  return `<br><span class="mono" style="font-size:11px">Heute noch ${left} von ${b.limit} Abrufen frei</span>`;
}

/** Kleines Band über dem Bericht, wenn die Zahlen aus dem Zwischenspeicher kommen. */
function staleBanner() {
  if (!state.stale || !state.fetchedAt) return "";
  return `<div class="stale">Diese Zahlen kommen aus dem Zwischenspeicher, Stand ${dDE(state.fetchedAt)}. Ein neuer Abruf war heute nicht mehr möglich.</div>`;
}

/* ==========================================================================
   Steuerung
   ========================================================================== */
async function load(sym) {
  state.sym = sym; state.err = null; state.notes = null; state.notesPending = true;
  state.busy = `${sym.name || sym.symbol} wird geladen …`; render();
  try {
    const series = await loadSeries(sym);
    if (!series || series.length < 20) throw mkErr("notfound", "zu wenig Kurshistorie");
    state.series = series;
    state.episodes = detectEpisodes(series);
    state.vols = annualVol(series);
    state.busy = false;
    try { state.earnings = await loadEarnings(sym); } catch { state.earnings = null; }
    try { state.overview = await loadOverview(sym); } catch { state.overview = null; }
    if (state.overview?.name) sym.name = state.overview.name;
    if (state.overview?.currency) sym.currency = state.overview.currency;
    render();
    loadNotes(sym).then(n => {
      state.notes = n; state.notesPending = false;
      if (state.sym === sym && !state.busy) render();
    });
  } catch (err) {
    state.busy = false;
    state.err = { kind: err.kind || err.code || "api", msg: err.message };
    render();
  }
}

async function go(q) {
  q = (q || "").trim(); if (!q) return;
  hideSugg();
  const c = asCrypto(q);
  if (c) return load(c);
  state.busy = `„${q}" wird gesucht …`; state.err = null; render();
  try {
    const hits = await searchSymbols(q);
    if (!hits.length) throw mkErr("notfound", "keine Treffer");
    await load(hits[0]);
  } catch (err) {
    state.busy = false;
    state.err = { kind: err.kind || err.code || "notfound", msg: err.message };
    render();
  }
}

/* ------------------------------ Suchfeld --------------------------------- */
const qEl = document.getElementById("q"), sEl = document.getElementById("sugg");
let sT = null, sIdx = -1, sItems = [];

function hideSugg() { clearTimeout(sT); sEl.hidden = true; qEl.setAttribute("aria-expanded", "false"); sIdx = -1; }

qEl.addEventListener("input", () => {
  clearTimeout(sT);
  const v = qEl.value.trim();
  if (v.length < 2) return hideSugg();
  sT = setTimeout(async () => {
    try {
      const c = asCrypto(v);
      const hits = await searchSymbols(v);
      sItems = (c ? [c] : []).concat(hits).slice(0, 7);
      if (!sItems.length) return hideSugg();
      sEl.innerHTML = sItems.map((r, i) => `<button role="option" data-i="${i}" aria-selected="false">
        <span class="sym">${esc(r.symbol)}</span><span class="nm">${esc(r.name)}</span><span class="rg">${esc(r.type)}${r.region ? " · " + esc(r.region) : ""}</span></button>`).join("");
      sEl.hidden = false; qEl.setAttribute("aria-expanded", "true"); sIdx = -1;
      sEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
        const r = sItems[+b.dataset.i]; qEl.value = r.symbol; hideSugg(); load(r);
      }));
    } catch { hideSugg(); }
  }, 320);
});

qEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); if (sIdx >= 0 && sItems[sIdx]) { qEl.value = sItems[sIdx].symbol; hideSugg(); load(sItems[sIdx]); } else go(qEl.value); return; }
  if (sEl.hidden) return;
  if (ev.key === "Escape") return hideSugg();
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    sIdx = (sIdx + (ev.key === "ArrowDown" ? 1 : -1) + sItems.length) % sItems.length;
    sEl.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-selected", String(i === sIdx)));
  }
});
document.addEventListener("click", e => { if (!e.target.closest(".searchbox")) hideSugg(); });

/* Charts an neue Breite anpassen */
let rT = null, lastW = window.innerWidth;
window.addEventListener("resize", () => {
  if (Math.abs(window.innerWidth - lastW) < 24) return;
  lastW = window.innerWidth;
  clearTimeout(rT);
  rT = setTimeout(() => { if (state.sym && state.series && !state.busy && !state.err) render(); }, 180);
});

/* ------------------------------- Theme ----------------------------------- */
const tBtn = document.getElementById("theme");
const ICON = {
  light: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.6"/><path d="M10 2v1.8M10 16.2V18M18 10h-1.8M3.8 10H2M15.7 4.3l-1.3 1.3M5.6 14.4l-1.3 1.3M15.7 15.7l-1.3-1.3M5.6 5.6 4.3 4.3"/></svg>',
  dark: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z"/></svg>',
};
let theme = null;
try { theme = localStorage.getItem("kurslot-theme"); } catch { }
function applyTheme() {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
  const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  tBtn.innerHTML = dark ? ICON.light : ICON.dark;
  tBtn.setAttribute("aria-label", dark ? "Zu hell wechseln" : "Zu dunkel wechseln");
}
tBtn.addEventListener("click", () => {
  const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  theme = dark ? "light" : "dark";
  try { localStorage.setItem("kurslot-theme", theme); } catch { }
  applyTheme();
  if (state.sym && state.series && !state.busy) render();
});
applyTheme();
render();

/* Beim Start einmal das Tagesbudget holen — das prüft zugleich, ob der
   Server überhaupt erreichbar ist, und kostet keinen Alpha-Vantage-Abruf. */
(async () => {
  try {
    const r = await fetch(`${API}?op=budget`, { headers: { Authorization: "Bearer " + API_KEY, apikey: API_KEY } });
    state.budget = await r.json();
    state.offline = false;
  } catch {
    state.offline = true;
  }
  if (!state.sym && !state.busy) render();
})();
