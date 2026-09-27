import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/canonical.js';
import { DeliveryDatabase } from '../src/mesh/storage/delivery-database.js';

function withDatabase(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-bundle-'));
  const file=path.join(dir,'delivery.sqlite');
  const db=new DeliveryDatabase(file);
  try {fn(db,file);} finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
}
const bundle=(id='bundle-one')=>({bundleId:id,intentId:'intent-one',kind:'payment',originNodeId:'node-a',payload:{intentHash:'hash'},bundleHash:sha256({intentHash:'hash'}),state:'QUEUED',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
const message=id=>({messageId:id,expiresAt:new Date(Date.now()+60000).toISOString()});

test('outbound bundle and hop are one transaction before transport submission',()=>withDatabase(db=>{
  const b=bundle();const hop={hopDeliveryId:'hop-one',bundleId:b.bundleId,nextHop:'node-b',transport:'tcp',state:'READY'};
  db.createDelivery(b,hop);
  assert.equal(db.bundle(b.bundleId).state,'QUEUED');
  assert.equal(db.hop(hop.hopDeliveryId).state,'READY');
  assert.throws(()=>db.updateHop(hop.hopDeliveryId,'SUBMITTED','HOP_ACCEPTED'),/STALE_HOP_STATE/);
  db.updateHop(hop.hopDeliveryId,'READY','SUBMITTED',{submissionId:'submit-one'});
  assert.equal(db.hop(hop.hopDeliveryId).submissionId,'submit-one');
  assert.throws(()=>db.updateHop(hop.hopDeliveryId,'SUBMITTED','READY'),/INVALID_HOP_TRANSITION/);
}));

test('invalid hop prevents both bundle and hop from committing',()=>withDatabase(db=>{
  const b=bundle();
  assert.throws(()=>db.createDelivery(b,{hopDeliveryId:'hop-bad',bundleId:'wrong',nextHop:'node-b',transport:'tcp',state:'READY'}),/INVALID_HOP/);
  assert.equal(db.bundle(b.bundleId),null);
}));

test('replay marker, inbox and full accepted bundle commit atomically',()=>withDatabase(db=>{
  const b=bundle();
  const accepted=db.acceptBundle(message('wire-one'),{messageId:'wire-one',from:'node-a'},b);
  assert.equal(accepted.duplicate,false);
  assert.equal(db.bundle(b.bundleId).bundleHash,b.bundleHash);
  assert.ok(db.seen()['wire-one']);
  assert.ok(db.load('inbox')['wire-one']);
  assert.throws(()=>db.acceptBundle(message('wire-one'),{messageId:'wire-one',from:'node-a'},b),/REPLAY/);
  assert.equal(db.acceptBundle(message('wire-two'),{messageId:'wire-two',from:'node-a'},b).duplicate,true);
  assert.equal(db.bundles().length,1);
}));

test('queue full cannot insert replay marker or claim durable custody',()=>withDatabase(db=>{
  const bad=bundle();bad.payload={value:'x'.repeat(70000)};bad.bundleHash=sha256(bad.payload);
  assert.throws(()=>db.acceptBundle(message('wire-large'),{messageId:'wire-large',from:'node-a'},bad),/INVALID_BUNDLE/);
  assert.equal(db.seen()['wire-large'],undefined);
  assert.equal(db.load('inbox')['wire-large'],undefined);
}));

test('bundle state and accepted payload survive database reopen',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-bundle-restart-'));
  const file=path.join(dir,'delivery.sqlite'),b=bundle();
  try {
    const first=new DeliveryDatabase(file);
    first.acceptBundle(message('wire-start'),{messageId:'wire-start',from:'node-a'},b);
    first.updateBundle(b.bundleId,'QUEUED','WAITING_LINK');first.close();
    const second=new DeliveryDatabase(file);
    assert.equal(second.bundle(b.bundleId).state,'WAITING_LINK');
    assert.ok(second.seen()['wire-start']);second.close();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('payment flood reserves durable capacity for ACK and receipt bundles',()=>withDatabase(db=>{
  for(let i=0;i<32;i++) db.createBundle({...bundle(`payment-${i}`),originNodeId:i<16?'node-a':'node-b'});
  const overflow={...bundle('payment-overflow'),originNodeId:'node-e'};
  assert.throws(()=>db.acceptBundle(message('overflow-wire'),{messageId:'overflow-wire'},overflow),/MESH_QUEUE_FULL/);
  assert.equal(db.seen()['overflow-wire'],undefined);
  for(let i=0;i<16;i++) db.createBundle({...bundle(`ack-${i}`),kind:'ack',originNodeId:'node-c'});
  for(let i=0;i<16;i++) db.createBundle({...bundle(`receipt-${i}`),kind:'receipt',originNodeId:'node-d'});
  assert.equal(db.bundles().length,64);
  assert.throws(()=>db.createBundle({...bundle('ack-overflow'),kind:'ack',originNodeId:'node-e'}),/MESH_QUEUE_FULL/);
}));
