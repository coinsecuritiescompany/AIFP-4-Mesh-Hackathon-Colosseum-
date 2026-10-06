import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { wireEncode, wireDecode } from '../protocol.js';
import { fragmentEnvelope, encodeFragment, decodeFragment } from '../framing/fragmenter.js';
import { Reassembler } from '../framing/reassembler.js';

const MAX_WIRE = 65536;
const MAX_BUFFER = 262144;
function packets(message, mtu) {
  const bytes = wireEncode(message);
  if(bytes.length > MAX_WIRE) throw new Error('WIRE_TOO_LARGE');
  if(bytes.length <= mtu) return [bytes];
  return fragmentEnvelope(bytes,{mtu,expiresAt:message.expiresAt,messageId:message.messageId}).map(encodeFragment);
}
function frame(bytes) {
  const header=Buffer.allocUnsafe(4); header.writeUInt32BE(bytes.length,0);
  return Buffer.concat([header,bytes]);
}
function writeMessage(socket,message,mtu) {
  for(const packet of packets(message,mtu)) socket.write(frame(packet));
}
function attach(socket, receive, reject, reassembler) {
  let buffer=Buffer.alloc(0),done=false;
  function fail(error) { if(done) return; done=true; socket.destroy(); reject(error); }
  socket.on('data',chunk=>{
    if(done) return;
    buffer=Buffer.concat([buffer,chunk]);
    if(buffer.length>MAX_BUFFER) return fail(new Error('TCP_BUFFER_FULL'));
    try {
      while(buffer.length>=4) {
        const size=buffer.readUInt32BE(0);
        if(size<1 || size>MAX_WIRE) return fail(new Error('WIRE_TOO_LARGE'));
        if(buffer.length<size+4) break;
        const packet=buffer.subarray(4,size+4); buffer=buffer.subarray(size+4);
        let message;
        const decoded=wireDecode(packet);
        if(Array.isArray(decoded)) {
          const result=reassembler.accept(decodeFragment(packet));
          if(result.status!=='complete') continue;
          message=wireDecode(result.bytes);
        } else message=decoded;
        done=true; socket.removeAllListeners('data'); socket.on('data',()=>socket.destroy());
        receive(message);
        break;
      }
    } catch(error) {fail(error);}
  });
  socket.on('error',fail);
  socket.on('end',()=>fail(new Error('TCP_CLOSED_BEFORE_COMPLETE_ENVELOPE')));
  socket.on('close',()=>fail(new Error('TCP_CLOSED_BEFORE_RESPONSE')));
  socket.on('timeout',()=>fail(new Error('TCP_TIMEOUT')));
  socket.setTimeout(30000);
}
export class TcpTransport {
  constructor(port, receive, {mtu=4096, fragmentFile=null, bindHost='127.0.0.1'}={}) {
    if(!Number.isInteger(mtu) || mtu<256 || mtu>MAX_WIRE) throw new Error('INVALID_TCP_MTU');
    this.bindHost=bindHost; this.id='tcp'; this.port=port; this.receive=receive; this.server=null; this.enabled=true; this.mtu=mtu;this.messageHandler=null;
    this.reassembler=new Reassembler(fragmentFile);
  }
  async start() {
    this.server=net.createServer({allowHalfOpen:true},socket=>{
      attach(socket,async request=>{
        if(request?.transportMode==='async-v1') {
          if(!this.messageHandler || !(request.payload instanceof Uint8Array) || request.payload.length>MAX_WIRE) {socket.destroy();return;}
          const payload=Buffer.from(request.payload),metadata={transportId:this.id,remoteAddress:socket.remoteAddress};
          socket.end();
          queueMicrotask(()=>Promise.resolve().then(()=>this.messageHandler(payload,metadata)).catch(()=>{}));
          return;
        }
        try { writeMessage(socket,await this.receive(request,'tcp'),this.mtu); socket.end(); }
        catch {socket.destroy();}
      },()=>socket.destroy(),this.reassembler);
    });
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,this.bindHost,resolve);});
    this.port=this.server.address().port;
  }
  async stop() {if(this.server?.listening) await new Promise(resolve=>this.server.close(resolve)); this.server=null;}
  async setOnline(online) {this.enabled=online;if(online&&!this.server?.listening) await this.start();if(!online) await this.stop();}
  onMessage(handler) {if(typeof handler!=='function') throw new Error('INVALID_MESSAGE_HANDLER');this.messageHandler=handler;}
  async submit(peer,payload,{messageId=randomUUID(),expiresAt=new Date(Date.now()+60000).toISOString()}={}) {
    if(!this.enabled||!peer.tcp) throw new Error('TCP_NOT_CONFIGURED');
    if(!(payload instanceof Uint8Array) || payload.length>MAX_WIRE) throw new Error('INVALID_TRANSPORT_PAYLOAD');
    const wrapper={transportMode:'async-v1',messageId,expiresAt,payload:Buffer.from(payload)};
    const frames=packets(wrapper,this.mtu).map(frame);
    return new Promise((resolve,reject)=>{
      const socket=net.connect(peer.tcp.port,peer.tcp.host);
      let finished=false;
      const fail=error=>{if(!finished){finished=true;socket.destroy();reject(error);}};
      socket.once('error',fail);
      socket.once('connect',()=>{
        for(const bytes of frames) socket.write(bytes);
        socket.end(()=>{if(!finished){finished=true;resolve({submissionId:randomUUID(),transportId:this.id,peerId:peer.id,acceptedAt:new Date().toISOString(),state:'ACCEPTED_LOCAL'});}});
      });
    });
  }
  async send(peer,message) {
    if(!this.enabled||!peer.tcp) throw new Error('TCP_NOT_CONFIGURED');
    return new Promise((resolve,reject)=>{
      const socket=net.connect(peer.tcp.port,peer.tcp.host,()=>{
        try {writeMessage(socket,message,this.mtu);} catch(error){socket.destroy();reject(error);}
      });
      attach(socket,resolve,reject,new Reassembler());
    });
  }
  health() {return {id:this.id,type:'tcp',online:Boolean(this.server?.listening),mtu:this.mtu,implementationStatus:'TESTED_SOFTWARE'};}
  capabilities() {return {transportId:this.id,transportType:'tcp',implementationStatus:'IMPLEMENTED_AND_TESTED',online:Boolean(this.server?.listening),mtu:this.mtu,maxPayload:MAX_WIRE,latencyClass:'low',estimatedLatencyMs:null,estimatedBandwidth:null,reliability:null,metered:false,costWeight:1,energyCost:null,supportsDiscovery:false,supportsBroadcast:false,supportsDirectPeer:true,supportsAcknowledgement:true,supportsFragmentation:true,supportsStoreForward:false,securityProperties:{encrypted:false,authenticatedBy:'signed-mesh-envelope'}};}
}
