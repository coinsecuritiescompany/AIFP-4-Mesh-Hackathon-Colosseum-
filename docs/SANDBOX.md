# Sandbox

Local sandbox:

```bash
npm install
cp .env.example .env
npm start
```

The API listens on port 4044 by default. Use `GET /health` for readiness, `POST /v1/intents` to create an intent, and `POST /v1/intents/{intentId}/execute` to settle through the mock sandbox rail.

Solana Devnet proof:

```bash
npm run devnet:payment
```

The Devnet script uses disposable accounts and test SOL only. It submits a payment plus an `AIFP4:<intentHash>` Memo in the same transaction and prints the Explorer URL.
