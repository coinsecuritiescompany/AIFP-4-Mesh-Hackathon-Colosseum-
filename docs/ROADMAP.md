# Roadmap

**Now, tested in the MVP:** five independent local nodes, signed advertisements and payment envelopes, CBOR over TCP and libp2p, weighted multi-hop routing, automatic node/transport failover, origin-side persistent queue, mock USDC settlement, signed receipt verification, Docker smoke test. A Devnet SOL rail can be enabled with a separate disposable payer on C, but was not exercised with a funded payer in automated tests.

**Next engineering gates:** formal node enrollment/key pinning, persistent per-relay bundles and asynchronous receipt forwarding, independent settlement uncertainty resolver, SQLite or transactional storage, bounded backoff and per-peer quotas, signature/transport path attestation, full replay/chaos coverage, durable audit export, accessibility and browser E2E tests.

**Later integrations:** COSE structures, BPv7/BPSec/TCPCLv4 through a tested standards implementation if interoperability is needed, real Bluetooth/ProSe/radio/satellite adapters on hardware, Solana token rail and qualified fiat/card providers. None of these future transports are currently online.
