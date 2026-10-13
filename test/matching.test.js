"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classify, classifyQueryMatch, isProductTitle, searchVariants, selectClosest, selectLowestPriceMatch } = require("../matching");
const { buildScraperApiUrl } = require("../scraper-api");

test("selects the closest Jumia result for a product-name query", () => {
  const unrelated = { title: "Samsung Galaxy A55 protective case", url: "https://www.jumia.co.ke/case" };
  const closest = { title: "Samsung Galaxy A55 256GB 5G Smartphone", url: "https://www.jumia.co.ke/phone" };
  assert.equal(selectClosest("Samsung Galaxy A55 256GB", [unrelated, closest]), closest);
});

test("prefers a product URL containing an SKU query", () => {
  const first = { title: "Generic phone", url: "https://www.jumia.co.ke/generic" };
  const exact = { title: "Phone listing", url: "https://www.jumia.co.ke/item-ai234ha6251mgnafamz.html" };
  assert.equal(selectClosest("AI234HA6251MGNAFAMZ", [first, exact]), exact);
});

test("rejects generic, blocked, and empty-search page titles", () => {
  assert.equal(isProductTitle("www.jumia.co.ke"), false);
  assert.equal(isProductTitle("Access Denied - Verify you are human"), false);
  assert.equal(isProductTitle("There are no results for this search"), false);
  assert.equal(selectClosest("blender", [{ title: "www.jumia.co.ke", url: "https://www.jumia.co.ke" }]), null);
});

test("chooses the cheapest high-confidence equivalent, not an unrelated cheap item", () => {
  const expected = { title: "Samsung Galaxy A55 256GB 5G Smartphone", price: 54000, url: "https://carrefour.ke/a55-sale" };
  const candidates = [
    { title: "Samsung Galaxy A55 256GB 5G Smartphone", price: 59000 },
    expected,
    { title: "Samsung Galaxy A55 phone case", price: 500 },
  ];
  assert.equal(classify("Samsung Galaxy A55 256GB 5G Smartphone", expected), "High-confidence equivalent");
  assert.equal(selectLowestPriceMatch("Samsung Galaxy A55 256GB 5G Smartphone", candidates), expected);
});

test("keeps the closest unverified offer available for review", () => {
  const closest = { title: "Samsung Galaxy A55 5G Smartphone", price: 50000 };
  const unrelated = { title: "Protective phone case", price: 100 };
  assert.equal(selectLowestPriceMatch("Samsung Galaxy A55 256GB 5G Smartphone", [unrelated, closest]), closest);
});

test("tries shorter product-name searches without rewriting SKU queries", () => {
  const variants = searchVariants("Samsung Galaxy A55 256GB");
  assert.equal(variants[0], "Samsung Galaxy A55 256GB");
  assert.ok(variants.includes("samsung galaxy a55"));
  assert.deepEqual(searchVariants("AI234HA6251MGNAFAMZ"), ["AI234HA6251MGNAFAMZ"]);
});

test("keeps an accessory as a review-only result for a handset search", () => {
  assert.equal(classifyQueryMatch("Samsung Galaxy A55 256GB", { title: "Samsung Galaxy A55 protective case" }), "Possible match — review required");
  assert.equal(classifyQueryMatch("Samsung Galaxy A55 256GB", { title: "Samsung Galaxy A55 256GB 5G Smartphone" }), "High-confidence equivalent");
});

test("builds a rendered ScraperAPI request without altering the target URL", () => {
  const target = "https://www.jumia.co.ke/catalog/?q=Samsung+Galaxy+A55";
  const request = new URL(buildScraperApiUrl(target, "test-key"));
  assert.equal(request.hostname, "api.scraperapi.com");
  assert.equal(request.searchParams.get("api_key"), "test-key");
  assert.equal(request.searchParams.get("url"), target);
  assert.equal(request.searchParams.get("render"), "true");
  assert.throws(() => buildScraperApiUrl(target, ""), /SCRAPER_API_KEY/);
});
