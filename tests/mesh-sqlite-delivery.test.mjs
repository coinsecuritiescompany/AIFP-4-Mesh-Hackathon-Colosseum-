import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryDatabase } from '../src/mesh/storage/delivery-database.js';
import { DeliveryJournal } from '../src/mesh/delivery-journal.js';
import { MeshNode } from '../src/mesh/node.js';

function temp(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-sqlite-'));
  try { return fn(dir); } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

test('legacy journal imports once; SQLite remains authoritative after stale JSON is replayed',()=>temp(dir=>{
  const file=path.join(dir,'delivery.sqlite');
  const legacy={deliveryOutbox:{old:{messageId:'old',state:'CREATED',recovery:{type:'receipt'}}},deliveryInbox:{received:{messageId:'received'}}};
  const first=new DeliveryDatabase(file,legacy);
  const state={...legacy};const journal=new DeliveryJournal(state,()=>{},first);
  journal.mark('old','SENDING');
  journal.incoming({messageId:'new',messageType:'PAYMENT_RECEIPT'},{from:'node-c',transport:'tcp'});
  first.close();
  const reopened=new DeliveryDatabase(file,legacy);
  assert.equal(reopened.load('outbox').old.state,'SENDING');
  assert.deepEqual(Object.keys(reopened.load('inbox')),['received','new']);
  reopened.close();
}));

test('failed SQLite transition cannot report local custody or mutate in-memory journal',()=>temp(dir=>{
  const db=new DeliveryDatabase(path.join(dir,'delivery.sqlite'));
  const journal=new DeliveryJournal({},()=>{},db);
  const message={messageId:'one',messageType:'PAYMENT_FORWARD',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
  db.db.exec('DROP TABLE delivery_outbox');
  assert.throws(()=>journal.outgoing(message,{intentId:'intent-one',transport:'tcp',to:'node-b'}));
  assert.equal(journal.snapshot().outbox.length,0);
  db.close();
}));

test('node identity and unsent delivery survive JSON-to-SQLite migration and restart',()=>temp(dir=>{
  const service={routes:[],adapters:new Map(),store:{get:()=>null,all:()=>[]}};
  const now=new Date().toISOString(),later=new Date(Date.now()+60000).toISOString();
  const old={peerKeys:{},advertisements:{},seen:{},meshReceipts:{},sequence:0,events:[],queuedBundles:[],deliveryOutbox:{legacy:{messageId:'legacy',intentId:'intent',messageType:'PAYMENT_FORWARD',state:'SENDING',createdAt:now,expiresAt:later,recovery:{type:'payment',payload:{originNodeId:'node-a',intent:{id:'intent',expiresAt:later}}}}},deliveryInbox:{}};
  fs.writeFileSync(path.join(dir,'mesh-state.json'),JSON.stringify(old));
  const a=new MeshNode({nodeId:'node-b',dataDir:dir,peers:{},service});
  const publicKey=a.identity.publicKey;
  a.recoverOutbox();
  assert.equal(a.state.queuedBundles.length,1);
  a.deliveryDatabase.close();
  const b=new MeshNode({nodeId:'node-b',dataDir:dir,peers:{},service});
  assert.equal(b.identity.publicKey,publicKey);
  assert.equal(b.deliveries.snapshot().outbox[0].state,'QUEUED');
  assert.equal(b.deliveries.pendingRecovery().length,0);
  assert.equal(b.state.queuedBundles.length,1);
  b.deliveryDatabase.close();
}));

test('inbox and replay marker commit together and reject a replay after restart',()=>temp(dir=>{
  const file=path.join(dir,'delivery.sqlite'),message={messageId:'signed-message',messageType:'PAYMENT_FORWARD',expiresAt:new Date(Date.now()+60000).toISOString()};
  const first=new DeliveryDatabase(file);
  const journal=new DeliveryJournal({},()=>{},first);
  journal.accept(message,{from:'node-a',transport:'tcp'});
  assert.equal(first.load('inbox')['signed-message'].from,'node-a');
  assert.ok(first.seen()['signed-message']);
  first.close();
  const second=new DeliveryDatabase(file),restarted=new DeliveryJournal({},()=>{},second);
  assert.throws(()=>restarted.accept(message,{from:'node-a',transport:'libp2p'}),/REPLAY/);
  assert.equal(restarted.snapshot().inbox.length,1);
  second.close();
}));

test('failed inbox write rolls back replay marker and never claims receipt',()=>temp(dir=>{
  const db=new DeliveryDatabase(path.join(dir,'delivery.sqlite'));
  const journal=new DeliveryJournal({},()=>{},db);
  db.db.exec('DROP TABLE delivery_inbox');
  const message={messageId:'retryable',messageType:'PAYMENT_FORWARD',expiresAt:new Date(Date.now()+60000).toISOString()};
  assert.throws(()=>journal.accept(message,{from:'node-a',transport:'tcp'}));
  assert.equal(db.seen().retryable,undefined);
  assert.equal(journal.state.seen.retryable,undefined);
  db.close();
}));

test('pre-migration replay IDs remain blocked after the first database open',()=>temp(dir=>{
  const file=path.join(dir,'delivery.sqlite'),expiry=Date.now()+60000;
  const db=new DeliveryDatabase(file,{seen:{already:expiry}});
  const journal=new DeliveryJournal({},()=>{},db);
  assert.throws(()=>journal.accept({messageId:'already',messageType:'PEER_HELLO',expiresAt:new Date(expiry).toISOString()},{from:'node-a',transport:'tcp'}),/REPLAY/);
  db.close();
}));
