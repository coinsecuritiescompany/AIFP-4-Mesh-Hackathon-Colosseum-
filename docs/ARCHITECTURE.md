# AIFP-4 Mesh MVP Architecture

## Objective

AIFP-4 Mesh is a local-first payment orchestration layer for autonomous agents. An agent creates a deterministic payment intent, the policy engine checks delegated authority, the mesh router selects an eligible rail, and execution returns a verifiable receipt.

## MVP components

1. **Intent envelope** — canonical payload + SHA-256 hash + optional HMAC integrity tag.
2. **Policy engine** — spend caps, asset restrictions, beneficiary controls, purpose requirement.
3. **Mesh router** — ranks eligible routes by availability, fee and latency; can queue when connectivity is unavailable.
4. **Rail adapters** — deterministic mock adapter for CI and a Solana Devnet demo for real sandbox settlement.
5. **Receipt layer** — binds intent hash, execution reference, fee, rail, network and settlement timestamp.
6. **Offline reconciliation** — queued intents are re-ranked and executed after an eligible route becomes reachable.

## Trust boundary

The protocol does not store production banking credentials or custody production funds. Sandbox secrets stay outside git. Production signing should move to KMS/HSM-backed keys and asymmetric signatures.

## Solana proof

The Devnet demo sends SOL and a Memo instruction in one transaction. The memo contains `AIFP4:<intentHash>`, which creates a public, inspectable binding between the off-chain intent and the on-chain settlement proof.
