# Local Mesh deployment

From a clean clone with Docker Compose: `docker compose up --build -d --wait`. Dashboard: http://127.0.0.1:4044/. It proxies the API on node A. Services: `mesh-node-a`, `mesh-node-b`, `mesh-node-c`, `mesh-node-d`, `bootstrap`, `dashboard`. Each Mesh node has a separate volume for its keys, peer state and payment journal. Docker's private bridge carries the TCP and libp2p links; only the dashboard host port is published. Run `node scripts/compose-smoke.mjs` for assertions against the real containers.

`docker compose stop mesh-node-b` demonstrates rerouting; `docker compose start mesh-node-b` restores it. `docker compose down` retains volume data; `docker compose down -v` erases identities and history. UI API key is held in browser `sessionStorage` for the tab.

For a shared sandbox, place distinct random `AIFP4_API_KEY` and `MESH_HMAC_SECRET` values in an untracked `.env` (at least 32 characters each; generate with `openssl rand -hex 32`). Add a **Devnet-only disposable and pre-funded** 64-byte keypair JSON as `SOLANA_PAYER_SECRET_JSON` to enable real SOL only on node C. Startup rejects public/demo credentials with a payer. Never commit `.env`, copy a production key, or use mainnet. SOL amounts are lamports and a valid Devnet recipient is required. The independent `npm run devnet:payment` proof is also available.

This topology is single-host, not a hardened Internet deployment. Peer ports use TOFU trust on first contact; the raw TCP adapter is not encrypted. For cross-host use, configure peer addresses, TLS/private networking, key enrollment, storage backup and monitoring first. See [SECURITY.md](../SECURITY.md).
