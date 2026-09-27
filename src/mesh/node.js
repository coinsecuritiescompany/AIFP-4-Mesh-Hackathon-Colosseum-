import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../canonical.js';
import { evaluatePolicy } from '../policy.js';
import { envelope, validateEnvelope } from './protocol.js';
import { loadIdentity, verifySigned } from './identity.js';
import { planRoute, planNodeRoute } from './routing.js';
import { TcpTransport } from './transports/tcp.js';
import { Libp2pTransport } from './transports/libp2p.js';
import { DeliveryJournal } from './delivery-journal.js';
import { DeliveryDatabase } from './storage/delivery-database.js';

const TTL = 9000;
export class MeshNode {
  constructor({ nodeId, dataDir, peers, service, tcpPort = 4100, p2pPort = 4200, tickMs = 2000 }) {
    this.nodeId=nodeId; this.dataDir=dataDir; this.peers=peers; this.service=service; this.tickMs=tickMs;
    this.identity=loadIdentity(path.join(dataDir,'identity.json'),nodeId);
    this.file=path.join(dataDir,'mesh-state.json');
    this.state=fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file,'utf8')) : { peerKeys:{}, advertisements:{}, seen:{}, meshReceipts:{}, sequence:0, events:[] };
    this.state.queuedBundles ??=[];
    this.deliveryDatabase=new DeliveryDatabase(path.join(dataDir,'mesh-delivery.sqlite'),this.state);
    this.deliveries=new DeliveryJournal(this.state,()=>this.persist(),this.deliveryDatabase);
    this.links=new Map(); this.pending=new Map(); this.settling=new Map(); this.busy=false;
    const receive=(message,transport,remotePeer)=>this.receive(message,transport,remotePeer);
    this.transports=new Map([['tcp',new TcpTransport(tcpPort,receive,{mtu:Number(process.env.MESH_TCP_FRAME_MTU ?? 4096),fragmentFile:path.join(dataDir,'tcp-fragments.json')})],['libp2p',new Libp2pTransport(p2pPort,path.join(dataDir,'libp2p.key'),receive)]]);
  }
  persist() {
    fs.mkdirSync(this.dataDir,{recursive:true,mode:0o700});
    const tmp=`${this.file}.${process.pid}.tmp`;
    const {deliveryOutbox,deliveryInbox,seen,...legacyState}=this.state;
    fs.writeFileSync(tmp,JSON.stringify(legacyState),{mode:0o600}); fs.renameSync(tmp,this.file); fs.chmodSync(this.file,0o600);
  }
  event(type, fields={}) { this.state.events.push({ id:randomUUID(), type, nodeId:this.nodeId, timestamp:new Date().toISOString(), ...fields }); this.state.events=this.state.events.slice(-300); this.persist(); }
  capability() {
    const routes=this.service.routes.filter(r=>r.online && this.service.adapters.has(r.rail));
    return { nodeId:this.nodeId, publicKey:this.identity.publicKey, peerId:this.transports.get('libp2p').peerId, canRelay:true, canSettle:routes.length>0, assets:[...new Set(routes.map(r=>r.asset))], rails:[...new Set(routes.map(r=>r.rail))], feeBps:routes.length?Math.min(...routes.map(r=>r.feeBps)):0 };
  }
  advertise() {
    const data={...this.capability(),sequence:++this.state.sequence,expiresAt:Date.now()+TTL,links:[...this.links.values()].filter(l=>l.online).map(l=>({from:this.nodeId,to:l.to,transport:l.transport,online:true,cost:l.cost,reliability:l.reliability}))};
    const ad={data,signature:this.identity.sign(data)}; this.state.advertisements[this.nodeId]=ad; this.persist(); return ad;
  }
  merge(ads=[]) {
    if (!Array.isArray(ads) || ads.length>50) return;
    for(const ad of ads) {
      const data=ad?.data;
      if(!data || !/^[a-z0-9-]{1,48}$/.test(data.nodeId ?? '') || !verifySigned(data,ad.signature,data.publicKey) || !Number.isSafeInteger(data.sequence) || !Number.isFinite(data.expiresAt) || data.expiresAt<=Date.now() || data.expiresAt>Date.now()+30000 || !Array.isArray(data.links) || data.links.length>20 || !Array.isArray(data.assets) || !Array.isArray(data.rails)) continue;
      const known=this.state.peerKeys[data.nodeId]; if(known && known!==data.publicKey) continue;
      this.state.peerKeys[data.nodeId]=data.publicKey;
      const current=this.state.advertisements[data.nodeId]?.data;
      if(!current || current.sequence<data.sequence) { this.state.advertisements[data.nodeId]=ad; this.event('route.advertised',{peerId:data.nodeId}); }
    }
    this.persist();
  }
  catalog() { return Object.values(this.state.advertisements).filter(ad=>ad.data.expiresAt>Date.now()); }
  graph() {
    const links=[];
    for(const ad of this.catalog()) for(const edge of ad.data.links) {
      if(edge.from!==ad.data.nodeId || !/^[a-z0-9-]{1,48}$/.test(edge.to ?? '') || !this.state.advertisements[edge.to] || !['tcp','libp2p'].includes(edge.transport) || !Number.isFinite(edge.cost) || edge.cost<1 || edge.cost>10000 || !Number.isFinite(edge.reliability) || edge.reliability<0 || edge.reliability>1) continue;
      links.push(edge);
    }
    return links;
  }
  route(asset, excluded=[]) { return planRoute(this.nodeId,asset,this.graph(),this.catalog().map(a=>a.data),excluded); }
  async start() {
    for(const adapter of this.transports.values()) await adapter.start();
    this.advertise();
    this.recoverOutbox();
    await this.tick();
    this.timer=setInterval(()=>this.tick().catch(()=>{}),this.tickMs);
  }
  async stop() { clearInterval(this.timer); for(const adapter of this.transports.values()) await adapter.stop(); this.deliveryDatabase.close(); }
  recoverOutbox(startup=true) {
    for(const item of this.deliveries.pendingRecovery().filter(x=>startup || x.state==='FAILED_TEMPORARY')) {
      if(Date.parse(item.expiresAt)<=Date.now()) {this.deliveries.mark(item.messageId,'EXPIRED');continue;}
      try {
        const {type,payload}=item.recovery;
        if(type==='payment' && payload.originNodeId===this.nodeId) {
          const intent=this.service.store.get(item.intentId);
          if(!intent || ['settled','executing','expired'].includes(intent.state)) {this.deliveries.mark(item.messageId,intent?.state==='settled'?'DELIVERED':'FAILED_PERMANENT');continue;}
          intent.state='queued_for_mesh';this.service.store.save(intent);
        } else if(type==='payment' || type==='receipt') this.queueBundle(type,payload,item.expiresAt,item.intentId);
        else throw new Error('INVALID_OUTBOX_RECOVERY');
        this.deliveries.mark(item.messageId,'QUEUED');
        // The queue/intent is durable. A retry constructs a fresh signed hop
        // envelope so a lost ACK cannot bypass the receiver's replay cache.
        this.deliveries.clearRecovery(item.messageId);
      } catch(error) {this.event('route.failed',{intentId:item.intentId,reason:error.message});}
    }
  }
  async setTransportOnline(id, online) {
    if(id!=='tcp' || typeof online!=='boolean') throw new Error('INVALID_TRANSPORT');
    await this.transports.get(id).setOnline(online);
    for(const link of this.links.values()) if(link.transport===id && !online) link.online=false;
    this.advertise(); this.event(online?'transport.up':'transport.down',{transport:id});
    return this.transports.get(id).health();
  }
  async tick() {
    if(this.busy) return; this.busy=true;
    try {
      for(const peer of Object.values(this.peers)) for(const [transport, adapter] of this.transports) {
        if(!peer[transport==='libp2p'?'p2p':'tcp']) continue;
        const key=`${peer.id}:${transport}`, before=Date.now();
        try {
          const reply=await adapter.send(peer,envelope(this.identity,'PEER_HELLO',{advertisements:this.catalog()}, {destinationNodeId:peer.id}));
          validateEnvelope(reply,this.state.peerKeys[peer.id]);
          if(reply.sourceNodeId!==peer.id || reply.messageType!=='PEER_HELLO') throw new Error('PEER_MISMATCH');
          this.state.peerKeys[peer.id]=reply.publicKey; this.merge(reply.payload.advertisements);
          const prev=this.links.get(key), link={from:this.nodeId,to:peer.id,transport,online:true,cost:peer.cost?.[transport] ?? 20,reliability:1,latencyMs:Date.now()-before,lastSeen:new Date().toISOString()};
          this.links.set(key,link); if(!prev?.online) this.event('peer.connected',{peerId:peer.id,transport});
        } catch(error) {
          const prev=this.links.get(key);
          this.links.set(key,{from:this.nodeId,to:peer.id,transport,online:false,cost:peer.cost?.[transport] ?? 20,reliability:0,lastSeen:prev?.lastSeen ?? null,error:error.message});
          if(prev?.online) this.event('peer.disconnected',{peerId:peer.id,transport});
        }
      }
      this.advertise();
      this.recoverOutbox(false);
      for(const intent of this.service.store.all('intents').filter(i=>i.state==='queued_for_mesh')) await this.dispatch(intent.id).catch(()=>{});
      for(const item of [...this.state.queuedBundles].sort((a,b)=>(b.priority??0)-(a.priority??0) || a.nextAttempt-b.nextAttempt)) {
        if(Date.parse(item.expiresAt)<=Date.now()) { this.state.queuedBundles=this.state.queuedBundles.filter(x=>x.id!==item.id); this.event('bundle.expired',{intentId:item.intentId}); continue; }
        if(item.nextAttempt>Date.now()) continue;
        try {
          if(item.type==='payment') {
            const receipt=await this.forward(item.payload);
            await this.forwardReceipt({receipt,path:[this.nodeId]});
          } else await this.forwardReceipt(item.payload);
          this.state.queuedBundles=this.state.queuedBundles.filter(x=>x.id!==item.id); this.persist();
        } catch {
          item.attempts++; item.nextAttempt=Date.now()+Math.min(30000,1000*2**Math.min(item.attempts,5)); this.persist();
        }
      }
    } finally { this.busy=false; }
  }
  async receive(message,transport,remotePeer) {
    const peer=this.peers[message?.sourceNodeId];
    if(!peer || !peer[transport==='libp2p'?'p2p':'tcp']) throw new Error('UNKNOWN_PEER');
    const expectedPeerId=this.state.advertisements[peer.id]?.data.peerId;
    if(transport==='libp2p' && expectedPeerId && remotePeer!==expectedPeerId) throw new Error('LIBP2P_IDENTITY_MISMATCH');
    validateEnvelope(message,this.state.peerKeys[message.sourceNodeId]);
    if(message.destinationNodeId && message.destinationNodeId!==this.nodeId) throw new Error('WRONG_DESTINATION');
    this.deliveries.accept(message,{from:message.sourceNodeId,transport});
    this.state.peerKeys[message.sourceNodeId]=message.publicKey; this.persist();
    if(message.messageType==='PEER_HELLO') {
      this.merge(message.payload?.advertisements);
      return envelope(this.identity,'PEER_HELLO',{advertisements:this.catalog()},{destinationNodeId:message.sourceNodeId});
    }
    if(message.messageType==='PAYMENT_FORWARD') {
      try { const receipt=await this.receivePayment(message.payload, message.sourceNodeId,transport); return envelope(this.identity,'PAYMENT_RECEIPT',{receipt},{destinationNodeId:message.sourceNodeId}); }
      catch(error) {
        if(error.message==='QUEUED_FOR_MESH') return envelope(this.identity,'PAYMENT_ACK',{state:'queued_for_mesh'},{destinationNodeId:message.sourceNodeId});
        return envelope(this.identity,'PAYMENT_FAILED',{code:error.code ?? error.message},{destinationNodeId:message.sourceNodeId});
      }
    }
    if(message.messageType==='PAYMENT_RECEIPT') {
      const receipt=message.payload?.receipt;
      if(!receipt || !Array.isArray(message.payload.path) || message.payload.path.includes(this.nodeId) || message.payload.path.at(-1)!==message.sourceNodeId) throw new Error('INVALID_RECEIPT_PATH');
      if(receipt.originNodeId===this.nodeId) this.acceptReceipt(receipt);
      else {
        const payload={receipt,path:[...message.payload.path,this.nodeId]};
        try { await this.forwardReceipt(payload); }
        catch { this.queueBundle('receipt',payload,new Date(Date.now()+60000).toISOString(),receipt.intentId); }
      }
      return envelope(this.identity,'PAYMENT_ACK',{state:'received'},{destinationNodeId:message.sourceNodeId});
    }
    throw new Error('UNSUPPORTED_MESSAGE');
  }
  verifyPayload(payload) {
    const {intent,originNodeId,originPublicKey,originSignature,path:trail,transportPath}=payload ?? {};
    const originAd=payload?.originAdvertisement;
    // An accepted bundle can outlive a route advertisement while disconnected.
    // The signed payment expiry, rather than the discovery lease, bounds delivery.
    if(originAd?.data?.nodeId!==originNodeId || originAd.data.publicKey!==originPublicKey || !verifySigned(originAd.data,originAd.signature,originPublicKey)) throw new Error('INVALID_ORIGIN_ADVERTISEMENT');
    if(!this.state.peerKeys[originNodeId]) { this.state.peerKeys[originNodeId]=originPublicKey; this.persist(); }
    if(!intent || typeof originNodeId!=='string' || !Array.isArray(trail) || !Array.isArray(transportPath) || trail.length>8 || transportPath.length>8 || trail[0]!==originNodeId || this.state.peerKeys[originNodeId]!==originPublicKey || !verifySigned({intentHash:intent.intentHash,originNodeId,agent:payload.agent,policy:payload.policy,currentPolicy:payload.currentPolicy},originSignature,originPublicKey)) throw new Error('INVALID_ORIGIN');
    const fields=['protocol','version','id','idempotencyKey','agentId','agentPassportId','sponsorId','beneficiary','amountMinor','asset','purpose','createdAt','expiresAt','policyId','nonce'];
    if(sha256(Object.fromEntries(fields.map(k=>[k,intent[k]])))!==intent.intentHash || Date.parse(intent.expiresAt)<=Date.now() || !Number.isSafeInteger(intent.amountMinor) || intent.amountMinor<=0 || payload.policy?.id!==intent.policyId || payload.agent?.id!==intent.agentId || payload.agent?.policyId!==payload.currentPolicy?.id) throw new Error('INVALID_INTENT');
    if(new Set(trail).size!==trail.length || transportPath.length!==trail.length) throw new Error('ROUTING_LOOP');
  }
  async receivePayment(payload,previousHop,transport) {
    this.verifyPayload(payload);
    if(payload.path.includes(this.nodeId) || payload.path.at(-1)!==previousHop || payload.transportPath.at(-1)?.to!==this.nodeId || payload.transportPath.at(-1)?.transport!==transport) throw new Error('INVALID_PATH');
    const next={...payload,path:[...payload.path,this.nodeId]};
    this.event('bundle.received',{intentId:payload.intent.id,from:previousHop,transport});
    if(this.capability().canSettle && this.capability().assets.includes(payload.intent.asset)) return this.settle(next);
    try { return await this.forward(next); }
    catch(error) {
      if(error.message==='NO_MESH_ROUTE') { this.queueBundle('payment',next,next.intent.expiresAt,next.intent.id); throw new Error('QUEUED_FOR_MESH'); }
      throw error;
    }
  }
  async settle(payload) {
    const id=payload.intent.id;
    if(this.settling.has(id)) return this.settling.get(id);
    const task=this.#settle(payload); this.settling.set(id,task);
    try { return await task; } finally { this.settling.delete(id); }
  }
  async #settle(payload) {
    const intent=payload.intent, old=this.service.store.get(intent.id);
    if(old && old.intentHash!==intent.intentHash) throw new Error('IDEMPOTENCY_CONFLICT');
    if(this.state.meshReceipts[intent.id]) return this.state.meshReceipts[intent.id];
    if(old?.state==='executing') throw new Error('EXECUTION_UNCERTAIN');
    if(!old) {
      if(!this.service.store.find('policies',payload.policy.id)) this.service.store.add('policies',payload.policy);
      if(!this.service.store.find('policies',payload.currentPolicy.id)) this.service.store.add('policies',payload.currentPolicy);
      this.service.store.saveKind('agents',payload.agent);
      this.service.store.create({...intent,state:'authorized',receipt:null});
    }
    const completed=await this.service.execute(intent.id);
    if(completed.state!=='settled') throw new Error('SETTLEMENT_INCOMPLETE');
    const execution=completed.receipt.execution;
    const core={receiptId:completed.receipt.receiptId,intentId:intent.id,intentHash:intent.intentHash,originNodeId:payload.originNodeId,settlementNodeId:this.nodeId,meshPath:payload.path,transportPath:payload.transportPath,rail:execution.rail,network:execution.network,asset:intent.asset,amountMinor:intent.amountMinor,executionReference:execution.reference,settledAt:execution.settledAt,explorer:execution.explorer ?? null};
    const receipt={...core,receiptHash:sha256(core),settlementNodeSignature:this.identity.sign(core)};
    this.state.meshReceipts[intent.id]=receipt; this.persist(); this.event('receipt.created',{intentId:intent.id});
    queueMicrotask(()=>this.forwardReceipt({receipt,path:[this.nodeId]}).catch(()=>{
      try { this.queueBundle('receipt',{receipt,path:[this.nodeId]},new Date(Date.now()+60000).toISOString(),intent.id); }
      catch(error) { this.event('route.failed',{intentId:intent.id,reason:error.message}); }
    }));
    return receipt;
  }
  queueBundle(type,payload,expiresAt,intentId) {
    if(this.state.queuedBundles.some(x=>x.intentId===intentId && x.type===type)) return;
    const bytes=Buffer.byteLength(JSON.stringify(payload));
    if(!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now() || bytes>65536) throw new Error('INVALID_QUEUED_BUNDLE');
    const active=this.state.queuedBundles.filter(x=>Date.parse(x.expiresAt)>Date.now());
    const origin=type==='payment'?payload.originNodeId:payload.receipt?.settlementNodeId;
    if(active.length>=64 || active.filter(x=>(x.type==='payment'?x.payload.originNodeId:x.payload.receipt?.settlementNodeId)===origin).length>=16 || active.reduce((sum,x)=>sum+Buffer.byteLength(JSON.stringify(x.payload)),0)+bytes>4*1024*1024) throw new Error('MESH_QUEUE_FULL');
    this.state.queuedBundles=active;
    this.state.queuedBundles.push({id:randomUUID(),type,payload,expiresAt,intentId,priority:type==='receipt'?2:1,attempts:0,nextAttempt:Date.now()+1000});
    this.event('bundle.queued',{intentId,type});
  }
  async forwardReceipt(payload) {
    const {receipt,path:trail}=payload;
    if(!receipt || !Array.isArray(trail) || trail.length>8 || new Set(trail).size!==trail.length) throw new Error('INVALID_RECEIPT_PATH');
    if(receipt.originNodeId===this.nodeId) { this.acceptReceipt(receipt); return; }
    const failed=new Set();
    while(true) {
      const route=planNodeRoute(this.nodeId,receipt.originNodeId,this.graph(),[...trail.slice(0,-1),...failed]);
      if(!route?.edges.length) throw new Error('NO_RECEIPT_ROUTE');
      const edge=route.edges[0], peer=this.peers[edge.to];
      if(!peer) { failed.add(edge.to); continue; }
      let outbound;
      try {
        outbound=envelope(this.identity,'PAYMENT_RECEIPT',{receipt,path:trail},{originNodeId:receipt.settlementNodeId,destinationNodeId:edge.to,hopCount:trail.length,maxHops:8});
        this.deliveries.outgoing(outbound,{intentId:receipt.intentId,transport:edge.transport,to:edge.to,recovery:{type:'receipt',payload}});
        this.deliveries.mark(outbound.messageId,'SENDING');
        let response;
        try {response=await this.transports.get(edge.transport).send(peer,outbound);}
        catch(error) {this.deliveries.mark(outbound.messageId,'FAILED_TEMPORARY',error.message);throw error;}
        this.deliveries.mark(outbound.messageId,'SENT');
        validateEnvelope(response,this.state.peerKeys[edge.to]);
        if(response.sourceNodeId!==edge.to || response.messageType!=='PAYMENT_ACK') throw new Error('RECEIPT_NOT_ACKED');
        this.deliveries.mark(outbound.messageId,'ACKNOWLEDGED');
        this.event('receipt.forwarded',{intentId:receipt.intentId,to:edge.to,transport:edge.transport}); return;
      } catch(error) {
        if(outbound && this.state.deliveryOutbox[outbound.messageId]?.recovery) this.deliveries.mark(outbound.messageId,'FAILED_TEMPORARY',error.message);
        failed.add(edge.to);
      }
    }
  }
  verifyReceipt(receipt,intent) {
    if(!receipt || receipt.intentId!==intent.id || receipt.intentHash!==intent.intentHash || receipt.originNodeId!==this.nodeId) throw new Error('INVALID_RECEIPT');
    const {receiptHash,settlementNodeSignature,...core}=receipt;
    const key=this.state.peerKeys[receipt.settlementNodeId];
    if(!key || receiptHash!==sha256(core) || !verifySigned(core,settlementNodeSignature,key)) throw new Error('INVALID_RECEIPT_SIGNATURE');
    return true;
  }
  acceptReceipt(receipt) {
    const intent=this.service.store.get(receipt.intentId);
    if(!intent) throw new Error('UNKNOWN_INTENT');
    if(intent.state==='settled') return intent;
    this.verifyReceipt(receipt,intent);
    intent.receipt=receipt; intent.state='settled'; intent.meshPath=receipt.meshPath; intent.transportPath=receipt.transportPath; intent.receiptVerified=true;
    this.service.store.add('receipts',receipt);
    this.service.store.add('transactions',{id:randomUUID(),intentId:intent.id,agentId:intent.agentId,beneficiary:intent.beneficiary,amountMinor:intent.amountMinor,asset:intent.asset,rail:receipt.rail,state:'settled',reference:receipt.executionReference,createdAt:receipt.settledAt});
    this.service.store.save(intent); this.deliveries.deliveredIntent(intent.id); this.event('receipt.received',{intentId:intent.id,settlementNodeId:receipt.settlementNodeId}); return intent;
  }
  async forward(payload) {
    const excluded=[...payload.path.slice(0,-1)];
    const failed=new Set();
    while(true) {
      const route=this.route(payload.intent.asset,[...excluded,...failed]);
      if(!route || !route.edges.length) throw new Error('NO_MESH_ROUTE');
      const edge=route.edges[0], peer=this.peers[edge.to];
      if(!peer) { failed.add(edge.to); continue; }
      const outbound={...payload,transportPath:[...payload.transportPath,{from:this.nodeId,to:edge.to,transport:edge.transport}]};
      try {
        this.event('bundle.forwarded',{intentId:payload.intent.id,to:edge.to,transport:edge.transport});
        const outgoing=envelope(this.identity,'PAYMENT_FORWARD',outbound,{originNodeId:payload.originNodeId,destinationNodeId:edge.to,hopCount:payload.path.length,maxHops:8,expiresAt:payload.intent.expiresAt});
        this.deliveries.outgoing(outgoing,{intentId:payload.intent.id,transport:edge.transport,to:edge.to,recovery:{type:'payment',payload}});
        this.deliveries.mark(outgoing.messageId,'SENDING');
        let response;
        try { response=await this.transports.get(edge.transport).send(peer,outgoing); this.deliveries.mark(outgoing.messageId,'SENT'); }
        catch(error) {this.deliveries.mark(outgoing.messageId,'FAILED_TEMPORARY',error.message);throw error;}
        validateEnvelope(response,this.state.peerKeys[edge.to]);
        if(response.sourceNodeId!==edge.to) throw new Error('PEER_MISMATCH');
        if(response.messageType==='PAYMENT_RECEIPT') {this.deliveries.mark(outgoing.messageId,'ACKNOWLEDGED');return response.payload.receipt;}
        if(response.messageType==='PAYMENT_ACK') this.deliveries.mark(outgoing.messageId,'ACKNOWLEDGED');
        if(response.payload?.code==='EXECUTION_UNCERTAIN') throw new Error('EXECUTION_UNCERTAIN');
        throw new Error(response.payload?.code ?? 'PAYMENT_FAILED');
      } catch(error) {
        if(error.message==='EXECUTION_UNCERTAIN') throw error;
        failed.add(edge.to); this.event('mesh.rerouted',{intentId:payload.intent.id,failedPeer:edge.to});
      }
    }
  }
  async dispatch(id) {
    if(this.pending.has(id)) return this.pending.get(id);
    const promise=this.#dispatch(id); this.pending.set(id,promise);
    try { return await promise; } finally { this.pending.delete(id); }
  }
  async #dispatch(id) {
    const intent=this.service.store.get(id); if(!intent) throw new Error('INTENT_NOT_FOUND');
    if(intent.state==='settled' || intent.state==='expired' || intent.state==='executing') return intent;
    if(Date.parse(intent.expiresAt)<=Date.now()) { intent.state='expired'; this.service.store.save(intent); this.event('bundle.expired',{intentId:id}); return intent; }
    const agent=this.service.store.find('agents',intent.agentId), policy=this.service.store.find('policies',intent.policyId), currentPolicy=this.service.store.find('policies',agent?.policyId);
    if(!agent || agent.status!=='active' || !policy || !currentPolicy) throw new Error('MISSING_AUTHORITY');
    const usage=this.service.store.all('transactions').filter(t=>t.state==='settled');
    evaluatePolicy(intent,policy,usage); evaluatePolicy(intent,currentPolicy,usage);
    const payload={intent,agent,policy,currentPolicy,originNodeId:this.nodeId,originPublicKey:this.identity.publicKey,originAdvertisement:this.state.advertisements[this.nodeId],originSignature:this.identity.sign({intentHash:intent.intentHash,originNodeId:this.nodeId,agent,policy,currentPolicy}),path:[this.nodeId],transportPath:[]};
    try {
      const receipt=await this.forward(payload); return this.acceptReceipt(receipt);
    } catch(error) {
      if(error.message==='EXECUTION_UNCERTAIN') { intent.state='executing'; this.service.store.save(intent); }
      else if(intent.state!=='settled') { intent.state='queued_for_mesh'; this.service.store.save(intent); this.event('bundle.queued',{intentId:id,reason:error.message}); }
      return intent;
    }
  }
  snapshot() { return {node:{...this.capability(),transports:[...this.transports.values()].map(t=>t.health())},peers:Object.values(this.peers).map(p=>({nodeId:p.id,publicKey:this.state.peerKeys[p.id] ?? null,online:[...this.links.values()].some(l=>l.to===p.id && l.online)})),links:[...this.links.values()],routes:this.catalog().map(a=>a.data),topology:{nodes:this.catalog().map(a=>({nodeId:a.data.nodeId,canSettle:a.data.canSettle,assets:a.data.assets,rails:a.data.rails,peerId:a.data.peerId})),links:this.graph()},queue:[...this.service.store.all('intents').filter(i=>i.state==='queued_for_mesh').map(i=>({id:i.id,asset:i.asset,expiresAt:i.expiresAt})),...this.state.queuedBundles.map(b=>({id:b.id,intentId:b.intentId,type:b.type,expiresAt:b.expiresAt}))],messages:this.state.events.slice(-100),deliveries:this.deliveries.snapshot()}; }
}
