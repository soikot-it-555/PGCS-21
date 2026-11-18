// Builds a Tailwind stylesheet locally (v4 engine, only for the test browser — the site itself uses the Tailwind Play CDN)
// so that layout-dependent behaviour (fixed sidebar, modals, hidden classes) is exercised for real.
const fs = require("fs"), path = require("path");
module.exports = async function buildTailwind(root) {
  const nm = "/opt/npm-tools/node_modules/";
  const { compile } = await import("file://" + nm + "tailwindcss/dist/lib.mjs");
  const compiler = await compile('@import "tailwindcss";', { base: nm + "tailwindcss", loadStylesheet: async (id, base) => {
    const p = id.startsWith(".") ? path.resolve(base, id) : path.resolve(nm, id === "tailwindcss" ? "tailwindcss/index.css" : id);
    return { path: p, base: path.dirname(p), content: fs.readFileSync(p, "utf8") }; } });
  const toks = new Set();
  for (const f of ["index.html", "app.js", "admin-ext.js", "finance.js", "assets.js"]) {
    const s = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of s.matchAll(/[^\s"'`<>={}()]+/g)) toks.add(m[0]);
    for (const m of s.matchAll(/[\w\-:\/\.\[\]&>%#]+/g)) toks.add(m[0]);
  }
  return compiler.build([...toks]) + "\n*,::before,::after{border-color:#e5e7eb}";
};
