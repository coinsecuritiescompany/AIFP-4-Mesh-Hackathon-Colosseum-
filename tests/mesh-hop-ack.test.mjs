import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadIdentity } from '../src/mesh/identity.js';
import { envelope, validateEnvelope } from '../src/mesh/protocol.js';
import { signHopAcceptance, verifyHopAcceptance } from '../src/mesh/delivery/hop-ack.js';
import { DeliveryDatabase } from '../src/mesh/storage/delivery-database.js';

test('signed durable hop acceptance binds bundle, delivery, message, sender and receiver',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-hop-ack-'));
  try {
    const a=loadIdentity(path.join(dir,'a.json'),'node-a'),b=loadIdentity(path.join(dir,'b.json'),'node-b');
    const msg=envelope(a,'PAYMENT_FORWARD',{bundleId:'bundle-one',payload:'signed'}, {destinationNodeId:'node-b'});
    const hop={bundleId:'bundle-one',hopDeliveryId:'hop-one',messageId:msg.messageId,senderNodeId:'node-a',nextHop:'node-b',bundleHash:'a'.repeat(64)};
    const ack=signHopAcceptance(b,hop,msg);
    assert.equal(verifyHopAcceptance(ack,hop,b.publicKey),true);
    for(const field of ['bundleId','hopDeliveryId','acceptedMessageId','senderNodeId','receiverNodeId','bundleHash']) assert.throws(()=>verifyHopAcceptance({...ack,[field]:'changed'},hop,b.publicKey));
    assert.throws(()=>verifyHopAcceptance(ack,{...hop,messageId:'other'},b.publicKey),/INVALID_HOP_ACCEPTANCE/);
    assert.throws(()=>verifyHopAcceptance(ack,hop,a.publicKey),/INVALID_HOP_SIGNATURE/);
    assert.throws(()=>verifyHopAcceptance(ack,hop,b.publicKey,Date.parse(ack.expiresAt)+1),/INVALID_HOP_ACCEPTANCE/);
    const wrapped=envelope(b,'HOP_ACCEPTED',{ack,path:['node-b']},{destinationNodeId:'node-a'});
    assert.equal(validateEnvelope(wrapped,b.publicKey).messageType,'HOP_ACCEPTED');
    const db=new DeliveryDatabase(path.join(dir,'delivery.sqlite'));
    db.acceptInbound(wrapped,{messageId:wrapped.messageId,messageType:wrapped.messageType,from:'node-b'});
    assert.throws(()=>db.acceptInbound(wrapped,{messageId:wrapped.messageId,messageType:wrapped.messageType,from:'node-b'}),/REPLAY/);
    db.close();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
