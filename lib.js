// Shared retrieval + matching logic (used by server.js and batch.js).
"use strict";
const { chromium } = require("playwright");

const HEADLESS = process.env.HEADLESS !== "0"; // HEADLESS=0 to watch the browser
const NAV_TIMEOUT = 30000;

const PRICE_RE = /(?:KSh|KES|Ksh)\s*([\d,]+(?:\.\d+)?)/i;
const toNum = s => { const m = String(s || "").match(PRICE_RE); return m ? Number(m[1].replace(/,/g, "")) : null; };

// ---------- browser (shared, one context) ----------
let browser, context;
async function getContext() {
  if (!browser) {
    browser = await chromium.launch({ headless: HEADLESS });
    context = await browser.newContext({
      locale: "en-KE",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
    });
    // skip heavy assets
    await context.route("**/*", route => {
      const t = route.request().resourceType();
      return ["image", "media", "font"].includes(t) ? route.abort() : route.continue();
    });
  }
  return context;
}
async function withPage(fn) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  try { return await fn(page); } finally { await page.close().catch(() => {}); }
}

// ---------- generic listing extractor (runs in the page) ----------
// Finds anchors matching hrefPattern, climbs to the card container that holds a price, returns title/price/url.
function extractListings(hrefPattern, limit) {
  const re = new RegExp(hrefPattern, "i");
  const priceRe = /(?:KSh|KES|Ksh)\s*[\d,]+(?:\.\d+)?/i;
  const seen = new Set(), out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    if (!re.test(a.getAttribute("href"))) continue;
    const url = a.href;
    if (seen.has(url)) continue;
    let el = a, card = null;
    for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
      if (priceRe.test(el.innerText || "")) { card = el; break; }
    }
    if (!card) continue;
    const text = (card.innerText || "").split("\n").map(s => s.trim()).filter(Boolean);
    const priceLine = text.find(l => priceRe.test(l));
    const title = (a.getAttribute("title") || "").trim() ||
      text.filter(l => !priceRe.test(l) && l.length > 12).sort((x, y) => y.length - x.length)[0] || (a.innerText || "").trim();
    seen.add(url);
    out.push({ title, priceText: priceLine || "", url });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- Jumia: SKU -> product title/price/url ----------
