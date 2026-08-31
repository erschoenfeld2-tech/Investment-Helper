/* ==========================================================================
   Kurslot — Analyse-Layer
   Alles Quantitative wird aus der echten Kursreihe gerechnet, nicht geschätzt.
   ========================================================================== */
"use strict";

/* ------------------------------- Format --------------------------------- */
const nf = (d = 2) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? "–" : nf(d).format(v);
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? "–" : (v > 0 ? "+" : "") + nf(d).format(v) + " %";
const dDE = (s) => { const t = new Date(s); return isNaN(t) ? String(s) : t.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }); };
const mDE = (s) => { const t = new Date(s); return isNaN(t) ? String(s) : t.toLocaleDateString("de-DE", { month: "short", year: "numeric" }); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dirClass = (v) => v == null ? "flat" : v > 0.05 ? "up" : v < -0.05 ? "down" : "flat";
const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24 * 30.44);

function fmtDuration(months) {
  if (months == null || !isFinite(months)) return "–";
  if (months < 1.5) return Math.max(1, Math.round(months * 4.35)) + " Wo.";
  if (months < 22) return Math.round(months) + " Mon.";
  const y = months / 12;
  return nf(y % 1 < 0.1 ? 0 : 1).format(y) + " J.";
}

/* --------------------------- Episoden-Erkennung --------------------------
   Ein "Schock" ist ein Rückgang vom laufenden Allzeithoch um mindestens
   THRESHOLD. Die Episode endet, wenn das alte Hoch wieder erreicht wird.
   Rein mechanisch aus der Kursreihe — keine Interpretation.
-------------------------------------------------------------------------- */
const THRESHOLD = 0.18;

function detectEpisodes(series, threshold = THRESHOLD) {
  if (!series || series.length < 20) return [];
  const eps = [];
  let peakI = 0, i = 1;
  while (i < series.length) {
    if (series[i].c >= series[peakI].c) { peakI = i; i++; continue; }
    if (series[i].c <= series[peakI].c * (1 - threshold)) {
      // Schock bestätigt — Tief und Erholung suchen
      let troughI = i, j = i;
      while (j < series.length && series[j].c < series[peakI].c) {
        if (series[j].c < series[troughI].c) troughI = j;
        j++;
      }
      const recovered = j < series.length;
      eps.push({
        peakDate: series[peakI].t, peakPrice: series[peakI].c,
        troughDate: series[troughI].t, troughPrice: series[troughI].c,
        recoveryDate: recovered ? series[j].t : null,
        drawdown: (series[troughI].c / series[peakI].c - 1) * 100,
        toTrough: monthsBetween(series[peakI].t, series[troughI].t),
        toRecover: recovered ? monthsBetween(series[peakI].t, series[j].t) : null,
        fromTrough: recovered ? monthsBetween(series[troughI].t, series[j].t) : monthsBetween(series[troughI].t, series[series.length - 1].t),
        ongoing: !recovered,
        peakI, troughI, endI: recovered ? j : series.length - 1,
        // normalisierter Pfad ab Hoch, in % zum Hoch
        path: series.slice(peakI, (recovered ? j : series.length - 1) + 1)
          .map((p, k) => ({ w: k, v: (p.c / series[peakI].c - 1) * 100, t: p.t })),
      });
      peakI = recovered ? j : series.length - 1;
      i = recovered ? j + 1 : series.length;
      continue;
    }
    i++;
  }
  return eps;
}

/* ---------------------------- Volatilität -------------------------------- */
function annualVol(series) {
  // Jahresweise annualisierte Standardabweichung der Wochenrenditen
  const byYear = new Map();
  for (let i = 1; i < series.length; i++) {
    const r = Math.log(series[i].c / series[i - 1].c);
    if (!isFinite(r)) continue;
    const y = new Date(series[i].t).getFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }
  const out = [];
  for (const [y, rs] of byYear) {
    if (rs.length < 20) continue;
    const m = rs.reduce((a, b) => a + b, 0) / rs.length;
    const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1));
    out.push({ year: y, vol: sd * Math.sqrt(52) * 100 });
  }
  return out.sort((a, b) => a.year - b.year);
}

function maxDrawdownWindow(series) {
  let peak = -Infinity, mdd = 0;
  for (const p of series) { if (p.c > peak) peak = p.c; mdd = Math.min(mdd, p.c / peak - 1); }
  return mdd * 100;
}

/* ------------------------ Gleitender Durchschnitt ------------------------
   Reiner Chart-Kontext (Golden/Death Cross ablesbar), kein Signal — deshalb
   nie ohne den jeweils anderen und nie mit einer Handlungsempfehlung
   beschriftet. Läuft auf denselben Wochenschlusskursen wie Baustein 1, also
   "50/200 Wochen" statt der auf Tageskursen üblichen "50/200 Tage". */
