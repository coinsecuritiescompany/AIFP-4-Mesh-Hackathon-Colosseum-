# Threat model

Protected assets: payment amount/beneficiary/asset, delegated policy, rail credentials, settlement reference and receipt integrity. Actors: external API caller, Docker peer, compromised relay, malicious bootstrap, compromised host and unstable rail.

| Threat | Current control | Residual risk |
| --- | --- | --- |
| Relay modifies payment/policy | Origin Ed25519 signs intent hash, agent and original/current policy snapshots; C verifies before settlement. | The origin is trusted to represent delegated authority; passports are simulated. |
| Impersonated peer | Signed envelopes; TOFU public-key pinning; libp2p Noise peer ID matched to signed advertisement. | Initial enrollment has no external CA/pinned allowlist. TCP payloads are plaintext inside Compose. |
| Replay/loops | Persistent message-ID cache, expiry, hop limit, visited-node path; C idempotency journal. | No BPSec or physical-bearer security; replay store is per node. |
| Double settlement after timeout | C locks `executing` uncertainty; cached receipt for settled intent. | No independent on-chain uncertainty resolver. Host crash around an external rail needs manual inspection. |
| Resource exhaustion | 64 KiB frames, timeouts, bounded catalogs, API rate/body limits. | Peer ports have no per-peer quotas; do not expose TCP/libp2p ports to an untrusted Internet. |
| Stolen payer key | Only C receives optional disposable Devnet key; API refuses demo credentials with payer. | `.env`/Docker environment and host remain sensitive. Rotate a leaked key, inspect transactions, do not reuse production keys. |

GNSS/location is not collected. The demo does not authorize a production financial operation. Fiat/card rails would require suitable licensed partners and legal review; this is not legal advice.
