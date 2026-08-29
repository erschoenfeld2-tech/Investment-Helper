// Kurslot — Marktdaten-Proxy
//
// Warum es diese Funktion gibt:
//  1. Der Alpha-Vantage-Schlüssel bleibt auf dem Server, nie im Browser.
//  2. Der Gratis-Tarif erlaubt 25 Abrufe pro Tag. Jede Antwort landet roh in
//     kurslot.cache; ein zweiter Blick auf dasselbe Symbol kostet nichts.
//  3. Ist das Tagesbudget aufgebraucht, liefern wir lieber veraltete Daten
//     (mit Kennzeichnung) als gar keine.
//
// Roh wird zwischengespeichert, normalisiert wird beim Ausliefern — so lässt
// sich ein Parser-Fehler beheben, ohne erneut Abrufe zu verbrauchen.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const AV = "https://www.alphavantage.co/query";
const DAILY_LIMIT = 25;

/** Wie lange eine Antwort als frisch gilt (Millisekunden). */
const TTL: Record<string, number> = {
  search: 30 * 864e5,
  series: 2 * 864e5,
  crypto: 1 * 864e5,
  earnings: 20 * 864e5,
  overview: 20 * 864e5,
};

// Das Schema kurslot ist bewusst nicht über die REST-API freigegeben.
// Zugriff läuft über schmale SECURITY-DEFINER-Funktionen in public,
// die nur die service_role aufrufen darf.
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

/** Ruft eine der kurslot_*-Funktionen auf. Fehler werden nicht verschluckt:
 *  eine kaputte Datenbankanbindung darf nicht wie ein Marktdatenproblem aussehen. */
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new AvError("db", `${fn}: ${error.message}`);
  return data as T;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

const fail = (code: string, message: string, status = 400, extra: Record<string, unknown> = {}) =>
  json({ error: { code, message }, ...extra }, status);

class AvError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/* ----------------------------- Schlüssel -------------------------------- */
let keyCache: string | null = null;
async function apiKey(): Promise<string | null> {
  if (keyCache) return keyCache;
  const env = Deno.env.get("ALPHAVANTAGE_KEY");
  if (env) return (keyCache = env);
  const v = await rpc<string | null>("kurslot_secret", { p_name: "alphavantage_key" });
  return (keyCache = v ?? null);
}

/* ------------------------------- Cache ---------------------------------- */
type Cached = { payload: unknown; fetched_at: string } | null;

async function readCache(kind: string, key: string): Promise<Cached> {
  const rows = await rpc<Cached[]>("kurslot_get", { p_kind: kind, p_key: key });
  return rows?.[0] ?? null;
}

async function writeCache(kind: string, key: string, payload: unknown) {
  await rpc("kurslot_put", { p_kind: kind, p_key: key, p_payload: payload });
}

/** Erhöht den Tageszähler. false = Budget erschöpft (nicht: Fehler). */
async function spend(): Promise<boolean> {
  const calls = await rpc<number | null>("kurslot_spend", { p_limit: DAILY_LIMIT });
  return calls !== null;
}

async function usage() {
  try {
    return { used: await rpc<number>("kurslot_usage"), limit: DAILY_LIMIT };
  } catch {
    return { used: null, limit: DAILY_LIMIT };
  }
}

/* --------------------------- Alpha Vantage ------------------------------ */
/** Alpha Vantage lässt im Gratis-Tarif nur einen Abruf je Sekunde zu.
 *  Wir halten den Abstand selbst ein, statt in die Bremse zu laufen. */
