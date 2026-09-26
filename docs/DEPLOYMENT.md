# Deployment

From a clean clone: `docker compose up --build -d`. Open http://127.0.0.1:4044/ for the web UI. The same container serves the API and frontend. The named `mesh-data` volume preserves agents, policies, intents, receipts and transactions across restarts. Set `AIFP4_API_KEY` and `MESH_HMAC_SECRET` in an untracked `.env` for a shared sandbox. The UI requests the key and keeps it in sessionStorage for the current browser tab.

`docker compose down` stops the container; `docker compose down -v` also removes demo data. `npm run devnet:payment` remains a separate Devnet proof, not a payment action in the UI. Do not use this sandbox as a production payment system.
