// Erzeugt dist/index.min.html — inhaltlich identisch zu index.html, nur kleiner.
// Nötig, wenn die Seite als Edge Function ausgeliefert werden soll.
const { minify } = require("terser");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

(async () => {
  const js = read("src/app.js") + "\n" + read("src/app2.js");
  const out = await minify(js, {
    ecma: 2020,
    compress: { passes: 2, unsafe_arrows: true },
    mangle: { toplevel: false },
    format: { comments: false },
  });
  if (out.error) throw out.error;

  // CSS vorsichtig verkleinern: nur Kommentare und Zeilenumbrüche.
  const css = read("src/shell.html").replace(/<style>([\s\S]*?)<\/style>/, (_m, body) =>
    "<style>" +
    body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s*\n\s*/g, "")
      .replace(/\s*([{}:;,>])\s*/g, "$1")
      .replace(/;}/g, "}") +
    "</style>"
  );

  const head = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Aktien, ETFs und Krypto einordnen: echter Kursverlauf, Guidance gegen Ist, Schwankungstreiber und historische Erholungsmuster.">
<meta name="color-scheme" content="light dark">
<style>html{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
`;

  const page = head + css + "\n<script>\n" + out.code + "\n</script>\n</body>\n</html>\n";
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/index.min.html"), page);
  console.log("dist/index.min.html:", page.length, "Zeichen");
})();
