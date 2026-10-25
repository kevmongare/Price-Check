# Jumia competitor price check

## Weekly run on GitHub (published to a Pages dashboard)
1. Create a GitHub repo and upload everything in this folder (keep the `.github` folder).
2. Repo Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. To use your own prices as the Jumia baseline, add `products.csv` with the columns `sku,name,unit_price` (one product per row). The product name is searched on Carrefour and Kilimall, your unit price is used as the Jumia baseline, and the Jumia lookup is skipped. You can enter another repository-relative CSV path in the workflow's `products_csv` input. Otherwise, product names or SKUs in `skus.txt` (one per line) or the workflow's `skus` input keep the existing Jumia lookup behavior.
   Optional: fill `counts.csv` (sku,cancellation_count,cancellation_reason) to add cancellation volumes.
4. Actions tab > "Competitor price check" > **Run workflow**. It also runs every Monday 05:00 Nairobi time (edit or delete the `schedule` block in `.github/workflows/price-check.yml`).
5. After ~15-20 min the dashboard is live at https://<your-username>.github.io/<repo>/ . Click **Download Report (HTML)** for a self-contained file you can email.
   The run also keeps `results.csv` / `results.json` as a downloadable artifact on the run page.

Example `products.csv`:
```csv
sku,name,unit_price
EXAMPLE-001,"Example product, model 1",1000
```
The unit price appears in the output's `jumia_price` field for comparison and is identified as your CSV baseline in the dashboard and `baseline_price_source` field. Each row needs a unique SKU, a product name, and a positive unit price. `product_name` can be used instead of `name`.

Note: in a public repo, product names, unit prices, SKUs, counts.csv and results are public. Don't commit sensitive pricing or cancellation data there.
Before hosted runs, add your ScraperAPI key as the repository Actions secret `SCRAPER_API_KEY` (Settings > Secrets and variables > Actions). The key is never stored in the source files; ScraperAPI usage limits or billing apply.
If the run fails with "runner is probably being blocked", the retailers are rejecting GitHub's servers; run locally instead.

## Local
`npm install`, `npx playwright install chromium`, then `node server.js` and open http://localhost:3000
(or `node batch.js` to generate `site/` locally). For the batch runner, an explicit `PRODUCTS_CSV` path wins; otherwise `SKUS` takes precedence over an automatically detected `products.csv`, followed by `skus.txt`. `HEADLESS=0` shows the browser.
