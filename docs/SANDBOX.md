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

The demo generates disposable Devnet wallets, requests test SOL, transfers 0.001 SOL and records `AIFP4:<intentHash>` in the Solana Memo program.

Public Devnet faucets are rate-limited and may return transient errors. The GitHub Devnet smoke workflow is manual so faucet instability does not make normal CI red.