function computeSma(series, period) {
  if (!series || series.length < period) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i].c;
    if (i >= period) sum -= series[i - period].c;
    if (i >= period - 1) out.push({ t: series[i].t, v: sum / period });
  }
  return out;
}

/* ---------------------------------- RSI -----------------------------------
   Vereinfachte Variante (gleitender Mittelwert der letzten `period` Wochen-
   veränderungen, nicht Wilders geglätteter RSI) — für einen Kontextwert
   genau genug, ausdrücklich kein Handelssignal. Auf Wochenbasis, wie der
   Rest der Seite; die üblichen Schwellen 30/70 bleiben unverändert gültig. */
function computeRsi(series, period = 14) {
  if (!series || series.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const diff = series[i].c - series[i - 1].c;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/* ----------------------------- Zeitfenster ------------------------------- */
const RANGES = { "6M": 6, "1J": 12, "2J": 24, "5J": 60, "Max": null };
function sliceRange(series, key) {
  const m = RANGES[key];
  if (!m) return series;
  const cut = new Date(series[series.length - 1].t);
  cut.setMonth(cut.getMonth() - m);
  const s = series.filter(p => new Date(p.t) >= cut);
  return s.length > 3 ? s : series;
}

/* ==========================================================================
   SVG-Charts — handgeschrieben, damit Grid, Endpunkt und Hover stimmen
   ========================================================================== */
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/* ---------------------- Chart 1: echter Kursverlauf ---------------------- */
function chartW(el) { return Math.max(360, Math.round(el.clientWidth || 1000)); }

function priceChart(el, series, opts) {
  const { episodes = [], currency = "", sma50 = [], sma200 = [] } = opts || {};
  const W = chartW(el), H = W < 620 ? 300 : 340, P = { t: 16, r: 54, b: 30, l: 8 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const xs = series.map(p => +new Date(p.t));
  const x0 = xs[0], x1 = xs[xs.length - 1];
  // SMA-Punkte im sichtbaren Fenster fließen in die Skalierung ein, sonst
  // könnte eine nachlaufende Linie oben oder unten aus dem Chart heraushängen.
  const inWindow = (p) => { const t = +new Date(p.t); return t >= x0 && t <= x1; };
  const sma50V = sma50.filter(inWindow), sma200V = sma200.filter(inWindow);
  const allV = series.map(p => p.c).concat(sma50V.map(p => p.v), sma200V.map(p => p.v));
  const lo = Math.min(...allV), hi = Math.max(...allV);
  const pad = (hi - lo) * 0.12 || hi * 0.05;
  const yMin = Math.max(0, lo - pad), yMax = hi + pad;
  const X = t => P.l + ((+new Date(t) - x0) / (x1 - x0 || 1)) * iw;
  const Y = v => P.t + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;

  const line = series.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(2) + " " + Y(p.c).toFixed(2)).join(" ");
  const smaLine = (pts) => pts.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(2) + " " + Y(p.v).toFixed(2)).join(" ");
  const sma50Path = smaLine(sma50V), sma200Path = smaLine(sma200V);
  const area = line + ` L ${X(series[series.length - 1].t).toFixed(2)} ${P.t + ih} L ${X(series[0].t).toFixed(2)} ${P.t + ih} Z`;

  const yT = niceTicks(yMin, yMax, 5);
  const span0 = yMax - yMin;
  const dec = span0 < 1 ? 3 : span0 < 8 ? 2 : span0 < 60 ? 1 : 0;
  const grid = yT.map(v => `<line x1="${P.l}" x2="${P.l + iw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--rule-2)" stroke-width="1"/>
    <text x="${P.l + iw + 8}" y="${(Y(v) + 4).toFixed(1)}" fill="var(--ink-3)" font-size="11" font-family="IBM Plex Mono, monospace">${fmt(v, dec)}</text>`).join("");

  // Zeitachse
  const span = (x1 - x0) / (1000 * 60 * 60 * 24 * 365.25);
  const stepY = span > 8 ? 2 : span > 3 ? 1 : 0;
  const xLab = [];
  if (stepY) {
    for (let y = new Date(x0).getFullYear() + 1; y <= new Date(x1).getFullYear(); y += stepY) {
      const t = +new Date(y, 0, 1); if (t < x0 || t > x1) continue;
      xLab.push(`<text x="${X(t).toFixed(1)}" y="${H - 8}" fill="var(--ink-3)" font-size="11" text-anchor="middle" font-family="IBM Plex Mono, monospace">${y}</text>`);
    }
  } else {
    const n = W < 620 ? 3 : 5;
    for (let k = 0; k <= n; k++) {
      const t = x0 + (x1 - x0) * k / n;
      xLab.push(`<text x="${X(t).toFixed(1)}" y="${H - 8}" fill="var(--ink-3)" font-size="11" text-anchor="${k === 0 ? "start" : k === n ? "end" : "middle"}" font-family="IBM Plex Mono, monospace">${mDE(t)}</text>`);
    }
  }

  // Schock-Bänder im sichtbaren Fenster
  const bands = episodes.map(e => {
    const a = Math.max(+new Date(e.peakDate), x0), b = Math.min(+new Date(e.recoveryDate || e.troughDate), x1);
    if (b <= a) return "";
    return `<rect x="${X(a).toFixed(1)}" y="${P.t}" width="${Math.max(1, X(b) - X(a)).toFixed(1)}" height="${ih}" fill="var(--ghost)" opacity="${e.ongoing ? .16 : .1}"/>`;
  }).join("");

  const last = series[series.length - 1];
  el.innerHTML = `
  <div class="chartbox">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kursverlauf">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity=".16"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      ${bands}${grid}
      <path d="${area}" fill="url(#pg)"/>
      ${sma200Path ? `<path d="${sma200Path}" fill="none" stroke="var(--warn)" stroke-width="1.4" stroke-linejoin="round" opacity=".8"/>` : ""}
      ${sma50Path ? `<path d="${sma50Path}" fill="none" stroke="var(--ink-3)" stroke-width="1.4" stroke-linejoin="round" opacity=".9"/>` : ""}
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.c).toFixed(1)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
      ${xLab.join("")}
      <g id="cross" opacity="0">
        <line y1="${P.t}" y2="${P.t + ih}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3"/>
        <circle r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
      </g>
      <rect x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent" id="hit"/>
    </svg>
    <div class="tip" id="tip" style="opacity:0"></div>
  </div>
  <div class="legend">
    <span><i style="background:var(--accent)"></i>Kurs${currency ? " in " + esc(currency) : ""}</span>
    ${sma50Path ? `<span><i style="background:var(--ink-3)"></i>SMA 50 Wochen — Kontext, kein Signal</span>` : ""}
    ${sma200Path ? `<span><i style="background:var(--warn)"></i>SMA 200 Wochen — Kontext, kein Signal</span>` : ""}
    ${episodes.length ? `<span><i class="sw-band" style="background:var(--ghost);opacity:.45"></i>Schockphase (Rückgang ≥ 18 % vom Hoch bis zur Erholung)</span>` : ""}
  </div>`;

  // Hover
  const svg = el.querySelector("svg"), tip = el.querySelector("#tip"), cross = el.querySelector("#cross");
  const box = el.querySelector(".chartbox");
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const cx = ((ev.clientX ?? ev.touches?.[0]?.clientX) - r.left) / r.width * W;
    let best = 0, bd = Infinity;
    series.forEach((p, i) => { const d = Math.abs(X(p.t) - cx); if (d < bd) { bd = d; best = i; } });
    const p = series[best], px = X(p.t), py = Y(p.c);
    cross.setAttribute("opacity", "1");
    cross.querySelector("line").setAttribute("x1", px); cross.querySelector("line").setAttribute("x2", px);
    cross.querySelector("circle").setAttribute("cx", px); cross.querySelector("circle").setAttribute("cy", py);
    const chg = (p.c / series[0].c - 1) * 100;
    tip.innerHTML = `<div class="d">${dDE(p.t)}</div><div class="v">${fmt(p.c)} ${esc(currency)}</div><div class="x">seit Fensterbeginn <b class="${dirClass(chg)}">${pct(chg)}</b></div>`;
    tip.style.opacity = "1";
    const rel = px / W * box.clientWidth;
    tip.style.left = Math.min(Math.max(rel - 70, 0), box.clientWidth - 150) + "px";
    tip.style.top = (py / H * (box.clientHeight || 340) - 70) + "px";
  };
  box.addEventListener("pointermove", move);
  box.addEventListener("pointerleave", () => { tip.style.opacity = "0"; cross.setAttribute("opacity", "0"); });
}

