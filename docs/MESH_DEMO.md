# Three-minute Colosseum demo

1. `docker compose up --build -d --wait`. Open http://127.0.0.1:4044/ and select **Mesh network**. It displays live signed advertisements, TCP/libp2p edges, peer health and relay events.
2. Select **Create payment** and keep the preloaded Research Agent, USDC, `ai-data-api`, 250 minor units. Create the intent, then press **Send through Mesh**. The detail shows A → B → C, TCP → libp2p, mock rail, receipt hash/signature and `VERIFIED`.
3. Run `docker compose stop mesh-node-b`. Refresh **Mesh network**; B's direct link becomes offline. Create and send a second payment. It uses A → D → C, libp2p → TCP. C's receipt returns to A.
4. Run `docker compose start mesh-node-b`. Refresh to see recovery. `docker compose down` stops the demo without deleting state.

For an automated, assertion-backed version after step 1, run `node scripts/compose-smoke.mjs`; it stops and restarts B itself. It only uses mock USDC, never Devnet funds. To queue while C is unavailable: `docker compose stop mesh-node-c`, create/execute an intent on A, observe `QUEUED_FOR_MESH`, then `docker compose start mesh-node-c` and wait for automatic reconciliation. Do not use `docker compose down -v` unless you intend to erase the local identities and payment history.
