# Standards mapping

| Reference | AIFP-4 status | Precise boundary |
| --- | --- | --- |
| [RFC 9171 BPv7](https://www.rfc-editor.org/rfc/rfc9171) | Architecturally inspired | Bundle lifetime, forwarding and disrupted connectivity ideas; **no BPv7 bundle format or interoperability**. |
| [RFC 9172 BPSec](https://www.rfc-editor.org/rfc/rfc9172) | Future | Application signatures exist, but no BPSec blocks or BP security processing. |
| [RFC 9174 TCPCLv4](https://www.rfc-editor.org/rfc/rfc9174) | Future | Custom length-framed TCP adapter, **not** TCPCLv4. |
| [RFC 8949 CBOR](https://www.rfc-editor.org/rfc/rfc8949) | Implemented serialization | CBOR wire encoding/decoding via `cborg`; signatures use sorted JSON, not deterministic CBOR byte signatures. |
| [RFC 9052](https://www.rfc-editor.org/rfc/rfc9052), [RFC 9053](https://www.rfc-editor.org/rfc/rfc9053) COSE | Future | Ed25519 custom envelope; no COSE_Sign1 protected headers or COSE conformance. |
| [3GPP TS 23.304](https://www.3gpp.org/dynareport/23304.htm) ProSe | Future | No 5G device-to-device adapter. Ordinary 5G IP can carry TCP where an IP route exists. |
| [Bluetooth Mesh Profile](https://www.bluetooth.com/specifications/specs/mesh-profile-1-0-1/) | Future | No Bluetooth hardware/software adapter, provisioning or compliance tests. |

The word “Mesh” here describes the tested overlay of independent nodes and heterogeneous **software** links. Physical bearer independence is an adapter boundary; universal radio connectivity is not claimed. Full BPv7 conformance would require a BP implementation, BPv7 bundles/security processing and interop test suite. GNSS is optional location metadata and is never a bearer.
