import './load-demo-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createKeyPairSignerFromBytes, generateKeyPairSigner } from '@solana/kit';

const secret=process.env.SOLANA_PAYER_SECRET_JSON;
if(!secret) throw new Error('BLOCKED: supply a disposable, pre-funded Devnet-only SOLANA_PAYER_SECRET_JSON through an untracked .env; no transaction was attempted');
let payer;
try {const bytes=JSON.parse(secret); assert.equal(bytes.length,64); payer=await createKeyPairSignerFromBytes(Uint8Array.from(bytes));}
catch {throw new Error('Invalid Devnet-only payer keypair JSON (expected 64 bytes)');}
const base=process.env.AIFP4_SMOKE_URL ?? 'http://127.0.0.1:4044';
const key=process.env.AIFP4_API_KEY ?? 'sandbox-demo-key';
const rpcUrl=process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const recipient=process.env.SOLANA_DEVNET_RECIPIENT ?? (await generateKeyPairSigner()).address;
const amount=Number(process.env.SOLANA_DEVNET_LAMPORTS ?? '1000');
if(!Number.isSafeInteger(amount) || amount<1 || amount>1000000) throw new Error('Use 1–1000000 disposable Devnet lamports only');
async function api(route,method='GET',body) {
  const response=await fetch(base+route,{method,headers:{'x-aifp4-api-key':key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const value=await response.json(); if(!response.ok) throw new Error(`Mesh API ${response.status}: ${JSON.stringify(value)}`); return value;
}
async function rpc(method,params) {
  const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`Devnet RPC HTTP ${response.status}`);
  const result=await response.json(); if(result.error) throw new Error(`Devnet RPC: ${JSON.stringify(result.error)}`); return result.result;
}
const nodeA=await api('/v1/mesh/node'); assert.equal(nodeA.canSettle,false,'Origin must not hold rail credentials');
const routes=(await api('/v1/mesh/routes')).routes;
assert.ok(routes.some(r=>r.nodeId==='node-c' && r.rails?.includes('solana-devnet')),'Node C has not advertised Devnet; configure only mesh-node-c');
const balance=await rpc('getBalance',[String(payer.address),{commitment:'confirmed'}]);
if(balance.value<amount+10000) throw new Error(`Devnet payer ${payer.address} needs test SOL (balance ${balance.value} lamports)`);
const intent=await api('/v1/intents','POST',{agentId:'agent_demo',beneficiary:String(recipient),amountMinor:amount,asset:'SOL',purpose:'Devnet Mesh proof',idempotencyKey:`devnet-${randomUUID()}`});
const settled=await api(`/v1/intents/${intent.id}/execute`,'POST');
assert.equal(settled.state,'settled',`Settlement did not complete: ${JSON.stringify(settled)}`);
assert.deepEqual(settled.meshPath,['node-a','node-b','node-c']);
assert.deepEqual(settled.transportPath.map(edge=>edge.transport),['tcp','libp2p']);
assert.equal(settled.receiptVerified,true);
assert.equal(settled.receipt.intentHash,intent.intentHash);
assert.equal(settled.receipt.settlementNodeId,'node-c');
const signature=settled.receipt.executionReference;
assert.match(signature,/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
let tx;
for(let attempt=0;attempt<20;attempt++) {
  tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
  if(tx) break; await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!tx) throw new Error(`Devnet transaction ${signature} not available at confirmed commitment`);
assert.equal(tx.meta.err,null);
assert.ok(tx.transaction.signatures.includes(signature));
const instructions=tx.transaction.message.instructions;
assert.ok(instructions.some(x=>x.program==='system' && x.parsed?.type==='transfer' && x.parsed.info.source===String(payer.address) && x.parsed.info.destination===String(recipient) && Number(x.parsed.info.lamports)===amount),'Transfer source, recipient or amount do not match');
assert.ok(instructions.some(x=>String(x.programId).startsWith('Memo') && (typeof x.parsed==='string'?x.parsed:x.parsed?.memo)===`AIFP4:${intent.intentHash}`),'AIFP4 memo does not bind intent hash');
console.log(JSON.stringify({intentId:intent.id,intentHash:intent.intentHash,meshPath:settled.meshPath,transports:settled.transportPath.map(x=>x.transport),signature,explorer:settled.receipt.explorer,verified:true},null,2));
