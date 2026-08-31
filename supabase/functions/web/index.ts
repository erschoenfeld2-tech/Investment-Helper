// Kurslot — Platzhalter.
//
// Versuch, die Oberfläche direkt aus dieser Funktion auszuliefern, ist
// gescheitert: Supabase erzwingt für Edge-Function-Antworten serverseitig
// eine Sandbox-CSP (`Content-Security-Policy: default-src 'none'; sandbox`)
// und überschreibt den Content-Type auf text/plain — vermutlich eine
// Sicherheitsmaßnahme gegen das Hosten beliebigen ausführbaren HTML/JS über
// Functions. Damit lässt sich eine interaktive Seite hier nicht ausliefern.
//
// Die Kurslot-Oberfläche läuft weiterhin als einzelne Datei (index.html im
// Repo-Wurzelverzeichnis) und braucht echtes Static Hosting, kein Edge
// Function-Response. Optionen: Supabase Storage (öffentlicher Bucket),
// GitHub Pages (Repo müsste dafür öffentlich sein) oder ein beliebiger
// anderer Static Host.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const page = `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kurslot</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       background:#f5f5f2;color:#191c18;
       font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
  main{max-width:48ch;padding:32px;text-align:center}
  h1{font-size:22px;margin:0 0 12px;letter-spacing:-.02em}
  p{margin:0 0 8px;color:#5a6058;font-size:15px}
  code{font-family:ui-monospace,Menlo,monospace;font-size:13px}
  @media (prefers-color-scheme:dark){
    body{background:#101210;color:#e9ebe4}
    p{color:#969c90}
  }
</style></head>
<body><main>
  <h1>Kurslot</h1>
  <p>Die Marktdaten-Schnittstelle läuft unter <code>/functions/v1/market</code>.</p>
  <p>Die Oberfläche selbst braucht echtes Static Hosting (Supabase Storage,
  GitHub Pages o. ä.) — eine Edge Function kann kein ausführbares HTML
  ausliefern.</p>
</main></body></html>`;

Deno.serve(() =>
  new Response(page, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
);
