# Sandbox Runbook

## Local API

```bash
npm install
cp .env.example .env
set -a; source .env; set +a
npm test
npm start
```

Health check:

```bash
curl http://127.0.0.1:4044/health
```

Create an intent with `POST /v1/intents`, then execute it with `POST /v1/intents/{intentId}/execute`.

## Solana Devnet

```bash
npm run devnet:payment
```

Default mode generates disposable Devnet wallets, requests test SOL, transfers 0.001 SOL and records `AIFP4:<intentHash>` in the Solana Memo program.

Public Devnet faucets are rate-limited. For deterministic demos, set `SOLANA_PAYER_SECRET_JSON` locally to a pre-funded **Devnet-only** 64-byte keypair JSON array. Never commit it and never use a production/mainnet key for this demo.

The GitHub Devnet smoke workflow is manual so public-faucet instability does not make normal CI red.
