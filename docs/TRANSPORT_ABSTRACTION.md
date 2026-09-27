# Transport abstraction

`MeshNode` registers adapters in a map keyed by transport ID. Both `TcpTransport` and `Libp2pTransport` implement `start`, `stop`, `send(peer, signedEnvelope)`, `health` and an inbound callback. The Mesh chooses an adapter from the selected edge. Neither intent hashing, policy checking nor receipt signing branches on the transport type. The TCP adapter uses 4-byte length framing; libp2p negotiates `/aifp4/mesh/1.0.0` over TCP, Noise and Yamux. Both carry CBOR bytes.

Each edge advertises `{from,to,transport,online,cost,reliability}`. Local availability is probed by signed HELLO on the actual adapter; a stale remote advertisement ages out. A node may expose multiple adapters simultaneously. The default Docker topology deliberately crosses adapter types. Current implementations have a 64 KiB message cap; they do not fragment for small MTUs.

See [adapter SDK](TRANSPORT_ADAPTER_SDK.md) for adding another bearer. Bluetooth, ProSe, LoRa, serial/radio and non-IP satellite adapters are **not installed** and do not appear as online links. GNSS provides no data transport.

Both working adapters now expose `capabilities()` with MTU, online state, discovery, ACK, store-forward and security fields. The new `framing/` component fragments CBOR into compact binary frames and persists partial reassembly within bounded quotas. **The current TCP/libp2p send path still uses the original synchronous response contract and does not invoke the fragmenter.** Moving to asynchronous delivery journals and transport-independent `onMessage()` is a separate integration milestone; no physical constrained-bearer support is claimed from the component tests.
