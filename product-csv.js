"use strict";

function parseRows(text) {
  const input = String(text || "").replace(/^\ufeff/, "");
  const rows = [];
  let row = [], field = "", quoted = false, afterQuote = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (afterQuote && char !== "," && char !== "\r" && char !== "\n" && !/\s/.test(char)) {
      throw new Error("Unexpected character after a quoted CSV field.");
    } else if (char === '"') {
      if (field.length) throw new Error("Unexpected quote in an unquoted CSV field.");
      quoted = true;
    } else if (char === ",") {
      row.push(field.trim());
      field = "";
      afterQuote = false;
    } else if (char === "\r" || char === "\n") {
      row.push(field.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
      if (char === "\r" && input[i + 1] === "\n") i++;
    } else if (!afterQuote) {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some(value => value !== "")) rows.push(row);
  }
  return rows;
}

function parseProductsCsv(text) {
  const rows = parseRows(text);
  if (!rows.length) throw new Error("Products CSV is empty.");
  const headers = rows.shift().map(header => header.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const column = (...names) => names.map(name => headerIndex.get(name)).find(index => index !== undefined);
  const skuColumn = column("sku");
  const nameColumn = column("name", "product_name", "search_term");
  const priceColumn = column("unit_price", "our_unit_price", "jumia_price");
  if (skuColumn === undefined || nameColumn === undefined || priceColumn === undefined) {
    throw new Error("Products CSV must include sku, name (or product_name), and unit_price columns.");
  }

  const seen = new Set();
  return rows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new Error(`Products CSV row ${rowNumber} has ${values.length} columns; expected ${headers.length}. Quote fields that contain commas.`);
    }
    const sku = values[skuColumn] || "";
    const name = values[nameColumn] || "";
    const rawPrice = values[priceColumn] || "";
    const priceText = rawPrice.replace(/^(?:KSh|KES)\s*/i, "").replace(/,/g, "").trim();
    const unitPrice = Number(priceText);

    if (!sku || !name || !priceText || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error(`Products CSV row ${rowNumber} must have a SKU, product name, and positive unit price.`);
    }
    const key = sku.toLowerCase();
    if (seen.has(key)) throw new Error(`Products CSV contains duplicate SKU "${sku}" on row ${rowNumber}.`);
    seen.add(key);
    return { sku, name, unit_price: unitPrice };
  });
}

module.exports = { parseProductsCsv };
