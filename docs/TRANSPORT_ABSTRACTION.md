# Transport abstraction

`MeshNode` registers adapters in a map keyed by transport ID. Both `TcpTransport` and `Libp2pTransport` implement `start`, `stop`, `send(peer, signedEnvelope)`, `health` and an inbound callback. The Mesh chooses an adapter from the selected edge. Neither intent hashing, policy checking nor receipt signing branches on the transport type. The TCP adapter uses 4-byte length framing; libp2p negotiates `/aifp4/mesh/1.0.0` over TCP, Noise and Yamux. Both carry CBOR bytes.

Each edge advertises `{from,to,transport,online,cost,reliability}`. Local availability is probed by signed HELLO on the actual adapter; a stale remote advertisement ages out. A node may expose multiple adapters simultaneously. The default Docker topology deliberately crosses adapter types. Current implementations have a 64 KiB message cap; they do not fragment for small MTUs.

See [adapter SDK](TRANSPORT_ADAPTER_SDK.md) for adding another bearer. Bluetooth, ProSe, LoRa, serial/radio and non-IP satellite adapters are **not installed** and do not appear as online links. GNSS provides no data transport.

Both working adapters expose `capabilities()` with MTU, online state, discovery, ACK, store-forward and security fields. TCP now sends compact CBOR fragments in length-framed packets when a signed envelope exceeds its configured frame MTU (`MESH_TCP_FRAME_MTU`, default 4096 bytes). A per-node reassembler persists incomplete incoming frames and calls the Mesh receiver only after complete hash-checked reassembly. Integration tests use a 400-byte TCP MTU and a real A→B→C payment, plus restart the TCP receiver between fragments. libp2p still sends an unfragmented envelope (64 KiB cap). This does **not** establish a physical radio link or BLE MTU compatibility.

The forwarding API still waits for a peer response. A persistent per-hop delivery journal distinguishes `SENDING`, `SENT`, `ACKNOWLEDGED` and `DELIVERED` (the last only on verified origin receipt). It is observability and crash history, **not yet a fully asynchronous transport contract** with durable transport-level outbox replay. That migration remains a separate milestone.