let lastCall = 0;
async function throttle() {
  const wait = 1200 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function callAv(params: Record<string, string>): Promise<unknown> {
  const key = await apiKey();
  if (!key) throw new AvError("no_key", "Es ist kein Alpha-Vantage-Schlüssel hinterlegt.");

  await throttle();
  const url = new URL(AV);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);

  const res = await fetch(url, { headers: { "User-Agent": "kurslot/1.0" } });
  if (!res.ok) throw new AvError("upstream", `Alpha Vantage antwortete mit ${res.status}.`);

  const body = await res.json().catch(() => null);
  if (!body || typeof body !== "object") throw new AvError("shape", "Antwort war kein JSON-Objekt.");

  const rec = body as Record<string, unknown>;
  const note = (rec["Error Message"] ?? rec["Note"] ?? rec["Information"]) as string | undefined;
  if (note) {
    const limited = /rate limit|frequency|premium|thank you for using/i.test(note);
    throw new AvError(limited ? "rate_limited" : "api", note);
  }
  return body;
}

/**
 * Holt (kind, key) aus dem Cache oder frisch von Alpha Vantage.
 * Bei erschöpftem Budget oder Fehler wird ein vorhandener alter Eintrag
 * zurückgegeben und als veraltet markiert.
 */
async function fetchOrCache(kind: string, key: string, params: Record<string, string>) {
  const hit = await readCache(kind, key);
  const age = hit ? Date.now() - new Date(hit.fetched_at).getTime() : Infinity;
  if (hit && age < (TTL[kind] ?? 864e5)) {
    return { payload: hit.payload, fetchedAt: hit.fetched_at, stale: false };
  }

  // Erst prüfen, ob überhaupt ein Abruf möglich ist — sonst zählt das Budget
  // Anfragen mit, die Alpha Vantage nie erreicht haben.
  if (!(await apiKey())) throw new AvError("no_key", "Es ist kein Alpha-Vantage-Schlüssel hinterlegt.");

  if (!(await spend())) {
    if (hit) return { payload: hit.payload, fetchedAt: hit.fetched_at, stale: true, reason: "budget" };
    throw new AvError("budget_exhausted", `Das Tagesbudget von ${DAILY_LIMIT} Abrufen ist aufgebraucht.`);
  }

  try {
    let fresh: unknown;
    try {
      fresh = await callAv(params);
    } catch (err) {
      // Sekundenbremse: einmal nachfassen, statt den Abruf zu verlieren.
      if ((err as AvError).code !== "rate_limited") throw err;
      await new Promise((r) => setTimeout(r, 1500));
      fresh = await callAv(params);
    }
    await writeCache(kind, key, fresh);
    return { payload: fresh, fetchedAt: new Date().toISOString(), stale: false };
  } catch (err) {
    // Ohne Daten kein verbrauchter Abruf.
    await rpc("kurslot_refund").catch(() => {});
    if (hit) return { payload: hit.payload, fetchedAt: hit.fetched_at, stale: true, reason: (err as AvError).code };
    throw err;
  }
}

/* -------------------------- Normalisierung ------------------------------ */
function seriesFrom(raw: unknown): { t: string; c: number }[] {
  const obj = raw as Record<string, Record<string, Record<string, string>>>;
  const key = Object.keys(obj).find((k) => /time series|digital currency/i.test(k));
  if (!key) throw new AvError("shape", "In der Antwort steckt keine Kursreihe.");

  const out: { t: string; c: number }[] = [];
  for (const [date, row] of Object.entries(obj[key] ?? {})) {
    const fields = Object.keys(row);
    const ck = fields.find((k) => /adjusted close/i.test(k)) ?? fields.find((k) => /close/i.test(k));
    const c = ck ? parseFloat(row[ck]) : NaN;
    if (Number.isFinite(c) && c > 0) out.push({ t: date.slice(0, 10), c });
  }
  out.sort((a, b) => (a.t < b.t ? -1 : 1));
  if (out.length < 20) throw new AvError("thin", "Für dieses Symbol gibt es zu wenig Kurshistorie.");
  return out;
}

