import net from 'node:net';
import { wireEncode, wireDecode } from '../protocol.js';

const MAX = 65536;
function frame(value) { const bytes = wireEncode(value); if (bytes.length > MAX) throw new Error('WIRE_TOO_LARGE'); const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length); return Buffer.concat([header,bytes]); }
function attach(socket, resolve, reject, closeOnRead = true) {
  let buffer = Buffer.alloc(0), size = null;
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX + 4) { socket.destroy(); reject(new Error('WIRE_TOO_LARGE')); return; }
    if (size === null && buffer.length >= 4) { size = buffer.readUInt32BE(0); if (size > MAX) { socket.destroy(); reject(new Error('WIRE_TOO_LARGE')); return; } }
    if (size !== null && buffer.length >= size + 4) { socket.removeAllListeners('data'); if (closeOnRead) socket.end(); try { resolve(wireDecode(buffer.subarray(4, size + 4))); } catch (error) { reject(error); } }
  });
  socket.on('error', reject);
  socket.on('close', () => reject(new Error('TCP_CLOSED_BEFORE_RESPONSE')));
  socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP_TIMEOUT')); });
  socket.setTimeout(2500);
}
export class TcpTransport {
  constructor(port, receive) { this.id = 'tcp'; this.port = port; this.receive = receive; this.server = null; this.enabled=true; }
  async start() {
    this.server = net.createServer(socket => {
      attach(socket, async request => {
        try { socket.end(frame(await this.receive(request, 'tcp'))); } catch (error) { socket.destroy(); }
      }, () => socket.destroy(), false);
    });
    await new Promise((resolve,reject) => { this.server.once('error',reject); this.server.listen(this.port,'0.0.0.0',resolve); });
    this.port = this.server.address().port;
  }
  async stop() { if (this.server?.listening) await new Promise(resolve => this.server.close(resolve)); this.server=null; }
  async setOnline(online) { this.enabled=online; if(online && !this.server?.listening) await this.start(); if(!online) await this.stop(); }
  async send(peer, message) {
    if (!this.enabled || !peer.tcp) throw new Error('TCP_NOT_CONFIGURED');
    return await new Promise((resolve,reject) => {
      const socket = net.connect(peer.tcp.port, peer.tcp.host, () => socket.write(frame(message)));
      attach(socket, resolve, reject);
    });
  }
  health() { return { id:this.id, type:'tcp', online:Boolean(this.server?.listening), mtu:65536, implementationStatus:'TESTED_SOFTWARE' }; }
  capabilities() { return {transportId:this.id,transportType:'tcp',implementationStatus:'IMPLEMENTED_AND_TESTED',online:Boolean(this.server?.listening),mtu:65536,maxPayload:65536,latencyClass:'low',estimatedLatencyMs:null,estimatedBandwidth:null,reliability:null,metered:false,costWeight:1,energyCost:null,supportsDiscovery:false,supportsBroadcast:false,supportsDirectPeer:true,supportsAcknowledgement:true,supportsFragmentation:false,supportsStoreForward:false,securityProperties:{encrypted:false,authenticatedBy:'signed-mesh-envelope'}}; }
}
