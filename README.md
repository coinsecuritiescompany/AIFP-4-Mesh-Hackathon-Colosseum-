# AIFP-4 Mesh

**Offline-capable payment orchestration for autonomous AI agents.**

AIFP-4 Mesh lets an agent create a deterministic payment intent, enforce delegated spending policy, select the best available payment rail, queue safely when connectivity is unavailable, and return a verifiable settlement receipt.

This repository is the **Colosseum Crypto World's Fair MVP**. It includes a runnable local sandbox and a real Solana Devnet payment demo.

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

Check `curl http://127.0.0.1:4044/health`. To stop it, run `docker compose down`. The API listens on localhost by default. For a different host port or sandbox API key, set `AIFP4_PORT`, `AIFP4_BIND_HOST` or `AIFP4_API_KEY` in an untracked `.env` file before starting Compose. The default API key is for local demos only. This version has an in-memory store, so payment state resets when the container restarts. The Solana Devnet transaction demo remains a separate script and is not executed by Compose.

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

## Real sandbox payment on Solana Devnet

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
