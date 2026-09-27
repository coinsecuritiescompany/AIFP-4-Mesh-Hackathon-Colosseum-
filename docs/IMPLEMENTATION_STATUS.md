# Implementation status

This table reports observed behavior. `IMPLEMENTED_NOT_HARDWARE_VERIFIED` is reserved for an adapter with working software contract tests but no physical link proof. A design or simulator alone remains `ARCHITECTURAL_EXTENSION_POINT`.

| Capability | Status | Evidence | Commit SHA | Test | External dependency / limitation |
| --- | --- | --- | --- | --- | --- |
| TCP multi-hop | IMPLEMENTED_AND_TESTED | Independent processes A→B→C | `920d551` | `mesh-integration.test.mjs`, Compose smoke | Private Compose network; no TLS |
| libp2p Noise/Yamux | IMPLEMENTED_AND_TESTED | B→C and A→D hops | `920d551` | `mesh-integration.test.mjs`, Compose smoke | Configured bootstrap peers |
| Relay queue, recovery | IMPLEMENTED_AND_TESTED | Relay survives restart with bundle | `920d551` | `mesh-integration.test.mjs` | Local JSON, single writer; no distributed custody protocol |
| Compact CBOR fragmentation and durable partial reassembly component | IMPLEMENTED_AND_TESTED | Binary frame roundtrip, missing/duplicate/corrupt/expiry/restart | `cb837ab` | `mesh-framing.test.mjs` | No physical MTU test |
| TCP fragmented wire transfer | IMPLEMENTED_AND_TESTED | A→B at MTU 400, real signed payment; receiver restart between packets | `55a830b` | `mesh-integration.test.mjs`, `mesh-tcp-framing.test.mjs` | TCP only; libp2p still unfragmented |
| Per-hop delivery journal | IMPLEMENTED_AND_TESTED | Incoming/outgoing state survives restart; origin marks delivered on verified receipt | `55a830b` | `mesh-delivery.test.mjs`, `mesh-integration.test.mjs` | Forwarding still waits for peer response; no durable outbound packet retransmission |
| Whole-envelope outgoing recovery | IMPLEMENTED_AND_TESTED | Unfinished relay delivery is requeued on restart; expiry and uncertain outcomes block retry | `7714cda` | `mesh-delivery.test.mjs` | Unit restart test; no process-kill timing test for this precise transition; no per-fragment ACK |
| Transactional delivery journal | IMPLEMENTED_AND_TESTED | SQLite WAL stores outgoing and incoming journal transitions before returning; legacy JSON journal imports once; node identity survives | `74364cf` | `mesh-sqlite-delivery.test.mjs` | Relay queue, payment store and TCP fragment state still use separate JSON files; no atomic transaction across these boundaries |
| Atomic inbound replay journal | IMPLEMENTED_AND_TESTED | Seen ID and incoming record commit or roll back in one SQLite transaction; migration retains existing replay IDs | see atomic replay PR | `mesh-sqlite-delivery.test.mjs` | Bundle custody, queue and settlement still span separate stores |
| Relay queue quotas component | IMPLEMENTED_AND_TESTED | Per-origin, item and disk-size limits | `cb837ab` | `mesh-queue.test.mjs` | JSON storage is still single-process and synchronous |
| Async transport delivery API | ARCHITECTURAL_EXTENSION_POINT | Existing transports still use synchronous request/response | — | — | Requires migration and end-to-end tests |
| One-way adapter submission primitives | IMPLEMENTED_AND_TESTED | TCP and libp2p accept `submit` and invoke `onMessage` without waiting for application completion | see async adapter PR | `mesh-async-transport.test.mjs` | MeshNode still uses synchronous `send`; no custody or ACK semantics; libp2p payload not Mesh-fragmented |
| Solana Devnet Mesh | BLOCKED_BY_EXTERNAL_DEPENDENCY | Optional proof script checks on-chain transfer, memo, route and receipt | `6ebaec5` | `compose-devnet-smoke.mjs` (blocked before transaction) | Disposable funded Devnet payer and RPC access |
| BPv7 interop / BPSec | BLOCKED_BY_EXTERNAL_DEPENDENCY | No daemon or interoperability test | — | — | Real BPv7 stack/sidecar and BPSec support |
| Bluetooth / Bluetooth Mesh | BLOCKED_BY_EXTERNAL_DEPENDENCY | No physical transfer | — | `tests/hardware` skipped | Two endpoints, gateway/BlueZ or Zephyr |
| LoRa / packet radio | BLOCKED_BY_EXTERNAL_DEPENDENCY | No RF transfer | — | `tests/hardware` skipped | Two modems, local spectrum configuration |
| Non-IP satellite | BLOCKED_BY_EXTERNAL_DEPENDENCY | No provider message | — | `tests/hardware` skipped | Account, modem, gateway |
| 5G ProSe | BLOCKED_BY_EXTERNAL_DEPENDENCY | No sidelink transfer | — | `tests/hardware` skipped | Sidelink UE, vendor API and network |
| Fiat/card sandbox | BLOCKED_BY_EXTERNAL_DEPENDENCY | No provider authorization/capture | — | — | Qualified sandbox partner; tokenized credentials |

The standard CI runs software tests and Compose. It does not count skipped hardware tests as proof of a working radio, satellite or cellular bearer. See `docs/STANDARDS.md` for RFC claims and `docs/DTN_ARCHITECTURE.md` for present limits.
