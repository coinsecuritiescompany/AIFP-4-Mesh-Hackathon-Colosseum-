# AIFP-4 Mesh 0.3.1 — local MVP verification

Verified on 2026-10-06 with Node.js 24.19.0. Base revision: `b53f50f669ee156a786c16caa9b4d4317a815f4b`.

## Evidence

- `npm ci`: clean dependency installation completed.
- `npm run ci`: syntax check and **92 tests passed**, zero failures/skips.
- `npm run demo:smoke`: isolated four-process network passed explicit dispatch, A→B→C across TCP/libp2p, B crash with A→D→C rerouting, queued payment surviving origin crash, C recovery, and one settlement after duplicate execution.
- `npm start`: local launcher reached READY with four independent processes on the default port 4044. Random local credentials were generated; loopback API calls bypass HTTP proxies.
- `npm audit --audit-level=high`: zero vulnerabilities, including development dependencies.
- UI DOM test runs the real dashboard script against the HTTP API: loading, create intent, execute, receipt rendering, background refresh, and preserving typed forms. This is DOM-based verification, not an installed Chromium visual test.
- Solana adapter contract tests build real transfer/memo instructions against an injected RPC client. They verify confirmation gating, failed transaction handling, and one send when confirmation is unknown. These are not on-chain evidence.

## Changes

- `npm start` runs the whole local network without Docker; `npm run sandbox` preserves the single-node sandbox.
- `stop/start b|c`, `status`, and `quit` support a repeatable video demonstration.
- Mesh intent creation waits for explicit Execute before dispatch.
- Dashboard refreshes status/topology every three seconds while preserving forms.
- Default HTTP, TCP, and libp2p binds are loopback. Public HTTP binding requires non-demo credentials; Compose generates credentials with `npm run demo:configure`.
- Settlement state, receipt and transaction persist together, with rollback on failed persistence. Unknown rail outcomes remain locked against replay.
- Signed receipts must match the intended asset and amount.
- Static assets resolve relative to the module; invalid transport-toggle input receives 422.

## Unverified boundaries

Docker is not installed in the execution workspace. Compose build/start and Docker smoke were not executed here; CI includes those checks. Chromium installation was blocked by the download environment, so no visual browser pass is claimed.

No funded disposable Devnet payer was provided and no real Solana transaction was executed. Optional Devnet execution remains available via node C. Before recording an on-chain demo, fund a disposable Devnet wallet and inspect the returned confirmed Explorer transaction. Mock USDC has no on-chain value and must not be presented as Solana USDC settlement.

The release is a local software MVP, not approval to operate a production payment service. Secure peer enrollment, distributed spend budgets, settlement failover/consensus, long-duration outage validation, retention/compaction under sustained load, and independent security review remain open. Physical radio/satellite links, BPv7/BPSec/COSE, and fiat/card provider execution remain absent. See the existing implementation matrix and threat model.
