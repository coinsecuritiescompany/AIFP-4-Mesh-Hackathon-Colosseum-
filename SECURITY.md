# Security boundaries

AIFP-4 Mesh is a local hackathon sandbox, not a production payment system. The default API key and HMAC secret are public demo values. Compose binds to `127.0.0.1` by default. For any shared deployment, set separate random `AIFP4_API_KEY` and `MESH_HMAC_SECRET` values of at least 32 characters and use TLS in front of the service. Devnet and public binding refuse demo credentials. Never use a mainnet keypair here.

The API has a 64 KiB JSON body limit, per-IP in-memory request limit (300 requests/minute), constant-time API key comparison, no permissive CORS, request IDs, restricted static files and browser security headers. Intents are hashed and authenticated with a sandbox HMAC. They are rechecked against current agent policy and daily spending at execution. An in-flight execution reserves its amount, and an uncertain rail result remains locked for manual inspection. On-disk state is written with owner-only file permissions and ignored by Git.

These controls have limits: API keys are shared and stored in the browser tab; they do not identify individual agents. Agent passports and delegated authority are simulated. The JSON store and limiter are single-process and should not be scaled to multiple replicas. There is no external identity service, tamper-evident audit log, managed key custody, distributed transaction lock, or independent Solana settlement reconciliation. A compromised host or API key can still control the sandbox; rotate the key and inspect the payer if compromise is suspected. Never expose a funded Devnet payer through an untrusted public deployment.

Production fiat/card settlement must go through appropriate licensed providers. This repository does not establish any regulatory status for AiFinPay. Obtain payment counsel before a production launch; this is not legal advice.

Please report security issues privately to the AiFinPay team rather than publishing exploit details in a public issue.