function matchesFrom(raw: unknown) {
  const rows = ((raw as Record<string, unknown>).bestMatches ?? []) as Record<string, string>[];
  return rows
    .map((r) => {
      // Alpha Vantage liefert für manche Treffer den Text "null" als Namen.
      const name = r["2. name"];
      const symbol = r["1. symbol"] ?? "";
      return {
        symbol,
        name: !name || name === "null" ? symbol : name,
        type: r["3. type"] === "ETF" ? "ETF" : "Aktie",
        region: r["4. region"] ?? "",
        currency: r["8. currency"] ?? "",
      };
    })
    .filter((r) => r.symbol);
}

function earningsFrom(raw: unknown) {
  const rows = ((raw as Record<string, unknown>).quarterlyEarnings ?? []) as Record<string, string>[];
  return rows
    .slice(0, 8)
    .map((r) => ({
      date: r.fiscalDateEnding,
      reportedOn: r.reportedDate ?? null,
      reported: parseFloat(r.reportedEPS),
      estimated: parseFloat(r.estimatedEPS),
      surprise: parseFloat(r.surprisePercentage),
    }))
    .filter((r) => Number.isFinite(r.reported));
}

function overviewFrom(raw: unknown) {
  const o = raw as Record<string, string>;
  if (!o?.Symbol) return null;
  return {
    symbol: o.Symbol, name: o.Name, sector: o.Sector || null,
    industry: o.Industry || null, currency: o.Currency || null,
    exchange: o.Exchange || null, country: o.Country || null,
    description: o.Description || null,
  };
}

/* -------------------------------- Router -------------------------------- */
const clean = (s: string) => s.trim().slice(0, 40).replace(/[^A-Za-z0-9.\-_ ]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const op = url.searchParams.get("op") ?? "";
  const symbol = clean(url.searchParams.get("symbol") ?? "");
  const q = clean(url.searchParams.get("q") ?? "");
  const market = clean(url.searchParams.get("market") ?? "EUR") || "EUR";

  try {
    if (op === "budget") return json(await usage());

    if (op === "search") {
      if (q.length < 2) return fail("bad_request", "Suchbegriff ist zu kurz.");
      const r = await fetchOrCache("search", q.toLowerCase(), { function: "SYMBOL_SEARCH", keywords: q });
      return json({ data: matchesFrom(r.payload), fetchedAt: r.fetchedAt, stale: r.stale, budget: await usage() });
    }

    if (op === "series") {
      if (!symbol) return fail("bad_request", "Es fehlt das Symbol.");
      const isCrypto = url.searchParams.get("kind") === "crypto";
      const r = isCrypto
        ? await fetchOrCache("crypto", `${symbol}:${market}`, { function: "DIGITAL_CURRENCY_WEEKLY", symbol, market })
        : await fetchOrCache("series", symbol, { function: "TIME_SERIES_WEEKLY_ADJUSTED", symbol });
      return json({ data: seriesFrom(r.payload), fetchedAt: r.fetchedAt, stale: r.stale, budget: await usage() });
    }

    if (op === "earnings") {
      if (!symbol) return fail("bad_request", "Es fehlt das Symbol.");
      const r = await fetchOrCache("earnings", symbol, { function: "EARNINGS", symbol });
      return json({ data: earningsFrom(r.payload), fetchedAt: r.fetchedAt, stale: r.stale, budget: await usage() });
    }

    if (op === "overview") {
      if (!symbol) return fail("bad_request", "Es fehlt das Symbol.");
      const r = await fetchOrCache("overview", symbol, { function: "OVERVIEW", symbol });
      return json({ data: overviewFrom(r.payload), fetchedAt: r.fetchedAt, stale: r.stale, budget: await usage() });
    }

    return fail("bad_request", `Unbekannte Operation: ${op || "(keine)"}`);
  } catch (err) {
    const e = err as AvError;
    const status = e.code === "budget_exhausted" || e.code === "rate_limited" ? 429
      : e.code === "no_key" ? 503
      : e.code === "db" ? 500 : 502;
    return fail(e.code ?? "unknown", e.message ?? "Unbekannter Fehler", status, { budget: await usage() });
  }
});
