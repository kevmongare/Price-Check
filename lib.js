// Shared retrieval + matching logic (used by server.js and batch.js).
"use strict";
const { chromium } = require("playwright");
const { classify, classifyQueryMatch, isProductTitle, searchVariants, selectClosest, selectLowestPriceMatch, tokens } = require("./matching");
const { gotoWithScraperApi } = require("./scraper-api");

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

// ---------- Jumia: product name or SKU -> closest product title/price/url ----------
async function jumiaLookup(searchTerm) {
  return withPage(async page => {
    let closest = null, closestConfidence = "Not found", closestRank = 0;
    const confidenceRank = { "Exact match": 4, "High-confidence equivalent": 3, "Possible match — review required": 2, "Not comparable": 1, "Not found": 0 };
    for (const query of searchVariants(searchTerm)) {
      const targetUrl = "https://www.jumia.co.ke/catalog/?q=" + encodeURIComponent(query);
      await gotoWithScraperApi(page, targetUrl);
      await page.waitForSelector("article.prd a.core, h1", { timeout: 15000 }).catch(() => {});
      const results = await page.evaluate(() => Array.from(document.querySelectorAll("article.prd a.core")).map(a => {
        const title = a.querySelector(".name")?.textContent?.trim() || a.getAttribute("data-name") || "";
        const priceText = a.querySelector(".prc")?.textContent?.trim() || "";
        return { title, priceText, url: a.href };
      }).filter(result => result.title));
      const candidate = selectClosest(searchTerm, results.filter(result => isProductTitle(result.title)));
      if (candidate) {
        const confidence = classifyQueryMatch(searchTerm, candidate);
        const rank = confidenceRank[confidence] || 0;
        if (rank > closestRank) { closest = candidate; closestConfidence = confidence; closestRank = rank; }
        if (confidence === "Exact match" || confidence === "High-confidence equivalent") break;
      }

      const productPage = await page.evaluate(() => {
        if (document.querySelector("article.prd a.core")) return null;
        const title = document.querySelector("h1")?.textContent?.trim() || "";
        const priceText = document.querySelector("span.-b.-ubpt, .-fs24.-b, [class*='-ubpt']")?.textContent?.trim() || "";
        const url = document.querySelector('link[rel="canonical"]')?.href || location.href;
        return title ? { title, priceText, url } : null;
      });
      if (productPage && isProductTitle(productPage.title)) {
        const confidence = classifyQueryMatch(searchTerm, productPage);
        const rank = confidenceRank[confidence] || 0;
        if (rank > closestRank) { closest = productPage; closestConfidence = confidence; closestRank = rank; }
        if (confidence === "Exact match" || confidence === "High-confidence equivalent") break;
      }
    }
    return closest ? { ...closest, price: toNum(closest.priceText), query_match_confidence: closestConfidence } : null;
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
    await gotoWithScraperApi(page, cfg.url(query));
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(extractListings, [cfg.href, 12]).catch(() => []);
    return { searchUrl: cfg.url(query), rows: rows.map(r => ({ ...r, price: toNum(r.priceText) })).filter(r => r.price > 0) };
  });
}

const RANK = { "High-confidence equivalent": 3, "Possible match — review required": 2, "Not comparable": 1, "Not found": 0 };

function queryFromTitle(title) {
  return tokens(title).slice(0, 8).join(" ");
}

async function bestCandidate(site, jumiaTitle) {
  const q = queryFromTitle(jumiaTitle);
  let res = await searchSite(site, q);
  if (!res.rows.length) res = await searchSite(site, tokens(jumiaTitle).slice(0, 5).join(" ")); // broader retry
  const best = selectLowestPriceMatch(jumiaTitle, res.rows);
  return { best, searchUrl: res.searchUrl, candidates: res.rows.length };
}

async function retrieveCompetitors(productTitle, out) {
  const results = await Promise.all(Object.keys(SITES).map(async site => {
    try { return [site, await bestCandidate(site, productTitle)]; }
    catch (e) { return [site, { error: e.message }]; }
  }));
  let bestRank = 0, bestLabel = "Not found";
  for (const [site, r] of results) {
    const key = site.toLowerCase();
    if (r.error) { out.notes.push(`${site}: failed (${r.error.slice(0, 60)})`); continue; }
    if (!r.best) { out.notes.push(`${site}: no results`); continue; }
    const label = classify(productTitle, r.best);
    out[key + "_url"] = r.best.url;
    if (label === "High-confidence equivalent") out[key + "_price"] = r.best.price;
    else out.notes.push(`${site}: ${label} — "${r.best.title.slice(0, 60)}" KSh ${r.best.price} (not used in comparison)`);
    if (RANK[label] > bestRank) { bestRank = RANK[label]; bestLabel = label; }
  }
  out.match_confidence = bestLabel;
}

async function checkWithPriceBaseline(sku, productName, unitPrice) {
  const out = {
    sku, search_term: productName, product_name: productName, jumia_price: unitPrice, jumia_url: "",
    baseline_price_source: "Your unit price from products.csv; Jumia lookup skipped",
    carrefour_price: null, carrefour_url: "", kilimall_price: null, kilimall_url: "",
    match_confidence: "Not found", source_type: "CSV baseline + live competitors",
    checked_at: new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }),
    retrieval_status: "", notes: [],
  };
  await retrieveCompetitors(productName, out);
  out.retrieval_status = "CSV unit price used as the Jumia baseline; Jumia lookup skipped. " + out.notes.join(" | ");
  return out;
}

// ---------- full check for one SKU ----------
async function checkSku(sku) {
  const out = {
    sku, search_term: sku, product_name: "", jumia_price: null, jumia_url: "",
    carrefour_price: null, carrefour_url: "", kilimall_price: null, kilimall_url: "",
    match_confidence: "Not found", source_type: "Live retrieved",
    checked_at: new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }),
    retrieval_status: "", notes: [],
  };
  let j;
  try { j = await jumiaLookup(sku); } catch (e) { out.retrieval_status = "Jumia lookup failed: " + e.message; return out; }
  if (!j) { out.retrieval_status = "SKU not found on Jumia (no results, or page blocked/changed)"; return out; }
  out.product_name = j.title; out.jumia_price = j.price; out.jumia_url = j.url;
  out.query_match_confidence = j.query_match_confidence;
  if (j.query_match_confidence !== "Exact match" && j.query_match_confidence !== "High-confidence equivalent") {
    out.match_confidence = j.query_match_confidence;
    out.retrieval_status = `Closest Jumia result requires review: ${j.title}. Competitor prices were not compared.`;
    return out;
  }

  await retrieveCompetitors(j.title, out);
  out.retrieval_status = "Auto-retrieved. " + out.notes.join(" | ");
  return out;
}

async function closeBrowser() { if (browser) { await browser.close().catch(() => {}); browser = null; } }
module.exports = { checkSku, checkWithPriceBaseline, closeBrowser };
