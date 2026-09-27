import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { identify } from '@libp2p/identify';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { multiaddr } from '@multiformats/multiaddr';
import { VERSION, wireEncode, wireDecode } from '../protocol.js';
import { fragmentEnvelope, encodeFragment, decodeFragment } from '../framing/fragmenter.js';
import { Reassembler } from '../framing/reassembler.js';

const DELIVERY_PROTOCOL=`${VERSION}/delivery`;

async function readBytes(stream) {
  const parts = []; let total = 0;
  for await (const part of stream) { const bytes = Buffer.from(part.subarray()); total += bytes.length; if (total > 65536) throw new Error('WIRE_TOO_LARGE'); parts.push(bytes); }
  return Buffer.concat(parts);
}
async function read(stream) {return wireDecode(await readBytes(stream));}
export class Libp2pTransport {
  constructor(port, keyFile, receive, {mtu=65536,fragmentFile=null}={}) {
    if(!Number.isInteger(mtu)||mtu<256||mtu>65536) throw new Error('INVALID_LIBP2P_MTU');
    this.id='libp2p'; this.port=port; this.keyFile=keyFile; this.receive=receive; this.node=null; this.messageHandler=null;this.mtu=mtu;
    this.reassembler=new Reassembler(fragmentFile);
  }
  async start() {
    fs.mkdirSync(path.dirname(this.keyFile),{recursive:true,mode:0o700});
    if (!fs.existsSync(this.keyFile)) fs.writeFileSync(this.keyFile, Buffer.from(privateKeyToProtobuf(await generateKeyPair('Ed25519'))),{mode:0o600,flag:'wx'});
    const privateKey=privateKeyFromProtobuf(fs.readFileSync(this.keyFile));
    this.node=await createLibp2p({ privateKey, addresses:{listen:[`/ip4/${process.env.MESH_P2P_BIND ?? '0.0.0.0'}/tcp/${this.port}`]}, transports:[tcp()], connectionEncrypters:[noise()], streamMuxers:[yamux()], services:{identify:identify()} });
    this.node.handle(VERSION, async (stream,connection) => {
      try { const response=await this.receive(await read(stream),'libp2p',connection.remotePeer.toString()); stream.send(wireEncode(response)); await stream.close(); } catch(error) { stream.abort(error); }
    });
    this.node.handle(DELIVERY_PROTOCOL,async(stream,connection)=>{
      try {
        const bytes=await readBytes(stream);
        let packet=wireDecode(bytes);
        if(Array.isArray(packet)) {
          const result=this.reassembler.accept(decodeFragment(bytes));
          if(result.status!=='complete') {await stream.close();return;}
          packet=wireDecode(result.bytes);
        }
        if(packet?.transportMode!=='async-v1'||!(packet.payload instanceof Uint8Array)||packet.payload.length>65536||!this.messageHandler) throw new Error('INVALID_TRANSPORT_PAYLOAD');
        const payload=Buffer.from(packet.payload),metadata={transportId:this.id,remotePeer:connection.remotePeer.toString()};
        await stream.close();
        queueMicrotask(()=>Promise.resolve().then(()=>this.messageHandler(payload,metadata)).catch(()=>{}));
      } catch(error) { stream.abort(error); }
    });
    this.peerId=this.node.peerId.toString();
  }
  async stop() { if(this.node) await this.node.stop(); }
  onMessage(handler) {if(typeof handler!=='function') throw new Error('INVALID_MESSAGE_HANDLER');this.messageHandler=handler;}
  async submit(peer,payload,{messageId=randomUUID(),expiresAt=new Date(Date.now()+60000).toISOString()}={}) {
    if(!peer.p2p) throw new Error('LIBP2P_NOT_CONFIGURED');
    if(!(payload instanceof Uint8Array)||payload.length>60000) throw new Error('INVALID_TRANSPORT_PAYLOAD');
    const wrapper=wireEncode({transportMode:'async-v1',messageId,expiresAt,payload:Buffer.from(payload)});
    const packets=wrapper.length<=this.mtu?[wrapper]:fragmentEnvelope(wrapper,{mtu:this.mtu,messageId,expiresAt}).map(encodeFragment);
    const connection=await this.node.dial(multiaddr(peer.p2p),{signal:AbortSignal.timeout(2500)});
    for(const packet of packets) {
      const stream=await connection.newStream(DELIVERY_PROTOCOL,{signal:AbortSignal.timeout(2500)});
      try {stream.send(packet);await stream.close();}
      catch(error) {stream.abort(error);throw error;}
    }
    return {submissionId:randomUUID(),transportId:this.id,peerId:peer.id,acceptedAt:new Date().toISOString(),state:'ACCEPTED_LOCAL'};
  }
  async send(peer,message) {
    if (!peer.p2p) throw new Error('LIBP2P_NOT_CONFIGURED');
    const stream=await this.node.dialProtocol(multiaddr(peer.p2p),VERSION,{signal:AbortSignal.timeout(2500)});
    try { stream.send(wireEncode(message)); await stream.close(); return await read(stream); } catch(error) { stream.abort(error); throw error; }
  }
  health() { return { id:this.id, type:'libp2p', online:Boolean(this.node?.status==='started'), peerId:this.peerId, mtu:this.mtu, security:'Noise', implementationStatus:'TESTED_SOFTWARE' }; }
  capabilities() { return {transportId:this.id,transportType:'libp2p',implementationStatus:'IMPLEMENTED_AND_TESTED',online:Boolean(this.node?.status==='started'),mtu:this.mtu,maxPayload:65536,latencyClass:'low',estimatedLatencyMs:null,estimatedBandwidth:null,reliability:null,metered:false,costWeight:1,energyCost:null,supportsDiscovery:true,supportsBroadcast:false,supportsDirectPeer:true,supportsAcknowledgement:true,supportsFragmentation:true,supportsStoreForward:false,securityProperties:{encrypted:true,authenticatedBy:'Noise-peer-id-and-signed-mesh-envelope'}}; }
}