/* ------------- Chart 2: Analogie — Episoden ab Hoch übereinander ---------- */
function analogyChart(el, episodes) {
  const done = episodes.filter(e => !e.ongoing);
  const now = episodes.find(e => e.ongoing);
  const shown = done.slice(-5);
  const all = [...shown, ...(now ? [now] : [])];
  if (!all.length) { el.innerHTML = `<p class="card-note">Keine Schockphase mit mindestens 18 % Rückgang in der verfügbaren Historie.</p>`; return; }

  const W = chartW(el), H = W < 620 ? 270 : 300, P = { t: 16, r: 50, b: 28, l: 8 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxW = Math.max(...all.map(e => e.path.length - 1), 12);
  const minV = Math.min(-5, ...all.flatMap(e => e.path.map(p => p.v)));
  const maxV = Math.max(5, ...all.flatMap(e => e.path.map(p => p.v)));
  const X = w => P.l + (w / maxW) * iw;
  const Y = v => P.t + (1 - (v - minV) / (maxV - minV || 1)) * ih;

  const yT = niceTicks(minV, maxV, 5);
  const grid = yT.map(v => `<line x1="${P.l}" x2="${P.l + iw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${v === 0 ? "var(--rule)" : "var(--rule-2)"}" stroke-width="${v === 0 ? 1.5 : 1}"/>
    <text x="${P.l + iw + 8}" y="${(Y(v) + 4).toFixed(1)}" fill="var(--ink-3)" font-size="11" font-family="IBM Plex Mono, monospace">${v > 0 ? "+" : ""}${fmt(v, 0)}%</text>`).join("");

  const maxTicks = W < 620 ? 4 : 6;
  const step = [4, 8, 13, 26, 52, 104, 156, 260, 520].find(s => maxW / s <= maxTicks) || 520;
  const xLab = (() => {
    const out = [];
    for (let w = 0; w <= maxW; w += step) {
      let lab;
      if (w === 0) lab = "Hoch";
      else if (step < 52) lab = Math.round(w / 4.345) + " Mon.";
      else { const y = w / 52; lab = (Number.isInteger(y) ? y : nf(1).format(y)) + " J."; }
      out.push(`<text x="${X(w).toFixed(1)}" y="${H - 8}" fill="var(--ink-3)" font-size="11" text-anchor="middle" font-family="IBM Plex Mono, monospace">${lab}</text>`);
    }
    return out.join("");
  })();

  // frühere Episoden: eine Grau-Rampe, älteste am hellsten
  const shades = ["var(--ghost-2)", "var(--ghost-2)", "var(--ghost)", "var(--ghost)", "var(--ghost)"];
  const past = shown.map((e, i) => {
    const d = e.path.map((p, k) => (k ? "L" : "M") + X(p.w).toFixed(2) + " " + Y(p.v).toFixed(2)).join(" ");
    const endW = e.path.length - 1;
    return `<path d="${d}" fill="none" stroke="${shades[shades.length - shown.length + i] || "var(--ghost)"}" stroke-width="1.7" stroke-linejoin="round"/>
      <text x="${(X(endW) + 6).toFixed(1)}" y="${(Y(e.path[endW].v) + 4).toFixed(1)}" fill="var(--ink-3)" font-size="10.5" font-family="IBM Plex Mono, monospace">${new Date(e.peakDate).getFullYear()}</text>`;
  }).join("");

  let cur = "";
  if (now) {
    const d = now.path.map((p, k) => (k ? "L" : "M") + X(p.w).toFixed(2) + " " + Y(p.v).toFixed(2)).join(" ");
    const endW = now.path.length - 1;
    cur = `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(endW).toFixed(1)}" cy="${Y(now.path[endW].v).toFixed(1)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
      <text x="${(X(endW) + 9).toFixed(1)}" y="${(Y(now.path[endW].v) + 4).toFixed(1)}" fill="var(--accent)" font-size="11" font-weight="600" font-family="IBM Plex Mono, monospace">heute</text>`;
  }

  el.innerHTML = `
  <div class="chartbox">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf nach früheren Hochs im Vergleich">
      ${grid}${past}${cur}${xLab}
    </svg>
  </div>
  <div class="legend">
    ${now ? `<span><i style="background:var(--accent)"></i>laufende Phase (Hoch ${mDE(now.peakDate)})</span>` : ""}
    <span><i style="background:var(--ghost)"></i>frühere Phasen, ab ihrem jeweiligen Hoch übereinandergelegt</span>
  </div>`;
}

/* ---------------------- kleiner Volatilitäts-Balken ---------------------- */
function volBars(el, vols) {
  if (!vols.length) { el.innerHTML = ""; return; }
  const show = vols.slice(-10);
  const max = Math.max(...show.map(v => v.vol), 20);
  el.innerHTML = `<div style="display:flex;gap:5px;align-items:flex-end;height:74px;margin-top:6px">
    ${show.map(v => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;gap:5px" title="${v.year}: ${fmt(v.vol, 0)} % annualisiert">
      <div style="height:${(v.vol / max * 100).toFixed(1)}%;background:${v.year === show[show.length - 1].year ? "var(--accent)" : "var(--ghost-2)"};border-radius:3px 3px 0 0;min-height:2px"></div>
      <div class="mono" style="font-size:10px;color:var(--ink-3);text-align:center">'${String(v.year).slice(2)}</div>
    </div>`).join("")}
  </div>
  <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-3);margin-top:8px">
    <span>Schwankungsbreite je Jahr (annualisiert)</span>
    <span class="mono">${fmt(show[show.length - 1].vol, 0)} % zuletzt · Ø ${fmt(show.reduce((a, b) => a + b.vol, 0) / show.length, 0)} %</span>
  </div>`;
}
