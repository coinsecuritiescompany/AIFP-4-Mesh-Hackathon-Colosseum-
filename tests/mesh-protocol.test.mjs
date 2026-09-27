import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadIdentity } from '../src/mesh/identity.js';
import { envelope, validateEnvelope, wireEncode, wireDecode } from '../src/mesh/protocol.js';
import { planRoute } from '../src/mesh/routing.js';
import { MeshNode } from '../src/mesh/node.js';
import { MeshService } from '../src/service.js';
import { IntentStore } from '../src/store.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mesh-protocol-'));
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const identity=loadIdentity(path.join(dir,'identity.json'),'node-test');
test('persistent Ed25519 identity survives reload',()=>assert.equal(loadIdentity(path.join(dir,'identity.json'),'node-test').publicKey,identity.publicKey));
test('canonical signing survives CBOR wire roundtrip',()=>{const msg=envelope(identity,'PING',{z:2,a:1}); const wire=wireEncode(msg); assert.ok(wire.length>0); assert.equal(validateEnvelope(wireDecode(wire)).messageId,msg.messageId);});
test('tampered signed payload is rejected',()=>{const msg=envelope(identity,'PING',{x:1}); assert.throws(()=>validateEnvelope({...msg,payload:{x:2}}),/EXPIRED_OR_TAMPERED/);});
test('invalid signature and changed pinned key are rejected',()=>{const msg=envelope(identity,'PING',{x:1}); assert.throws(()=>validateEnvelope({...msg,signature:'not-valid'}),/INVALID_SIGNATURE/); assert.throws(()=>validateEnvelope(msg,'other'),/PEER_KEY_CHANGED/);});
test('expired messages and excessive hops are rejected',()=>{const msg=envelope(identity,'PING',{x:1}); assert.throws(()=>validateEnvelope({...msg,expiresAt:'2000-01-01'}),/EXPIRED_OR_TAMPERED/); assert.throws(()=>validateEnvelope({...msg,hopCount:9}),/INVALID_ENVELOPE/);});
test('wire size is bounded',()=>assert.throws(()=>wireDecode(Buffer.alloc(65537)),/WIRE_TOO_LARGE/));
test('weighted route prefers reliable transport and excludes failed node',()=>{
  const links=[{from:'a',to:'b',transport:'tcp',online:true,cost:10,reliability:0.1},{from:'b',to:'c',transport:'libp2p',online:true,cost:10,reliability:1},{from:'a',to:'d',transport:'libp2p',online:true,cost:30,reliability:1},{from:'d',to:'c',transport:'tcp',online:true,cost:20,reliability:1}];
  const cap=[{nodeId:'c',canSettle:true,assets:['USDC'],expiresAt:Date.now()+10000}];
  assert.deepEqual(planRoute('a','USDC',links,cap).edges.map(e=>e.to),['d','c']);
  assert.deepEqual(planRoute('a','USDC',links,cap,['d']).edges.map(e=>e.to),['b','c']);
});
test('concurrent copies via different paths share one receipt and settlement',async()=>{
  const store=new IntentStore(), route={id:'mock',rail:'mock',asset:'USDC',network:'sandbox',online:true,feeBps:0,fixedFeeMinor:0,latencyMs:1,minAmountMinor:1,maxAmountMinor:1000000};
  const service=new MeshService({routes:[route],store,meshMode:true});
  const origin=loadIdentity(path.join(dir,'origin.json'),'node-a');
  const node=new MeshNode({nodeId:'node-c',dataDir:path.join(dir,'settle'),peers:{},service});
  const input={agentId:'agent_demo',beneficiary:'merchant',amountMinor:100,asset:'USDC',purpose:'test',idempotencyKey:'two-paths'};
  const intent=service.createIntent(input), agent=store.find('agents',intent.agentId),policy=store.find('policies',intent.policyId);
  const shared={intent,agent,policy,currentPolicy:policy,originNodeId:'node-a',originPublicKey:origin.publicKey,originSignature:origin.sign({intentHash:intent.intentHash,originNodeId:'node-a',agent,policy,currentPolicy:policy})};
  const [first,second]=await Promise.all([node.settle({...shared,path:['node-a','node-b','node-c'],transportPath:[{from:'node-a',to:'node-b',transport:'tcp'},{from:'node-b',to:'node-c',transport:'libp2p'}]}),node.settle({...shared,path:['node-a','node-d','node-c'],transportPath:[{from:'node-a',to:'node-d',transport:'libp2p'},{from:'node-d',to:'node-c',transport:'tcp'}]})]);
  assert.equal(first.receiptId,second.receiptId); assert.equal(first.receiptHash,second.receiptHash);
  assert.equal(store.all('transactions').length,1); assert.equal(store.all('receipts').length,1);
});
