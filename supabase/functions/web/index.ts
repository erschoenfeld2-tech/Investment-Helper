// Platzhalter. Die Kurslot-Oberfläche wird derzeit als einzelne HTML-Datei
// ausgeliefert und ruft von dort die Funktion "market" auf. Sobald die Seite
// aus diesem Repository heraus deployt wird, ersetzt sie diesen Platzhalter.

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
  main{max-width:44ch;padding:32px;text-align:center}
  h1{font-size:22px;margin:0 0 12px;letter-spacing:-.02em}
  p{margin:0;color:#5a6058;font-size:15px}
  code{font-family:ui-monospace,Menlo,monospace;font-size:13px}
  @media (prefers-color-scheme:dark){
    body{background:#101210;color:#e9ebe4}
    p{color:#969c90}
  }
</style></head>
<body><main>
  <h1>Kurslot</h1>
  <p>Die Marktdaten-Schnittstelle läuft unter <code>/functions/v1/market</code>.
  Die Oberfläche wird noch nicht von hier ausgeliefert.</p>
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
