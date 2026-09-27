import { randomUUID } from 'node:crypto';
import { sha256 } from '../../canonical.js';
import { envelope, validateEnvelope, wireDecode, wireEncode } from '../protocol.js';
import { verifySigned } from '../identity.js';
import { planNodeRoute } from '../routing.js';
import { signHopAcceptance, verifyHopAcceptance } from './hop-ack.js';

const TERMINAL=['DELIVERED','EXPIRED','FAILED_PERMANENT'];
const retryDelay=attempt=>Math.min(30000,1000*2**Math.min(attempt,5));

export class DeliveryCoordinator {
  constructor(node) {this.node=node;this.db=node.deliveryDatabase;this.running=false;}
  enqueue(kind,payload,intentId,expiresAt,originNodeId=this.node.nodeId) {
    const existing=this.db.bundles().find(b=>b.kind===kind&&b.intentId===intentId&&b.originNodeId===originNodeId&&!TERMINAL.includes(b.state));
    if(existing && kind!=='ack') return existing;
    const bundle={bundleId:randomUUID(),intentId,kind,originNodeId,payload,bundleHash:sha256(payload),state:'QUEUED',createdAt:new Date().toISOString(),expiresAt};
    this.db.createBundle(bundle);
    queueMicrotask(()=>this.pump().catch(()=>{}));
    return bundle;
  }
  enqueueReceipt(receipt) {return this.enqueue('receipt',{receipt,path:[this.node.nodeId]},receipt.intentId,new Date(Date.now()+60000).toISOString());}
  async onMessage(bytes,metadata) {
    const message=wireDecode(bytes),node=this.node;
    const peer=node.peers[message?.sourceNodeId];
    if(!peer || !peer[metadata.transportId==='libp2p'?'p2p':'tcp']) throw new Error('UNKNOWN_PEER');
    const expectedPeerId=node.state.advertisements[peer.id]?.data.peerId;
    if(metadata.transportId==='libp2p'&&expectedPeerId&&metadata.remotePeer!==expectedPeerId) throw new Error('LIBP2P_IDENTITY_MISMATCH');
    validateEnvelope(message,node.state.peerKeys[peer.id]);
    if(message.destinationNodeId!==node.nodeId) throw new Error('WRONG_DESTINATION');
    const {bundleId,hopDeliveryId,bundleHash,body}=message.payload ?? {};
    const kind={PAYMENT_FORWARD:'payment',PAYMENT_RECEIPT:'receipt',HOP_ACCEPTED:'ack'}[message.messageType];
    if(!kind || typeof bundleId!=='string' || typeof hopDeliveryId!=='string' || bundleHash!==sha256(body)) throw new Error('INVALID_BUNDLE');
    if(kind==='payment') {
      node.verifyPayload(body);
      if(body.path.at(-1)!==peer.id || body.path.includes(node.nodeId) || body.transportPath.at(-1)?.to!==node.nodeId || body.transportPath.at(-1)?.transport!==metadata.transportId) throw new Error('INVALID_PATH');
    } else if(kind==='receipt') {
      if(body?.path?.at(-1)!==peer.id || body.path.includes(node.nodeId) || body.receipt?.intentId==null) throw new Error('INVALID_RECEIPT_PATH');
    } else {
      const ack=body?.ack,ackKey=node.state.peerKeys[ack?.receiverNodeId];
      if(!ackKey || !verifyHopAcceptance(ack,{bundleId:ack.bundleId,hopDeliveryId:ack.hopDeliveryId,messageId:ack.acceptedMessageId,senderNodeId:ack.senderNodeId,nextHop:ack.receiverNodeId,bundleHash:ack.bundleHash},ackKey)) throw new Error('INVALID_HOP_ACCEPTANCE');
      if(body.path.at(-1)!==peer.id || body.path.includes(node.nodeId)) throw new Error('INVALID_ACK_PATH');
    }
    const bundle={bundleId,intentId:kind==='ack'?body.ack.bundleId:kind==='payment'?body.intent.id:body.receipt.intentId,kind,originNodeId:message.originNodeId,payload:body,bundleHash,state:'QUEUED',createdAt:new Date().toISOString(),expiresAt:message.expiresAt};
    const entry={messageId:message.messageId,messageType:message.messageType,from:peer.id,transport:metadata.transportId,receivedAt:new Date().toISOString()};
    const accepted=this.db.acceptBundle(message,entry,bundle);
    node.state.peerKeys[peer.id]=message.publicKey;
    node.state.seen[message.messageId]=Date.parse(message.expiresAt);
    node.state.deliveryInbox[message.messageId]=entry;
    node.persist();
    node.event('bundle.received',{intentId:bundle.intentId,bundleId,from:peer.id,transport:metadata.transportId,duplicate:accepted.duplicate});
    if(kind!=='ack') {
      const hop={bundleId,hopDeliveryId,messageId:message.messageId,senderNodeId:peer.id,nextHop:node.nodeId,bundleHash};
      const ack=signHopAcceptance(node.identity,hop,message);
      this.enqueue('ack',{ack,path:[node.nodeId]},bundle.intentId,ack.expiresAt);
    }
    queueMicrotask(()=>this.pump().catch(()=>{}));
  }
  async pump() {
    if(this.running) return;this.running=true;
    try {
      for(const bundle of this.db.bundles(['QUEUED','WAITING_LINK','SUBMITTED','HOP_ACCEPTED'])) {
        if(Date.parse(bundle.expiresAt)<=Date.now()) {if(bundle.state!=='EXPIRED') this.db.updateBundle(bundle.bundleId,bundle.state,'EXPIRED');continue;}
        if(bundle.state==='HOP_ACCEPTED') continue;
        if(bundle.kind==='payment') {
          if(bundle.payload.originNodeId===this.node.nodeId && ['settled','executing','expired'].includes(this.node.service.store.get(bundle.intentId)?.state)) {this.db.updateBundle(bundle.bundleId,bundle.state,'DELIVERED');continue;}
          if(this.node.capability().canSettle && this.node.capability().assets.includes(bundle.payload.intent.asset)) {
            const payload=this.#appendSelf(bundle.payload);
            try {await this.node.settle(payload);this.db.updateBundle(bundle.bundleId,bundle.state,'DELIVERED');}
            catch(error) {if(error.message==='EXECUTION_UNCERTAIN') this.db.updateBundle(bundle.bundleId,bundle.state,'FAILED_PERMANENT',{reason:error.message});}
            continue;
          }
        } else if(bundle.kind==='receipt' && bundle.payload.receipt.originNodeId===this.node.nodeId) {
          try {this.node.acceptReceipt(bundle.payload.receipt);this.db.updateBundle(bundle.bundleId,bundle.state,'DELIVERED');} catch(error) {this.db.updateBundle(bundle.bundleId,bundle.state,'FAILED_PERMANENT',{reason:error.message});}
          continue;
        } else if(bundle.kind==='ack' && bundle.payload.ack.senderNodeId===this.node.nodeId) {
          try {this.#acceptAck(bundle.payload.ack);this.db.updateBundle(bundle.bundleId,bundle.state,'DELIVERED');}
          catch(error) {this.db.updateBundle(bundle.bundleId,bundle.state,'FAILED_PERMANENT',{reason:error.message});this.node.event('delivery.rejected',{reason:error.message});}
          continue;
        }
        try {await this.#send(bundle);}
        catch(error) {
          const current=this.db.bundle(bundle.bundleId);
          if(['QUEUED','WAITING_LINK','SUBMITTED'].includes(current?.state)) this.db.updateBundle(bundle.bundleId,current.state,'FAILED_PERMANENT',{reason:String(error.message).slice(0,120)});
          this.node.event('delivery.rejected',{intentId:bundle.intentId,bundleId:bundle.bundleId,reason:error.message});
        }
      }
    } finally {this.running=false;}
  }
  #appendSelf(payload) {
    return payload.path.at(-1)===this.node.nodeId?payload:{...payload,path:[...payload.path,this.node.nodeId]};
  }
  #acceptAck(ack) {
    const hop=this.db.hop(ack.hopDeliveryId),key=this.node.state.peerKeys[ack.receiverNodeId];
    if(!hop || !['READY','SUBMITTED','FAILED_TEMPORARY'].includes(hop.state)) return;
    // An ACK for an earlier submission of this same hop may arrive after a
    // retransmission has already assigned a new wire message ID.
    const acceptedMessage=[hop.messageId,...(hop.previousMessageIds??[])].find(id=>id===ack.acceptedMessageId);
    if(!acceptedMessage) throw new Error('STALE_HOP_ACCEPTANCE');
    verifyHopAcceptance(ack,{...hop,messageId:acceptedMessage},key);
    this.db.updateHop(hop.hopDeliveryId,hop.state,'HOP_ACCEPTED');
    const bundle=this.db.bundle(hop.bundleId);
    if(bundle && ['QUEUED','WAITING_LINK','SUBMITTED'].includes(bundle.state)) this.db.updateBundle(bundle.bundleId,bundle.state,'HOP_ACCEPTED');
    this.node.event('delivery.hop_accepted',{intentId:bundle?.intentId,bundleId:hop.bundleId,hopDeliveryId:hop.hopDeliveryId,from:ack.receiverNodeId});
  }
  async #send(bundle) {
    const node=this.node;
    const trail=bundle.payload.path ?? [];
    const exclude=trail;
    const route=bundle.kind==='payment'?node.route(bundle.payload.intent.asset,exclude):planNodeRoute(node.nodeId,bundle.kind==='receipt'?bundle.payload.receipt.originNodeId:bundle.payload.ack.senderNodeId,node.graph(),exclude);
    // DTN fallback: move to a reachable relay even when no current end-to-end
    // settlement route exists. Signed path history prevents sending it back.
    const fallback=bundle.kind==='payment' && !route?.edges?.length ? node.graph().filter(e=>e.from===node.nodeId && !exclude.includes(e.to) && e.to!==node.nodeId).sort((a,b)=>a.cost-b.cost||a.to.localeCompare(b.to))[0] : null;
    const edge=route?.edges?.[0] ?? fallback,peer=edge&&node.peers[edge.to];
    if(!peer) {if(bundle.state==='QUEUED') this.db.updateBundle(bundle.bundleId,'QUEUED','WAITING_LINK');return;}
    const old=this.db.hops(bundle.bundleId).at(-1);
    if(old?.state==='HOP_ACCEPTED') return;
    if(old?.state==='SUBMITTED' && old.nextAttemptAt>Date.now()) return;
    if(old?.state==='FAILED_TEMPORARY' && old.nextAttemptAt>Date.now()) return;
    const base=this.#appendSelf(bundle.payload);
    const body=bundle.kind==='payment'?{...base,transportPath:[...base.transportPath,{from:node.nodeId,to:edge.to,transport:edge.transport}]}:base;
    const msgType={payment:'PAYMENT_FORWARD',receipt:'PAYMENT_RECEIPT',ack:'HOP_ACCEPTED'}[bundle.kind];
    const reuse=old && old.nextHop===edge.to && old.transport===edge.transport && ['SUBMITTED','FAILED_TEMPORARY'].includes(old.state);
    const hopId=reuse?old.hopDeliveryId:randomUUID(),hash=sha256(body);
    const wire=envelope(node.identity,msgType,{bundleId:bundle.bundleId,hopDeliveryId:hopId,bundleHash:hash,body},{originNodeId:bundle.originNodeId,destinationNodeId:edge.to,hopCount:base.path.length,maxHops:8,expiresAt:bundle.expiresAt});
    const attempts=reuse?old.attempts+1:1;
    const hop={hopDeliveryId:hopId,bundleId:bundle.bundleId,senderNodeId:node.nodeId,nextHop:edge.to,transport:edge.transport,state:'READY',messageId:wire.messageId,bundleHash:hash,attempts,nextAttemptAt:Date.now()+retryDelay(attempts)};
    if(reuse) {
      if(old.state==='SUBMITTED') this.db.updateHop(hopId,'SUBMITTED','FAILED_TEMPORARY',{reason:'HOP_ACK_TIMEOUT'});
      this.db.updateHop(hopId,'FAILED_TEMPORARY','READY',{messageId:wire.messageId,previousMessageIds:[old.messageId,...(old.previousMessageIds??[])].slice(0,16),bundleHash:hash,attempts,nextAttemptAt:hop.nextAttemptAt});
    } else this.db.createHop(hop);
    try {
      const submission=await node.transports.get(edge.transport).submit(peer,wireEncode(wire),{messageId:wire.messageId,expiresAt:wire.expiresAt});
      if(this.db.hop(hopId)?.state==='READY') this.db.updateHop(hopId,'READY','SUBMITTED',{submissionId:submission.submissionId});
      if(['QUEUED','WAITING_LINK'].includes(this.db.bundle(bundle.bundleId)?.state)) this.db.updateBundle(bundle.bundleId,this.db.bundle(bundle.bundleId).state,'SUBMITTED');
      node.event('delivery.submitted',{intentId:bundle.intentId,bundleId:bundle.bundleId,hopDeliveryId:hopId,to:edge.to,transport:edge.transport});
      if(bundle.kind==='ack' && this.db.bundle(bundle.bundleId)?.state==='SUBMITTED') this.db.updateBundle(bundle.bundleId,'SUBMITTED','DELIVERED');
    } catch(error) {
      if(this.db.hop(hopId)?.state==='READY') this.db.updateHop(hopId,'READY','FAILED_TEMPORARY',{reason:String(error.message).slice(0,120)});
      if(this.db.bundle(bundle.bundleId)?.state==='QUEUED') this.db.updateBundle(bundle.bundleId,'QUEUED','WAITING_LINK');
      node.event('delivery.retry_scheduled',{intentId:bundle.intentId,bundleId:bundle.bundleId,reason:error.message});
    }
  }
}
