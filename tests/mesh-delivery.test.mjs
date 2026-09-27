import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryJournal } from '../src/mesh/delivery-journal.js';

test('persistent delivery journal separates peer acknowledgement from verified settlement',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-delivery-')), file=path.join(dir,'journal.json');
  try {
    const state={},persist=()=>fs.writeFileSync(file,JSON.stringify(state));
    const journal=new DeliveryJournal(state,persist),message={messageId:'message-1',messageType:'PAYMENT_FORWARD',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
    journal.outgoing(message,{intentId:'intent-1',transport:'tcp',to:'node-b'});
    journal.mark(message.messageId,'SENDING'); journal.mark(message.messageId,'SENT');journal.mark(message.messageId,'ACKNOWLEDGED');
    assert.equal(journal.snapshot().outbox[0].state,'ACKNOWLEDGED');
    journal.incoming({...message,messageId:'receipt-1',messageType:'PAYMENT_RECEIPT'},{from:'node-c',transport:'libp2p'});
    const restored=new DeliveryJournal(JSON.parse(fs.readFileSync(file,'utf8')),()=>{});
    assert.equal(restored.snapshot().inbox[0].messageType,'PAYMENT_RECEIPT');
    restored.deliveredIntent('intent-1');
    assert.equal(restored.snapshot().outbox[0].state,'DELIVERED');
    assert.equal(restored.mark(message.messageId,'SENT').state,'DELIVERED');
    assert.throws(()=>restored.incoming({...message,messageId:'receipt-1'},{from:'node-c',transport:'libp2p'}),/DUPLICATE_INBOUND/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