async function jumiaLookup(sku) {
  return withPage(async page => {
    await page.goto("https://www.jumia.co.ke/catalog/?q=" + encodeURIComponent(sku), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article.prd a.core, h1", { timeout: 15000 }).catch(() => {});
    // Case A: search results page
    const first = await page.evaluate(() => {
      const a = document.querySelector("article.prd a.core");
      if (!a) return null;
      const name = a.querySelector(".name")?.textContent?.trim() || a.getAttribute("data-name") || "";
      const prc = a.querySelector(".prc")?.textContent?.trim() || "";
      return { title: name, priceText: prc, url: a.href };
    });
    if (first && first.title) return { ...first, price: toNum(first.priceText) };
    // Case B: Jumia redirected straight to a product page
    const prod = await page.evaluate(() => {
      const h1 = document.querySelector("h1")?.textContent?.trim();
      const prc = document.querySelector("span.-b.-ubpt, .-fs24.-b, [class*='-ubpt']")?.textContent?.trim() || "";
      return h1 ? { title: h1, priceText: prc, url: location.href } : null;
    });
    if (prod) return { ...prod, price: toNum(prod.priceText) };
    return null;
  });
}

// ---------- competitor search ----------
const SITES = {
  Carrefour: { url: q => "https://www.carrefour.ke/mafken/en/search?keyword=" + encodeURIComponent(q), href: "/p/|/mafken/en/.*/p/" },
  Kilimall:  { url: q => "https://www.kilimall.co.ke/new/commoditysearch?keyword=" + encodeURIComponent(q), href: "/listing/|/commodity/|/item/" },
};
async function searchSite(site, query) {
  const cfg = SITES[site];
  return withPage(async page => {
    await page.goto(cfg.url(query), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(extractListings, [cfg.href, 12]).catch(() => []);
    return { searchUrl: cfg.url(query), rows: rows.map(r => ({ ...r, price: toNum(r.priceText) })).filter(r => r.price > 0) };
  });
}

// ---------- matching ----------
const STOP = new Set(["the", "and", "for", "with", "of", "in", "a", "an", "new", "free", "delivery", "kenya", "best", "quality", "pcs", "pc"]);
function tokens(s) {
  return String(s || "").toLowerCase()
    .replace(/(\d)\s*(l|ltr|litres?|liters?)\b/g, "$1l")
    .replace(/(\d)\s*(w|watts?)\b/g, "$1w")
    .replace(/(\d)\s*(gb|tb|mah|inch|in|cm|mm|kg|g|ml)\b/g, "$1$2")
    .replace(/[^a-z0-9.\s]/g, " ").split(/\s+/).filter(t => t && !STOP.has(t));
}
const hasDigit = t => /\d/.test(t);
function score(jumiaTitle, candTitle) {
  const a = tokens(jumiaTitle), b = new Set(tokens(candTitle));
  if (!a.length || !b.size) return { s: 0, specsOk: false, brandOk: false };
  const hit = a.filter(t => b.has(t)).length;
  const s = hit / a.length;
  const specs = a.filter(hasDigit);
  const specsOk = specs.length === 0 ? false : specs.every(t => b.has(t));
  const brandOk = b.has(a[0]);
  return { s, specsOk, brandOk };
}
function classify(jumiaTitle, cand) {
  if (!cand) return "Not found";
  const { s, specsOk, brandOk } = score(jumiaTitle, cand.title);
  if (s >= 0.7 && specsOk && brandOk) return "High-confidence equivalent";
  if (s >= 0.45) return "Possible match — review required";
  return "Not comparable";
}
const RANK = { "High-confidence equivalent": 3, "Possible match — review required": 2, "Not comparable": 1, "Not found": 0 };

function queryFromTitle(title) {
  return tokens(title).slice(0, 8).join(" ");
}

async function bestCandidate(site, jumiaTitle) {
  const q = queryFromTitle(jumiaTitle);
  let res = await searchSite(site, q);
  if (!res.rows.length) res = await searchSite(site, tokens(jumiaTitle).slice(0, 5).join(" ")); // broader retry
  let best = null, bs = -1;
  for (const r of res.rows) {
    const sc = score(jumiaTitle, r.title);
    const v = sc.s + (sc.specsOk ? 0.2 : 0) + (sc.brandOk ? 0.1 : 0);
    if (v > bs) { bs = v; best = r; }
  }
  return { best, searchUrl: res.searchUrl, candidates: res.rows.length };
}

// ---------- full check for one SKU ----------
async function checkSku(sku) {
  const out = {
    sku, product_name: "", jumia_price: null, jumia_url: "",
    carrefour_price: null, carrefour_url: "", kilimall_price: null, kilimall_url: "",
    match_confidence: "Not found", source_type: "Live retrieved",
    checked_at: new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }),
    retrieval_status: "", notes: [],
  };
  let j;
  try { j = await jumiaLookup(sku); } catch (e) { out.retrieval_status = "Jumia lookup failed: " + e.message; return out; }
  if (!j) { out.retrieval_status = "SKU not found on Jumia (no results, or page blocked/changed)"; return out; }
  out.product_name = j.title; out.jumia_price = j.price; out.jumia_url = j.url;

  const results = await Promise.all(Object.keys(SITES).map(async site => {
    try { return [site, await bestCandidate(site, j.title)]; }
    catch (e) { return [site, { error: e.message }]; }
  }));
  let bestRank = 0, bestLabel = "Not found";
  for (const [site, r] of results) {
    const key = site.toLowerCase();
    if (r.error) { out.notes.push(`${site}: failed (${r.error.slice(0, 60)})`); continue; }
    if (!r.best) { out.notes.push(`${site}: no results`); continue; }
    const label = classify(j.title, r.best);
    out[key + "_url"] = r.best.url;
    if (label === "High-confidence equivalent") out[key + "_price"] = r.best.price; // only trusted prices feed the comparison
    else out.notes.push(`${site}: ${label} — "${r.best.title.slice(0, 60)}" KSh ${r.best.price} (not used in comparison)`);
    if (RANK[label] > bestRank) { bestRank = RANK[label]; bestLabel = label; }
  }
  out.match_confidence = bestLabel;
  out.retrieval_status = "Auto-retrieved. " + out.notes.join(" | ");
  return out;
}

async function closeBrowser() { if (browser) { await browser.close().catch(() => {}); browser = null; } }
module.exports = { checkSku, closeBrowser };
