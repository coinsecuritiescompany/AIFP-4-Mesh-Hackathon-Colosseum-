import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fragmentEnvelope, encodeFragment, decodeFragment } from '../src/mesh/framing/fragmenter.js';
import { Reassembler } from '../src/mesh/framing/reassembler.js';
import { TcpTransport } from '../src/mesh/transports/tcp.js';
import { Libp2pTransport } from '../src/mesh/transports/libp2p.js';

const expiry=()=>new Date(Date.now()+60000).toISOString();
const sample=()=>Buffer.from('AIFP4 signed envelope '.repeat(120));
const parts=(bytes=sample())=>fragmentEnvelope(bytes,{mtu:400,expiresAt:expiry()});
test('out-of-order fragments reconstruct exact envelope within MTU',()=>{
  const input=sample(), fragments=parts(input), receiver=new Reassembler();
  assert.ok(fragments.length>1);
  let result;
  for(const fragment of fragments.reverse()) { const wire=encodeFragment(fragment); assert.ok(wire.length<=400); result=receiver.accept(decodeFragment(wire)); }
  assert.equal(result.status,'complete'); assert.deepEqual(result.bytes,input);
});
test('missing fragment never produces a payment envelope',()=>{
  const fragments=parts(), receiver=new Reassembler();
  for(const fragment of fragments.slice(1)) assert.equal(receiver.accept(fragment).status,'incomplete');
});
test('duplicate fragments are suppressed; changed duplicates are rejected',()=>{
  const [first]=parts(), receiver=new Reassembler();
  assert.equal(receiver.accept(first).status,'incomplete');
  assert.equal(receiver.accept(first).status,'duplicate');
  assert.throws(()=>receiver.accept({...first,fragmentCount:first.fragmentCount+1}),/FRAGMENT_CONFLICT/);
});
test('corrupted fragment, stale fragment and oversized envelope are rejected',()=>{
  const [first]=parts();
  assert.throws(()=>new Reassembler().accept({...first,payload:Uint8Array.from([1])}),/CORRUPT_FRAGMENT/);
  assert.throws(()=>new Reassembler().accept(first,Date.parse(first.expiresAt)+1),/INVALID_FRAGMENT/);
  assert.throws(()=>parts(Buffer.alloc(65537)),/INVALID_FRAGMENT_MTU_OR_SIZE/);
});
test('reassembly refuses mismatched final hash and excessive queues',()=>{
  const [first]=parts(), receiver=new Reassembler(null,{maxPending:1});
  assert.equal(receiver.accept({...first,originalPayloadHash:'a'.repeat(64)}).status,'incomplete');
  assert.throws(()=>receiver.accept(parts(Buffer.from('another packet '.repeat(200)))[0]),/FRAGMENT_QUEUE_FULL/);
});
test('partial transfer survives restart in an independent persistent file',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-fragments-'));
  try {
    const file=path.join(root,'fragments.json'), fragments=parts(), first=new Reassembler(file);
    assert.equal(first.accept(fragments[0]).status,'incomplete');
    const second=new Reassembler(file); let result;
    for(const fragment of fragments.slice(1)) result=second.accept(fragment);
    assert.equal(result.status,'complete'); assert.deepEqual(result.bytes,sample());
    assert.equal(fs.statSync(file).mode & 0o777,0o600);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('persisted receiver reports only missing fragment indexes after restart',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-missing-'));
  try {
    const fragments=parts(Buffer.alloc(14000,7));
    const file=path.join(root,'partial.json');
    const first=new Reassembler(file);
    for(const fragment of fragments.filter(f=>![3,18].includes(f.fragmentIndex))) first.accept(fragment);
    const second=new Reassembler(file);
    const status=second.status(fragments[0].messageId,fragments[0].originalPayloadHash);
    assert.deepEqual(status.missing,[3,18]);
    assert.equal(second.status(fragments[0].messageId,'0'.repeat(64)),null);
    assert.equal(second.accept(fragments[18]).status,'incomplete');
    assert.equal(second.accept(fragments[3]).status,'complete');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('software transports expose shared framing while distinguishing bearer security',()=>{
  const tcp=new TcpTransport(0,()=>{}).capabilities();
  const p2p=new Libp2pTransport(0,'/unused',()=>{}).capabilities();
  for(const adapter of [tcp,p2p]) {
    assert.equal(adapter.implementationStatus,'IMPLEMENTED_AND_TESTED');
    assert.equal(adapter.supportsFragmentation,true);
    assert.equal(adapter.supportsDirectPeer,true);
    assert.ok(adapter.maxPayload>0);
  }
  assert.equal(tcp.securityProperties.encrypted,false);
  assert.equal(p2p.securityProperties.encrypted,true);
});
