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
  constructor(port, keyFile, receive, {mtu=65536,fragmentFile=null,faultDropOnceIndices=[]}={}) {
    if(!Number.isInteger(mtu)||mtu<256||mtu>65536) throw new Error('INVALID_LIBP2P_MTU');
    this.id='libp2p'; this.port=port; this.keyFile=keyFile; this.receive=receive; this.node=null; this.messageHandler=null;this.mtu=mtu;
    this.reassembler=new Reassembler(fragmentFile);
    this.completedFragments=new Map();
    this.faultDropOnceIndices=new Set(faultDropOnceIndices);
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
        if(packet?.transportMode==='fragment-status-v1') {
          const complete=this.completedFragments.get(packet.messageId);
          const validComplete=complete?.hash===packet.originalPayloadHash && complete.expiresAt>Date.now();
          const partial=this.reassembler.status(packet.messageId,packet.originalPayloadHash);
          stream.send(wireEncode({transportMode:'fragment-status-v1',messageId:packet.messageId,originalPayloadHash:packet.originalPayloadHash,complete:Boolean(validComplete),fragmentCount:validComplete?complete.count:partial?.fragmentCount??0,missing:validComplete?[]:partial?.missing??null}));
          await stream.close();return;
        }
        if(Array.isArray(packet)) {
          const fragment=decodeFragment(bytes);
          const completed=this.completedFragments.get(fragment.messageId);
          if(completed && completed.expiresAt>Date.now()) {
            if(completed.hash!==fragment.originalPayloadHash) throw new Error('FRAGMENT_CONFLICT');
            await stream.close();return;
          }
          const result=this.reassembler.accept(fragment);
          if(result.status!=='complete') {await stream.close();return;}
          for(const [id,entry] of this.completedFragments) if(entry.expiresAt<=Date.now()) this.completedFragments.delete(id);
          if(this.completedFragments.size>=128) this.completedFragments.delete(this.completedFragments.keys().next().value);
          this.completedFragments.set(fragment.messageId,{hash:fragment.originalPayloadHash,count:fragment.fragmentCount,expiresAt:Date.parse(fragment.expiresAt)});
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
  async submit(peer,payload,{messageId=randomUUID(),expiresAt=new Date(Date.now()+60000).toISOString(),expectedRemotePeer=null}={}) {
    if(!peer.p2p) throw new Error('LIBP2P_NOT_CONFIGURED');
    if(!(payload instanceof Uint8Array)||payload.length>60000) throw new Error('INVALID_TRANSPORT_PAYLOAD');
    const wrapper=wireEncode({transportMode:'async-v1',messageId,expiresAt,payload:Buffer.from(payload)});
    const fragments=wrapper.length<=this.mtu?null:fragmentEnvelope(wrapper,{mtu:this.mtu,messageId,expiresAt});
    const packets=fragments?fragments.map(encodeFragment):[wrapper];
    const connection=await this.node.dial(multiaddr(peer.p2p),{signal:AbortSignal.timeout(2500)});
    if(expectedRemotePeer && connection.remotePeer.toString()!==expectedRemotePeer) throw new Error('LIBP2P_IDENTITY_MISMATCH');
    let sent=0;const retransmitted=[];
    const transmit=async indexes=>{
      for(const index of indexes) {
        if(this.faultDropOnceIndices.delete(index)) continue;
        const stream=await connection.newStream(DELIVERY_PROTOCOL,{signal:AbortSignal.timeout(2500)});
        try {stream.send(packets[index]);await stream.close();sent++;}
        catch(error) {stream.abort(error);throw error;}
      }
    };
    await transmit(packets.map((_,index)=>index));
    if(fragments) {
      for(let attempt=0;attempt<3;attempt++) {
        const stream=await connection.newStream(DELIVERY_PROTOCOL,{signal:AbortSignal.timeout(2500)});
        let status;
        try {
          stream.send(wireEncode({transportMode:'fragment-status-v1',messageId,originalPayloadHash:fragments[0].originalPayloadHash}));
          await stream.close();status=await read(stream);
        } catch(error) {stream.abort(error);throw error;}
        if(status?.transportMode!=='fragment-status-v1'||status.messageId!==messageId||status.originalPayloadHash!==fragments[0].originalPayloadHash) throw new Error('INVALID_FRAGMENT_STATUS');
        if(status.complete && status.fragmentCount===packets.length && Array.isArray(status.missing) && !status.missing.length) break;
        const missing=status.missing===null?packets.map((_,index)=>index):status.missing;
        if(!Array.isArray(missing)||(status.missing!==null && status.fragmentCount!==packets.length)||missing.length>packets.length||missing.some(index=>!Number.isInteger(index)||index<0||index>=packets.length)||new Set(missing).size!==missing.length) throw new Error('INVALID_FRAGMENT_STATUS');
        if(attempt===2) throw new Error('FRAGMENT_DELIVERY_INCOMPLETE');
        retransmitted.push(...missing);await transmit(missing);
      }
    }
    return {submissionId:randomUUID(),transportId:this.id,peerId:peer.id,acceptedAt:new Date().toISOString(),state:'ACCEPTED_LOCAL',fragmentsSent:sent,retransmittedIndexes:retransmitted};
  }
  async send(peer,message) {
    if (!peer.p2p) throw new Error('LIBP2P_NOT_CONFIGURED');
    const stream=await this.node.dialProtocol(multiaddr(peer.p2p),VERSION,{signal:AbortSignal.timeout(2500)});
    try { stream.send(wireEncode(message)); await stream.close(); return await read(stream); } catch(error) { stream.abort(error); throw error; }
  }
  health() { return { id:this.id, type:'libp2p', online:Boolean(this.node?.status==='started'), peerId:this.peerId, mtu:this.mtu, security:'Noise', implementationStatus:'TESTED_SOFTWARE' }; }
  capabilities() { return {transportId:this.id,transportType:'libp2p',implementationStatus:'IMPLEMENTED_AND_TESTED',online:Boolean(this.node?.status==='started'),mtu:this.mtu,maxPayload:65536,latencyClass:'low',estimatedLatencyMs:null,estimatedBandwidth:null,reliability:null,metered:false,costWeight:1,energyCost:null,supportsDiscovery:true,supportsBroadcast:false,supportsDirectPeer:true,supportsAcknowledgement:true,supportsFragmentation:true,supportsStoreForward:false,securityProperties:{encrypted:true,authenticatedBy:'Noise-peer-id-and-signed-mesh-envelope'}}; }
}
