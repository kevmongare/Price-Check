// Batch runner for GitHub Actions (or local): checks every SKU, then writes site/index.html (self-contained
// dashboard with the results embedded), site/results.json and site/results.csv.
// An explicit PRODUCTS_CSV wins; otherwise SKUS wins over an auto-detected products.csv and skus.txt.
// Optional counts.csv (sku,cancellation_count,cancellation_reason) adds cancellation volumes.
"use strict";
const fs = require("fs");
const path = require("path");
const { checkSku, checkWithPriceBaseline, closeBrowser } = require("./lib");
const { parseProductsCsv } = require("./product-csv");

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
  const configuredCsv = (process.env.PRODUCTS_CSV || "").trim();
  const defaultCsv = path.join(__dirname, "products.csv");
  const fromEnv = (process.env.SKUS || "").trim();
  const csvPath = configuredCsv ? path.resolve(__dirname, configuredCsv) : defaultCsv;
  let products, usesCsv = false;
  if (configuredCsv || (!fromEnv && fs.existsSync(defaultCsv))) {
    if (!fs.existsSync(csvPath)) throw new Error(`Products CSV not found: ${csvPath}`);
    products = parseProductsCsv(fs.readFileSync(csvPath, "utf8"));
    usesCsv = true;
  } else {
    const skus = splitList(fromEnv || (fs.existsSync("skus.txt") ? fs.readFileSync("skus.txt", "utf8") : ""));
    products = skus.map(sku => ({ sku, name: sku, unit_price: null }));
  }
  if (!products.length) { console.error("No products provided (products.csv, PRODUCTS_CSV, SKUS env var, or skus.txt)."); process.exit(1); }
  const counts = readCounts();
  console.log(`Checking ${products.length} product(s)${usesCsv ? ` from ${path.relative(__dirname, csvPath) || path.basename(csvPath)}` : ""}...`);

  const records = [];
  let failures = 0;
  for (const [i, product] of products.entries()) {
    console.log(`[${i + 1}/${products.length}] ${product.sku}: ${product.name}`);
    let rec;
    try {
      rec = usesCsv
        ? await checkWithPriceBaseline(product.sku, product.name, product.unit_price)
        : await checkSku(product.name);
    } catch (e) {
      rec = {
        sku: product.sku, search_term: product.name, product_name: usesCsv ? product.name : "",
        jumia_price: product.unit_price, baseline_price_source: usesCsv ? "Your unit price from products.csv; Jumia lookup skipped" : "",
        source_type: usesCsv ? "CSV baseline + live competitors" : "Live retrieved",
        retrieval_status: "Check failed: " + e.message, match_confidence: "Not found", checked_at: new Date().toISOString(),
      };
    }
    if (usesCsv ? (!rec.carrefour_price && !rec.kilimall_price) : !rec.product_name) failures++;
    const c = counts.get(product.sku.toLowerCase());
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

  const cols = ["sku", "search_term", "product_name", "jumia_price", "baseline_price_source", "carrefour_price", "kilimall_price", "cancellation_count", "cancellation_reason", "match_confidence", "source_type", "checked_at", "jumia_url", "carrefour_url", "kilimall_url", "retrieval_status"];
  fs.writeFileSync(path.join(out, "results.csv"), "\ufeff" + [cols.join(","), ...records.map(r => cols.map(c => csvEscape(r[c])).join(","))].join("\r\n"));

  // Self-contained dashboard: the results are embedded so the file works offline / when downloaded.
  let html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const embed = `<script id="preload">window.__PRELOAD__=${json.replace(/</g, "\\u003c")};</script>\n`;
  const marker = /<script>\r?\n\(function\(\)\{/;
  if (!marker.test(html)) throw new Error("Template marker not found in index.html");
  html = html.replace(marker, match => embed + match);
  fs.writeFileSync(path.join(out, "index.html"), html);

  console.log(`Wrote site/ (${records.length} records, ${failures} without ${usesCsv ? "a competitor listing" : "a Jumia listing"}).`);
  // If nearly everything failed, the sites are probably blocking the runner: fail loudly instead of publishing an empty dashboard.
  if (failures / products.length >= 0.8) { console.error(`Most search terms returned no ${usesCsv ? "competitor listings" : "Jumia listing"}: the runner is probably being blocked, or the page layout changed.`); process.exit(2); }
})().catch(async e => { console.error(e); await closeBrowser(); process.exit(1); });
