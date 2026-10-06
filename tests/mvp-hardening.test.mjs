import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MeshService } from '../src/service.js';
import { IntentStore } from '../src/store.js';
import { MeshNode } from '../src/mesh/node.js';
import { loadIdentity } from '../src/mesh/identity.js';
import { sha256 } from '../src/canonical.js';
const route={id:'mock',rail:'mock',network:'sandbox',asset:'USDC',online:true,feeBps:0,fixedFeeMinor:0,latencyMs:1,supportsOfflineQueue:true,minAmountMinor:1,maxAmountMinor:1000000};
const payment={idempotencyKey:'hardening-payment',agentId:'agent_demo',beneficiary:' ai-data-api ',amountMinor:250,asset:'USDC',purpose:'MVP'};
test('Mesh creation waits for explicit dispatch even without local routes',()=>{
  const service=new MeshService({routes:[],meshMode:true});
  assert.equal(service.createIntent(payment).state,'authorized');
  assert.equal(service.store.all('transactions').length,0);
});
test('idempotency normalizes beneficiary the same way as stored intent',()=>{
  const service=new MeshService({routes:[route]});
  const first=service.createIntent(payment);
  assert.equal(service.createIntent(payment).id,first.id);
});
test('settlement records and state commit together; disk failure locks payment without partial receipt',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp4-hardening-'));
  try {
    const store=new IntentStore(path.join(dir,'payments.json'));
    const service=new MeshService({routes:[route],store});
    const i=service.createIntent(payment);
    const persist=store.persist.bind(store);
    let attempts=0;
    store.persist=()=>{attempts++;if(attempts===2)throw new Error('DISK_FAILURE');persist();};
    await assert.rejects(service.execute(i.id),/DISK_FAILURE/);
    const reopened=new IntentStore(store.file);
    assert.equal(reopened.get(i.id).state,'executing');
    assert.equal(reopened.all('receipts').length,0);assert.equal(reopened.all('transactions').length,0);
    await assert.rejects(service.execute(i.id),{code:'EXECUTION_UNCERTAIN'});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('even signed receipts must match the requested asset and amount',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp4-receipt-fields-'));
  const node=new MeshNode({nodeId:'node-a',dataDir:dir,peers:{},service:{routes:[],adapters:new Map()}});
  try {
    const signer=loadIdentity(path.join(dir,'settler.json'),'node-c');
    node.state.peerKeys['node-c']=signer.publicKey;
    const intent={id:'pi_test',intentHash:'bound',asset:'USDC',amountMinor:250};
    const core={intentId:intent.id,intentHash:intent.intentHash,originNodeId:'node-a',settlementNodeId:'node-c',asset:'SOL',amountMinor:251,executionReference:'ref',settledAt:new Date().toISOString()};
    const receipt={...core,receiptHash:sha256(core),settlementNodeSignature:signer.sign(core)};
    assert.throws(()=>node.verifyReceipt(receipt,intent),/INVALID_RECEIPT/);
  } finally {node.deliveryDatabase.close();fs.rmSync(dir,{recursive:true,force:true});}
});
