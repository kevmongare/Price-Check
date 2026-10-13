# Jumia competitor price check

## Weekly run on GitHub (published to a Pages dashboard)
1. Create a GitHub repo and upload everything in this folder (keep the `.github` folder).
2. Repo Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Put your SKUs in `skus.txt` (one per line), or paste them into the box when you run the workflow.
   Optional: fill `counts.csv` (sku,cancellation_count,cancellation_reason) to add cancellation volumes.
4. Actions tab > "Competitor price check" > **Run workflow**. It also runs every Monday 05:00 Nairobi time (edit or delete the `schedule` block in `.github/workflows/price-check.yml`).
5. After ~15-20 min the dashboard is live at https://<your-username>.github.io/<repo>/ . Click **Download Report (HTML)** for a self-contained file you can email.
   The run also keeps `results.csv` / `results.json` as a downloadable artifact on the run page.

Note: in a public repo, SKUs, counts.csv and results are public. Don't commit sensitive cancellation data there.
If the run fails with "runner is probably being blocked", the retailers are rejecting GitHub's servers; run locally instead.

## Local
`npm install`, `npx playwright install chromium`, then `node server.js` and open http://localhost:3000
(or `node batch.js` to generate site/ locally). `HEADLESS=0` shows the browser.
