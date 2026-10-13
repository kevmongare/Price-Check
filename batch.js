// Batch runner for GitHub Actions (or local): checks every SKU, then writes site/index.html (self-contained
// dashboard with the results embedded), site/results.json and site/results.csv.
// SKUs come from the SKUS env var (comma/newline separated) or skus.txt.
// Optional counts.csv (sku,cancellation_count,cancellation_reason) adds cancellation volumes.
"use strict";
const fs = require("fs");
const path = require("path");
const { checkSku, closeBrowser } = require("./lib");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const splitList = t => [...new Set(String(t || "").split(/[\n\r,;\t]+/).map(s => s.trim()).filter(Boolean))];

function readCounts() {
  const f = path.join(__dirname, "counts.csv");
  if (!fs.existsSync(f)) return new Map();
  const lines = fs.readFileSync(f, "utf8").replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(",").map(h => h.trim().toLowerCase());
  const m = new Map();
  for (const l of lines) {
    const c = l.split(",");
    const o = {}; head.forEach((h, i) => o[h] = (c[i] || "").trim());
    if (o.sku) m.set(o.sku.toLowerCase(), o);
  }
  return m;
}

const csvEscape = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

(async () => {
  const fromEnv = (process.env.SKUS || "").trim();
  const skus = splitList(fromEnv || (fs.existsSync("skus.txt") ? fs.readFileSync("skus.txt", "utf8") : ""));
  if (!skus.length) { console.error("No SKUs provided (SKUS env var or skus.txt)."); process.exit(1); }
  const counts = readCounts();
  console.log(`Checking ${skus.length} SKU(s)...`);

  const records = [];
  let failures = 0;
  for (const [i, sku] of skus.entries()) {
    console.log(`[${i + 1}/${skus.length}] ${sku}`);
    let rec;
    try { rec = await checkSku(sku); }
    catch (e) { rec = { sku, source_type: "Live retrieved", retrieval_status: "Check failed: " + e.message, match_confidence: "Not found", checked_at: new Date().toISOString() }; }
    if (!rec.product_name) failures++;
    const c = counts.get(sku.toLowerCase());
    if (c) { rec.cancellation_count = c.cancellation_count; rec.cancellation_reason = c.cancellation_reason; }
    delete rec.notes;
    records.push(rec);
    console.log("   ->", rec.product_name ? `${rec.product_name.slice(0, 50)} | ${rec.match_confidence}` : rec.retrieval_status);
    await sleep(2000 + Math.random() * 2500); // be polite
  }
  await closeBrowser();

  const out = path.join(__dirname, "site");
  fs.mkdirSync(out, { recursive: true });
  const payload = { generated_at: new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) + " (EAT)", records };
  const json = JSON.stringify(payload);
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(payload, null, 1));

  const cols = ["sku", "product_name", "jumia_price", "carrefour_price", "kilimall_price", "cancellation_count", "cancellation_reason", "match_confidence", "source_type", "checked_at", "jumia_url", "carrefour_url", "kilimall_url", "retrieval_status"];
  fs.writeFileSync(path.join(out, "results.csv"), "\ufeff" + [cols.join(","), ...records.map(r => cols.map(c => csvEscape(r[c])).join(","))].join("\r\n"));

  // Self-contained dashboard: the results are embedded so the file works offline / when downloaded.
  let html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const embed = `<script id="preload">window.__PRELOAD__=${json.replace(/</g, "\\u003c")};</script>\n`;
  const marker = "<script>\n(function(){";
  if (!html.includes(marker)) throw new Error("Template marker not found in index.html");
  html = html.replace(marker, embed + marker);
  fs.writeFileSync(path.join(out, "index.html"), html);

  console.log(`Wrote site/ (${records.length} records, ${failures} without a Jumia listing).`);
  // If nearly everything failed, the sites are probably blocking the runner: fail loudly instead of publishing an empty dashboard.
  if (failures / skus.length >= 0.8) { console.error("Most SKUs returned no Jumia listing: the runner is probably being blocked, or the page layout changed."); process.exit(2); }
})().catch(async e => { console.error(e); await closeBrowser(); process.exit(1); });
