import { createClient, generateKeyPairSigner, lamports } from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { getTransferSolInstruction } from '@solana-program/system';
import { getAddMemoInstruction } from '@solana-program/memo';
import { createHash } from 'node:crypto';

const payer = await generateKeyPairSigner();
const recipient = await generateKeyPairSigner();
const client = createClient().use(signer(payer)).use(solanaDevnetRpc());

const amount = lamports(1_000_000n); // 0.001 SOL
const intent = {
  protocol: 'AIFP-4-Mesh',
  version: '0.1.0',
  payer: payer.address,
  beneficiary: recipient.address,
  amountLamports: amount.toString(),
  createdAt: new Date().toISOString()
};
const intentHash = createHash('sha256').update(JSON.stringify(intent)).digest('hex');

async function fundEphemeralPayer() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.log(`Requesting Devnet SOL for ephemeral sandbox payer (attempt ${attempt}/3):`, payer.address);
      await client.airdrop(payer.address, lamports(50_000_000n));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw new Error(
    `Devnet faucet unavailable after 3 attempts. The payment code is ready, but the public faucet did not fund the disposable payer. Retry later or run against a pre-funded Devnet payer. Cause: ${lastError?.message ?? lastError}`
  );
}

await fundEphemeralPayer();

const transfer = getTransferSolInstruction({
  source: client.payer,
  destination: recipient.address,
  amount
});
const memo = getAddMemoInstruction({ memo: `AIFP4:${intentHash}` });
const { context } = await client.sendTransaction([transfer, memo]);

console.log(JSON.stringify({
  network: 'solana-devnet',
  intentHash,
  payer: payer.address,
  recipient: recipient.address,
  amountLamports: amount.toString(),
  signature: context.signature.toString(),
  explorer: `https://explorer.solana.com/tx/${context.signature}?cluster=devnet`
}, null, 2));
