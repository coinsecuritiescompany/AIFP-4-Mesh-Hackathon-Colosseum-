import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { TcpTransport } from '../src/mesh/transports/tcp.js';
import { Libp2pTransport } from '../src/mesh/transports/libp2p.js';
import { wireEncode } from '../src/mesh/protocol.js';

test('TCP submit returns local acceptance before delayed application processing; fragmented bytes arrive intact',async()=>{
  const receiver=new TcpTransport(0,()=>{throw new Error('legacy path called');},{mtu:300});
  let finish,arrived;
  const gate=new Promise(resolve=>{finish=resolve;});
  const delivered=new Promise(resolve=>{arrived=resolve;});
  receiver.onMessage(async(bytes,metadata)=>{arrived({bytes,metadata});await gate;});
  await receiver.start();
  try {
    const payload=wireEncode({value:'x'.repeat(5000)});
    const submission=await new TcpTransport(0,()=>{} ,{mtu:300}).submit({id:'receiver',tcp:{host:'127.0.0.1',port:receiver.port}},payload);
    assert.equal(submission.state,'ACCEPTED_LOCAL');
    const received=await delivered;
    assert.equal(received.metadata.transportId,'tcp');
    assert.deepEqual(received.bytes,payload);
    finish();
  } finally {finish();await receiver.stop();}
});

test('libp2p submit uses a separate one-way Noise/Yamux stream without remote payment response',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-async-p2p-'));
  const port=30000+randomInt(10000);
  const a=new Libp2pTransport(port,path.join(dir,'a.key'),()=>{throw new Error('legacy path called');});
  const b=new Libp2pTransport(port+1,path.join(dir,'b.key'),()=>{throw new Error('legacy path called');});
  let finish,arrived;
  const gate=new Promise(resolve=>{finish=resolve;});
  const delivered=new Promise(resolve=>{arrived=resolve;});
  b.onMessage(async(bytes,metadata)=>{arrived({bytes,metadata});await gate;});
  try {
    await Promise.all([a.start(),b.start()]);
    const payload=wireEncode({message:'one-way delivery'});
    const submission=await a.submit({id:'node-b',p2p:`/ip4/127.0.0.1/tcp/${port+1}`},payload);
    assert.equal(submission.state,'ACCEPTED_LOCAL');
    const received=await delivered;
    assert.deepEqual(received.bytes,payload);
    assert.equal(received.metadata.remotePeer,a.peerId);
  } finally {finish();await Promise.all([a.stop(),b.stop()]);fs.rmSync(dir,{recursive:true,force:true});}
});
