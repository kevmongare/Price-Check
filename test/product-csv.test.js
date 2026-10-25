"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseProductsCsv } = require("../product-csv");

test("parses product CSV rows with quoted commas and currency-formatted prices", () => {
  assert.deepEqual(parseProductsCsv(
    '\ufeffsku,name,unit_price\r\n' +
    'ABC-1,"A kettle, stainless steel","KES 4,500"\r\n' +
    'ABC-2,Blender,"KSh 2,199.50"\r\n'
  ), [
    { sku: "ABC-1", name: "A kettle, stainless steel", unit_price: 4500 },
    { sku: "ABC-2", name: "Blender", unit_price: 2199.5 },
  ]);
});

test("accepts product_name and our_unit_price aliases", () => {
  assert.deepEqual(parseProductsCsv("sku,product_name,our_unit_price\nA1,Kettle,1500\n"), [
    { sku: "A1", name: "Kettle", unit_price: 1500 },
  ]);
});

test("rejects missing headers, invalid prices, duplicate SKUs, and malformed CSV", () => {
  assert.throws(() => parseProductsCsv("sku,name\nA1,Kettle\n"), /must include/);
  assert.throws(() => parseProductsCsv("sku,name,unit_price\nA1,Kettle,0\n"), /positive unit price/);
  assert.throws(() => parseProductsCsv("sku,name,unit_price\nA1,Kettle,100\nA1,Blender,200\n"), /duplicate SKU/);
  assert.throws(() => parseProductsCsv("sku,name,unit_price\nA1,Kettle,KSh 2,199\n"), /Quote fields that contain commas/);
  assert.throws(() => parseProductsCsv('sku,name,unit_price\nA1,"Kettle,100\n'), /unterminated quoted field/);
});
