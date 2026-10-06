import { address, createClient, createKeyPairSignerFromBytes, lamports } from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { getTransferSolInstruction } from '@solana-program/system';
import { getAddMemoInstruction } from '@solana-program/memo';

// This rail is enabled only with a disposable, pre-funded Devnet-only payer.
export class SolanaDevnetAdapter {
  constructor(secretJson, { createRpcClient = payer => createClient().use(signer(payer)).use(solanaDevnetRpc()), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) { this.secretJson = secretJson; this.createRpcClient = createRpcClient; this.wait = wait; }
  async execute(intent) {
    if (intent.asset !== 'SOL') throw new Error('Solana Devnet adapter supports SOL only');
    if (!this.secretJson) throw new Error('Devnet payer is not configured');
    const bytes = new Uint8Array(JSON.parse(this.secretJson));
    if (bytes.length !== 64) throw new Error('Devnet payer must be a 64-byte keypair array');
    const payer = await createKeyPairSignerFromBytes(bytes);
    const destination = address(intent.beneficiary);
    const client = this.createRpcClient(payer);
    const { context } = await client.sendTransaction([
      getTransferSolInstruction({ source: client.payer, destination, amount: lamports(BigInt(intent.amountMinor)) }),
      getAddMemoInstruction({ memo: `AIFP4:${intent.intentHash}` })
    ]);
    const signature = String(context.signature);
    // Sending alone is not proof of settlement. Wait for on-chain confirmation.
    for (let attempt = 0; attempt < 12; attempt++) {
      const statuses = await client.rpc.getSignatureStatuses([signature]).send();
      const status = statuses.value[0];
      if (status?.err) throw new Error('Devnet transaction failed');
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return { executionId: signature, rail: 'solana-devnet', network: 'solana-devnet', status: 'settled', reference: signature, signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`, amountMinor: intent.amountMinor, asset: 'SOL', beneficiary: intent.beneficiary, feeMinor: 0, settledAt: new Date().toISOString() };
      }
      await this.wait(1000);
    }
    throw new Error('Devnet confirmation unknown; inspect the payer before retrying');
  }
}
