import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IntentStore } from '../src/store.js';
import { MeshNode } from '../src/mesh/node.js';

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-receipt-'));
  const file=path.join(dir,'payments.json');
  const store=new IntentStore(file);
  store.create({id:'pi_recovery',state:'queued_for_mesh',intentHash:'protected'});
  const receipt={receiptId:'receipt_recovery',intentId:'pi_recovery',receiptHash:'bound',meshPath:['a','b','c'],transportPath:[],executionReference:'sandbox-ref'};
  const transaction={id:'tx_recovery',intentId:'pi_recovery',reference:'sandbox-ref'};
  return {dir,file,store,receipt,transaction};
}
test('origin records receipt, payment state and one transaction in one durable write',()=>{
  const f=fixture();
  try {
    const settled=f.store.commitMeshReceipt('pi_recovery',f.receipt,f.transaction);
    assert.equal(settled.receiptVerified,true);
    const restarted=new IntentStore(f.file);
    assert.equal(restarted.get('pi_recovery').state,'settled');
    assert.equal(restarted.all('receipts').length,1);
    assert.equal(restarted.all('transactions').length,1);
    restarted.commitMeshReceipt('pi_recovery',f.receipt,{...f.transaction,id:'another-attempt'});
    assert.equal(new IntentStore(f.file).all('transactions').length,1);
  } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('failed receipt persist rolls back all in-memory transitions',()=>{
  const f=fixture();
  try {
    const original=f.store.persist.bind(f.store);
    f.store.persist=()=>{throw new Error('DISK_UNAVAILABLE');};
    assert.throws(()=>f.store.commitMeshReceipt('pi_recovery',f.receipt,f.transaction),/DISK_UNAVAILABLE/);
    assert.equal(f.store.get('pi_recovery').state,'queued_for_mesh');
    assert.equal(f.store.all('receipts').length,0);
    assert.equal(f.store.all('transactions').length,0);
    assert.equal(new IntentStore(f.file).get('pi_recovery').state,'queued_for_mesh');
    f.store.persist=original;
    f.store.commitMeshReceipt('pi_recovery',f.receipt,f.transaction);
    assert.equal(new IntentStore(f.file).all('transactions').length,1);
  } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('preexisting partial legacy records reconcile without duplicates or conflicting references',()=>{
  const f=fixture();
  try {
    f.store.add('receipts',f.receipt);
    f.store.add('transactions',f.transaction);
    f.store.commitMeshReceipt('pi_recovery',f.receipt,{...f.transaction,id:'retry'});
    assert.equal(new IntentStore(f.file).all('transactions').length,1);
    assert.throws(()=>{
      const g=fixture();
      try {g.store.add('transactions',{...g.transaction,reference:'different'});g.store.commitMeshReceipt('pi_recovery',g.receipt,g.transaction);}
      finally {fs.rmSync(g.dir,{recursive:true,force:true});}
    },/SETTLEMENT_RECORD_CONFLICT/);
  } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('restart recovers a signed settlement receipt whose outbound bundle was never committed',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-settlement-recovery-'));
  const receipt={intentId:'pi_recovery',receiptHash:'already-signed',originNodeId:'node-a'};
  const node=new MeshNode({nodeId:'node-c',dataDir:dir,peers:{},service:{store:{get:()=>null},routes:[],adapters:new Map()},tcpPort:0,p2pPort:0});
  try {
    node.state.meshReceipts.pi_recovery=receipt;node.persist();
    assert.equal(await node.settle({intent:{id:'pi_recovery'}}),receipt);
    assert.equal(node.deliveryDatabase.bundles().filter(b=>b.kind==='receipt').length,1);
    await node.settle({intent:{id:'pi_recovery'}});
    assert.equal(node.deliveryDatabase.bundles().filter(b=>b.kind==='receipt').length,1);
  } finally {node.deliveryDatabase.close();fs.rmSync(dir,{recursive:true,force:true});}
});
