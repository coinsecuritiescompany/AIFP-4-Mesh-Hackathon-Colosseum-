# AIFP-4 Mesh

**Offline-capable payment orchestration for autonomous AI agents.**

AIFP-4 Mesh lets an agent create a deterministic payment intent, enforce delegated spending policy, select the best available payment rail, queue safely when connectivity is unavailable, and return a verifiable settlement receipt.

This repository is the **Colosseum Crypto World's Fair MVP**. It includes a connected web dashboard, persistent mock sandbox API, and a separate real Solana Devnet proof script.

## Why it exists

AI agents need payment infrastructure that can survive intermittent connectivity, enforce owner-defined limits, avoid duplicate execution, and produce machine-verifiable evidence of what was authorized and what actually settled.

AIFP-4 Mesh separates those concerns:

`Agent -> Intent -> Policy -> Mesh Router -> Rail Adapter -> Receipt`

## MVP today

- deterministic, idempotent payment intents;
- delegated spending-policy checks;
- fee/latency-aware route ranking;
- offline queue + reconciliation;
- sandbox mock settlement for fast demos and CI;
- Solana Devnet payment proof using modern `@solana/kit`;
- Solana Memo binding: `AIFP4:<intentHash>`;
- OpenAPI 3.1 spec;
- Node 22 test suite and GitHub Actions CI;
- zero committed secrets.

## Quick start

From a clean clone with Docker Engine and Compose installed, start the sandbox API with one command:

```bash
docker compose up --build -d
```

Open **http://127.0.0.1:4044/** for the UI, or check `curl http://127.0.0.1:4044/health`. To stop it, run `docker compose down`. The named Docker volume retains sandbox payment history; `docker compose down -v` removes that volume. The API listens on localhost by default. For a different host port or sandbox API key, set `AIFP4_PORT`, `AIFP4_BIND_HOST` or `AIFP4_API_KEY` in an untracked `.env` file before starting Compose. The default API key is for local demos only. Enter the configured API key in the UI if you changed the default. The key is stored only in the browser tab. Mock USDC payment and offline reconciliation work inside Compose; a pre-funded disposable Devnet payer can enable real SOL payments from the UI. Without one, SOL intents stay queued. The standalone Devnet proof script remains available.

Run without Docker:

```bash
npm ci
npm test
npm start
```

Default sandbox header:

```text
x-aifp4-api-key: sandbox-demo-key
```

Create an intent:

```bash
curl -s http://127.0.0.1:4044/v1/intents \
  -H 'content-type: application/json' \
  -H 'x-aifp4-api-key: sandbox-demo-key' \
  -d '{"idempotencyKey":"demo-001","agentId":"agent_demo","beneficiary":"merchant_demo","amountMinor":2500,"asset":"USDC","purpose":"Paid API request"}'
```

Execute it using the returned `id`:

```bash
curl -s -X POST http://127.0.0.1:4044/v1/intents/INTENT_ID/execute \
  -H 'x-aifp4-api-key: sandbox-demo-key'
```

## Web demo

Open the dashboard → create a Research Agent or use the preloaded one → create a USDC intent → inspect policy and route scores → execute → inspect the receipt. For offline mode, turn off the mock rail under **Mesh router**, create another USDC intent, restore the rail and reconcile. The backend persists state in a Docker volume.

## Real sandbox payment on Solana Devnet

To enable the optional SOL route in Compose, put a **Devnet-only**, pre-funded 64-byte keypair JSON array in `SOLANA_PAYER_SECRET_JSON` in your local untracked `.env`. Set unique `AIFP4_API_KEY` and `MESH_HMAC_SECRET` values of at least 32 characters each; the server refuses to start with demo credentials when the payer is configured. Generate each with `openssl rand -hex 32`. Recreate the container with `docker compose up --build -d`. Select SOL in the UI, enter a Devnet recipient address and an amount in **lamports** (1,000,000 lamports = 0.001 SOL). The backend sends SOL and `AIFP4:<intentHash>` in the same transaction and creates a receipt only after Devnet confirmation. If confirmation is uncertain, the intent stays in `executing` and must be inspected before retrying. No mainnet mode is supported.

The standalone proof script is still available:

```bash
npm run devnet:payment
```

The script creates disposable wallets, requests Devnet SOL, sends 0.001 SOL, and writes the AIFP-4 intent hash to the Memo program in the same transaction. It prints a Solana Explorer link when the transaction is submitted.

## Repository map

```text
src/                 core intent, policy, routing, state and API code
scripts/             syntax checks + Solana Devnet payment demo
tests/               policy, routing, idempotency and offline queue tests
openapi/              sandbox API contract
docs/                 architecture, sandbox runbook and Colosseum disclosure
legacy/               pre-existing AIFP-4 material, clearly separated from hackathon work
.github/workflows/    CI
```

## Security boundary

This is a hackathon/sandbox MVP. Do not use it for production custody or production payment credentials. Production deployment requires hardened authentication, asymmetric/KMS-backed signing, persistent storage, rate limiting, audit logging, rail-specific reconciliation, monitoring and external security review.

## Pre-existing work disclosure

AIFP-4 protocol research existed before this competition. The new Mesh implementation and Solana sandbox flow are hackathon-period work. See [`docs/COLOSSEUM_DISCLOSURE.md`](docs/COLOSSEUM_DISCLOSURE.md).

## Status

`v0.1.0-mvp` — sandbox-ready, not production-ready.
