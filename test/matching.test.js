"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classify, isProductTitle, selectClosest, selectLowestPriceMatch } = require("../matching");

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

test("rejects generic retailer and challenge page titles", () => {
  assert.equal(isProductTitle("www.jumia.co.ke"), false);
  assert.equal(isProductTitle("Access Denied - Verify you are human"), false);
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
