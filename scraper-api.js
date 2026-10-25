"use strict";

const SCRAPER_API_ENDPOINT = "https://api.scraperapi.com/";

function redactScraperApiKey(message, apiKey) {
  return String(message)
    .split(apiKey).join("[REDACTED]")
    .replace(/([?&]api_key=)[^&\s"'<>]*/gi, "$1[REDACTED]");
}

function buildScraperApiUrl(targetUrl, apiKey) {
  if (!apiKey) throw new Error("SCRAPER_API_KEY is required to build a ScraperAPI URL.");
  const endpoint = new URL(SCRAPER_API_ENDPOINT);
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("url", targetUrl);
  endpoint.searchParams.set("render", "true");
  return endpoint.toString();
}

async function gotoWithScraperApi(page, targetUrl, apiKey = process.env.SCRAPER_API_KEY) {
  if (!apiKey) return page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  let response;
  try {
    response = await page.context().request.get(buildScraperApiUrl(targetUrl, apiKey), { timeout: 30000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactScraperApiKey(message, apiKey));
  }
  if (!response.ok()) throw new Error(`ScraperAPI returned HTTP ${response.status()}`);
  const baseHref = targetUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const html = (await response.text()).replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
  await page.setContent(html, { waitUntil: "domcontentloaded" });
}

module.exports = { buildScraperApiUrl, gotoWithScraperApi, redactScraperApiKey };
