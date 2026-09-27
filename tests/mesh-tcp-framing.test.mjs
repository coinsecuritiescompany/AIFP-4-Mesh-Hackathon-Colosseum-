import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { TcpTransport } from '../src/mesh/transports/tcp.js';
import { loadIdentity } from '../src/mesh/identity.js';
import { envelope, validateEnvelope, wireEncode } from '../src/mesh/protocol.js';
import { fragmentEnvelope, encodeFragment } from '../src/mesh/framing/fragmenter.js';

function sendFrames(port, fragments) {
  return new Promise((resolve,reject)=>{
    const socket=net.connect(port,'127.0.0.1',()=>{
      for(const f of fragments) {
        const data=encodeFragment(f),length=Buffer.alloc(4); length.writeUInt32BE(data.length);
        socket.write(Buffer.concat([length,data]));
      }
      socket.end();
    });
    socket.on('data',()=>{});
    socket.once('error',reject); socket.once('close',resolve);
  });
}
test('real TCP persists partial signed envelope, restarts, then processes complete payload once',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-tcp-parts-'));
  let server;
  try {
    const identity=loadIdentity(path.join(dir,'identity.json'),'node-test');
    const message=envelope(identity,'PEER_HELLO',{advertisements:[],padding:'x'.repeat(4000)});
    const fragments=fragmentEnvelope(wireEncode(message),{mtu:400,expiresAt:message.expiresAt,messageId:message.messageId});
    assert.ok(fragments.length>10);
    let received=0;
    const accept=async request=>{validateEnvelope(request,identity.publicKey);received++;return envelope(identity,'PEER_HELLO',{advertisements:[]});};
    const file=path.join(dir,'fragments.json');
    server=new TcpTransport(0,accept,{mtu:400,fragmentFile:file});await server.start();
    const port=server.port, split=Math.floor(fragments.length/2);
    await sendFrames(port,fragments.slice(0,split));
    assert.equal(received,0,'a partial envelope cannot reach the payment/protocol handler');
    assert.ok(fs.existsSync(file));
    await server.stop();
    server=new TcpTransport(port,accept,{mtu:400,fragmentFile:file});await server.start();
    await sendFrames(port,fragments.slice(split));
    assert.equal(received,1);
    await sendFrames(port,[{...fragments[0],payload:Uint8Array.from([1])}]);
    assert.equal(received,1,'corrupted frame is never delivered');
  } finally {await server?.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
