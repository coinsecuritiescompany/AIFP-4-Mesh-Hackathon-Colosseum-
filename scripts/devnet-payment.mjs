import { createClient, createKeyPairSignerFromBytes, generateKeyPairSigner, lamports } from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { getTransferSolInstruction } from '@solana-program/system';
import { getAddMemoInstruction } from '@solana-program/memo';
import { createHash } from 'node:crypto';

async function loadPayer() {
  const encoded = process.env.SOLANA_PAYER_SECRET_JSON;
  if (!encoded) return { payer: await generateKeyPairSigner(), ephemeral: true };

  const bytes = new Uint8Array(JSON.parse(encoded));
  if (bytes.length !== 64) throw new Error('SOLANA_PAYER_SECRET_JSON must contain a 64-byte Devnet keypair JSON array');
  return { payer: await createKeyPairSignerFromBytes(bytes), ephemeral: false };
}

const { payer, ephemeral } = await loadPayer();
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
    `Devnet faucet unavailable after 3 attempts. Set SOLANA_PAYER_SECRET_JSON to a pre-funded Devnet-only 64-byte keypair JSON array, or retry later. Cause: ${lastError?.message ?? lastError}`
  );
}

if (ephemeral) {
  await fundEphemeralPayer();
} else {
  console.log('Using pre-funded Devnet-only payer:', payer.address);
}

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
