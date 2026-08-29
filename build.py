#!/usr/bin/env python3
"""Baut die auslieferbare Seite aus src/.

  index.html       das Ergebnis — eine einzige Datei, direkt im Browser lauffähig
                   und genau das, was GitHub Pages ausliefern würde
  test/page.html   dieselbe Seite mit vorgeschaltetem fetch-Testdouble

Für die verkleinerte Fassung: `node minify.js` (schreibt dist/index.min.html).
"""
import pathlib

root = pathlib.Path(__file__).parent
src = root / "src"

shell = (src / "shell.html").read_text(encoding="utf-8")
js = (src / "app.js").read_text(encoding="utf-8") + "\n" + (src / "app2.js").read_text(encoding="utf-8")

HEAD = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Aktien, ETFs und Krypto einordnen: echter Kursverlauf, Guidance gegen Ist, Schwankungstreiber und historische Erholungsmuster.">
<meta name="color-scheme" content="light dark">
<style>html{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
{extra}
</head>
<body>
"""

body = shell + "\n<script>\n" + js + "\n</script>\n"

page = HEAD.replace("{extra}", "") + body + "\n</body>\n</html>\n"
(root / "index.html").write_text(page, encoding="utf-8")

test = root / "test"
stub = (test / "stub.js").read_text(encoding="utf-8")
(test / "page.html").write_text(
    HEAD.replace("{extra}", "<script>\n" + stub + "\n</script>") + body + "\n</body>\n</html>\n",
    encoding="utf-8",
)

print(f"index.html gebaut: {len(page)} Zeichen")
