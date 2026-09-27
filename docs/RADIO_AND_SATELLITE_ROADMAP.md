# Future physical bearers

The core accepts a transport adapter with authenticated peers, bounded complete messages and link-state metadata. Hardware claims require real devices and end-to-end tests. None of these adapters exists today:

- Bluetooth/BLE Mesh: provision compatible devices, authenticate device identity, respect Bluetooth Mesh MTU and retransmission limits, test gateway-to-gateway delivery.
- Wi-Fi Direct and 5G ProSe: use the platform's real discovery/direct link APIs; ordinary IP over Wi-Fi/4G/5G is already transportable by TCP but is not ProSe.
- LoRa/packet/serial radio: use modem framing, duty-cycle and payload limits; fragment/reassemble with integrity and replay caps before handing a full envelope to the core. LoRaWAN itself is not assumed to be Mesh.
- Satellite IP: carry the current TCP/libp2p stack only if an IP path exists. Non-IP or disrupted links need a dedicated convergence adapter and per-relay durable bundle handling.

GNSS can optionally inform routing/geofencing policy but cannot transmit a payment. Avoid collecting precise location unless explicitly required and consented to. Full DTN interoperability requires BPv7/BPSec/TCPCLv4 implementations and standards testing; current AIFP messages are not those protocols.
