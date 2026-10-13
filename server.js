// Local backend. Run:  npm install && npx playwright install chromium && node server.js
// Then open http://localhost:3000
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { checkSku, closeBrowser } = require("./lib");
const PORT = process.env.PORT || 3000;

// ---------- tiny HTTP server ----------
let queue = Promise.resolve(); // serialise checks to be polite to the sites
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/api/health") { res.setHeader("content-type", "application/json"); return res.end('{"ok":true}'); }
  if (u.pathname === "/api/check") {
    const sku = (u.searchParams.get("sku") || "").trim();
    if (!sku) { res.statusCode = 400; return res.end('{"error":"sku required"}'); }
    queue = queue.then(() => checkSku(sku)).then(r => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(r)); })
      .catch(e => { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); });
    return;
  }
  if (u.pathname === "/" || u.pathname === "/index.html") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  }
  res.statusCode = 404; res.end("Not found");
});
server.listen(PORT, () => console.log(`Price checker running → http://localhost:${PORT}`));
process.on("SIGINT", async () => { await closeBrowser(); process.exit(0); });
