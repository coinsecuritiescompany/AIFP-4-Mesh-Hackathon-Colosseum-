# Transport adapter SDK

An adapter must expose `id`, `start()`, `stop()`, `send(peer, envelope)` and `health()`, and call its constructor's `receive(envelope, transportId, authenticatedPeerId?)` for incoming messages. Register an instance in `MeshNode.transports`. The adapter is responsible for bounded framing, timeouts, physical discovery/address resolution and receiving a complete CBOR envelope. Return a signed response or throw. Never return success before the remote endpoint accepts the message.

The core validates protocol version, Ed25519 signature, expiry, replay and the protected payment fields regardless of bearer. A new adapter should report MTU, availability, bandwidth/latency/cost, reliability, metering, energy, and its own security properties. The route graph needs an edge containing its adapter ID. If a constrained link requires fragmentation, reassemble and verify the **entire** signed envelope before calling `receive`; bound fragment count, memory and expiry. Do not execute a partial payment.

For a radio gateway: implement real modem framing, link acknowledgment and replay-resistant reassembly inside `RadioTransport`; run two independent gateway devices in tests; then add a live edge advertisement. Until then, there is no radio route. The present adapter implementations are `src/mesh/transports/tcp.js` and `libp2p.js`.
