# Implementation status

This table reports observed behavior. `IMPLEMENTED_NOT_HARDWARE_VERIFIED` is reserved for an adapter with working software contract tests but no physical link proof. A design or simulator alone remains `ARCHITECTURAL_EXTENSION_POINT`.

| Capability | Status | Evidence | Commit SHA | Test | External dependency / limitation |
| --- | --- | --- | --- | --- | --- |
| TCP multi-hop | IMPLEMENTED_AND_TESTED | Independent processes A→B→C | `920d551` | `mesh-integration.test.mjs`, Compose smoke | Private Compose network; no TLS |
| libp2p Noise/Yamux | IMPLEMENTED_AND_TESTED | B→C and A→D hops | `920d551` | `mesh-integration.test.mjs`, Compose smoke | Configured bootstrap peers |
| Relay queue, recovery | IMPLEMENTED_AND_TESTED | Relay survives restart with bundle | `920d551` | `mesh-integration.test.mjs` | Local JSON, single writer; no distributed custody protocol |
| Compact CBOR fragmentation and durable partial reassembly component | IMPLEMENTED_AND_TESTED | Binary frame roundtrip, missing/duplicate/corrupt/expiry/restart | feature branch `feat/async-dtn-core` | `mesh-framing.test.mjs` | Not wired into TCP/libp2p send pipeline; no physical MTU test |
| Relay queue quotas component | IMPLEMENTED_AND_TESTED | Per-origin, item and disk-size limits | feature branch `feat/async-dtn-core` | `mesh-queue.test.mjs` | JSON storage is still single-process and synchronous |
| Async transport delivery API | ARCHITECTURAL_EXTENSION_POINT | Existing transports still use synchronous request/response | — | — | Requires migration and end-to-end tests |
| Solana Devnet Mesh | BLOCKED_BY_EXTERNAL_DEPENDENCY | Optional proof script checks on-chain transfer, memo, route and receipt | feature branch `feat/async-dtn-core` | `compose-devnet-smoke.mjs` (not executed) | Disposable funded Devnet payer and RPC access |
| BPv7 interop / BPSec | BLOCKED_BY_EXTERNAL_DEPENDENCY | No daemon or interoperability test | — | — | Real BPv7 stack/sidecar and BPSec support |
| Bluetooth / Bluetooth Mesh | BLOCKED_BY_EXTERNAL_DEPENDENCY | No physical transfer | — | `tests/hardware` skipped | Two endpoints, gateway/BlueZ or Zephyr |
| LoRa / packet radio | BLOCKED_BY_EXTERNAL_DEPENDENCY | No RF transfer | — | `tests/hardware` skipped | Two modems, local spectrum configuration |
| Non-IP satellite | BLOCKED_BY_EXTERNAL_DEPENDENCY | No provider message | — | `tests/hardware` skipped | Account, modem, gateway |
| 5G ProSe | BLOCKED_BY_EXTERNAL_DEPENDENCY | No sidelink transfer | — | `tests/hardware` skipped | Sidelink UE, vendor API and network |
| Fiat/card sandbox | BLOCKED_BY_EXTERNAL_DEPENDENCY | No provider authorization/capture | — | — | Qualified sandbox partner; tokenized credentials |

The standard CI runs software tests and Compose. It does not count skipped hardware tests as proof of a working radio, satellite or cellular bearer. See `docs/STANDARDS.md` for RFC claims and `docs/DTN_ARCHITECTURE.md` for present limits.
