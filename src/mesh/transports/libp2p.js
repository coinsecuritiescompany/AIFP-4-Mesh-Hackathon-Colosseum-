import fs from 'node:fs';
import path from 'node:path';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { identify } from '@libp2p/identify';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { multiaddr } from '@multiformats/multiaddr';
import { VERSION, wireEncode, wireDecode } from '../protocol.js';

async function read(stream) {
  const parts = []; let total = 0;
  for await (const part of stream) { const bytes = Buffer.from(part.subarray()); total += bytes.length; if (total > 65536) throw new Error('WIRE_TOO_LARGE'); parts.push(bytes); }
  return wireDecode(Buffer.concat(parts));
}
export class Libp2pTransport {
  constructor(port, keyFile, receive) { this.id='libp2p'; this.port=port; this.keyFile=keyFile; this.receive=receive; this.node=null; }
  async start() {
    fs.mkdirSync(path.dirname(this.keyFile),{recursive:true,mode:0o700});
    if (!fs.existsSync(this.keyFile)) fs.writeFileSync(this.keyFile, Buffer.from(privateKeyToProtobuf(await generateKeyPair('Ed25519'))),{mode:0o600,flag:'wx'});
    const privateKey=privateKeyFromProtobuf(fs.readFileSync(this.keyFile));
    this.node=await createLibp2p({ privateKey, addresses:{listen:[`/ip4/${process.env.MESH_P2P_BIND ?? '0.0.0.0'}/tcp/${this.port}`]}, transports:[tcp()], connectionEncrypters:[noise()], streamMuxers:[yamux()], services:{identify:identify()} });
    this.node.handle(VERSION, async (stream,connection) => {
      try { const response=await this.receive(await read(stream),'libp2p',connection.remotePeer.toString()); stream.send(wireEncode(response)); await stream.close(); } catch(error) { stream.abort(error); }
    });
    this.peerId=this.node.peerId.toString();
  }
  async stop() { if(this.node) await this.node.stop(); }
  async send(peer,message) {
    if (!peer.p2p) throw new Error('LIBP2P_NOT_CONFIGURED');
    const stream=await this.node.dialProtocol(multiaddr(peer.p2p),VERSION,{signal:AbortSignal.timeout(2500)});
    try { stream.send(wireEncode(message)); await stream.close(); return await read(stream); } catch(error) { stream.abort(error); throw error; }
  }
  health() { return { id:this.id, type:'libp2p', online:Boolean(this.node?.status==='started'), peerId:this.peerId, mtu:65536, security:'Noise', implementationStatus:'TESTED_SOFTWARE' }; }
}
