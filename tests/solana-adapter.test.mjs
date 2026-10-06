import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { SolanaDevnetAdapter } from '../src/adapters/solana-devnet.js';
const {privateKey}=generateKeyPairSync('ed25519');
const jwk=privateKey.export({format:'jwk'});
const secret=JSON.stringify([...Buffer.concat([Buffer.from(jwk.d,'base64url'),Buffer.from(jwk.x,'base64url')])]);
const intent={asset:'SOL',amountMinor:1000,beneficiary:'11111111111111111111111111111111',intentHash:'a'.repeat(64)};
function fixture(statuses){
  let sends=0, polls=0, instructions;
  const adapter=new SolanaDevnetAdapter(secret,{wait:async()=>{},createRpcClient:payer=>({payer,async sendTransaction(i){sends++;instructions=i;return {context:{signature:'test-signature'}};},rpc:{getSignatureStatuses:()=>({send:async()=>({value:[statuses[Math.min(polls++,statuses.length-1)]]})})}})});
  return {adapter,counts:()=>({sends,polls,instructions})};
}
test('Devnet adapter binds transfer and memo, waits for confirmation before returning receipt',async()=>{
  const f=fixture([null,{confirmationStatus:'processed'}, {confirmationStatus:'confirmed',err:null}]);
  const execution=await f.adapter.execute(intent);
  assert.equal(execution.status,'settled');assert.equal(execution.network,'solana-devnet');
  assert.equal(execution.signature,'test-signature');assert.match(execution.explorer,/cluster=devnet$/);
  assert.equal(f.counts().sends,1);assert.equal(f.counts().polls,3);assert.equal(f.counts().instructions.length,2);
  assert.equal(Buffer.from(f.counts().instructions[1].data).toString(),`AIFP4:${intent.intentHash}`);
});
test('unknown confirmation never returns settlement or resends the transaction',async()=>{
  const f=fixture([null]);await assert.rejects(f.adapter.execute(intent),/confirmation unknown/);
  assert.equal(f.counts().sends,1);assert.equal(f.counts().polls,12);
});
test('on-chain error never returns a successful settlement',async()=>{
  const f=fixture([{err:{InstructionError:[0,'failed']}}]);await assert.rejects(f.adapter.execute(intent),/transaction failed/);
  assert.equal(f.counts().sends,1);
});
