const STATES=new Set(['CREATED','QUEUED','FRAGMENTING','WAITING_LINK','SENDING','SENT','ACKNOWLEDGED','DELIVERED','FAILED_TEMPORARY','FAILED_PERMANENT','EXPIRED']);
export class DeliveryJournal {
  constructor(state,persist,database=null) {
    this.state=state;this.persist=persist;this.database=database;
    state.deliveryOutbox=database?.load('outbox') ?? state.deliveryOutbox ?? {};
    state.deliveryInbox=database?.load('inbox') ?? state.deliveryInbox ?? {};
    if(database) state.seen=database.seen();
  }
  #write(kind,id,entry) {
    if(this.database) this.database.transaction(()=>this.database.put(kind,id,entry));
    this.state[kind==='outbox'?'deliveryOutbox':'deliveryInbox'][id]=entry;
    if(!this.database) this.persist();
  }
  outgoing(message,{intentId,transport,to,recovery}) {
    const id=message.messageId;
    if(this.state.deliveryOutbox[id]) throw new Error('DUPLICATE_DELIVERY');
    if(this.pendingRecovery().length>=64) throw new Error('OUTBOX_FULL');
    if(recovery && Buffer.byteLength(JSON.stringify(recovery))>65536) throw new Error('OUTBOX_PAYLOAD_TOO_LARGE');
    this.#write('outbox',id,{messageId:id,intentId,transport,to,messageType:message.messageType,state:'CREATED',createdAt:message.createdAt,expiresAt:message.expiresAt,updatedAt:new Date().toISOString(),...(recovery?{recovery}:{})});
    this.#prune();return id;
  }
  incoming(message,{from,transport}) {
    if(this.state.deliveryInbox[message.messageId]) throw new Error('DUPLICATE_INBOUND_DELIVERY');
    this.#write('inbox',message.messageId,{messageId:message.messageId,messageType:message.messageType,from,transport,receivedAt:new Date().toISOString()});
    this.#prune();
  }
  accept(message,{from,transport}) {
    if(!this.database) throw new Error('TRANSACTIONAL_INBOX_REQUIRED');
    const isHello=message.messageType==='PEER_HELLO';
    const entry=isHello?null:{messageId:message.messageId,messageType:message.messageType,from,transport,receivedAt:new Date().toISOString()};
    this.database.acceptInbound(message,entry);
    this.state.seen[message.messageId]=Date.parse(message.expiresAt);
    for(const [id,expiry] of Object.entries(this.state.seen)) if(expiry<=Date.now()) delete this.state.seen[id];
    if(entry) {this.state.deliveryInbox[message.messageId]=entry;this.#prune();}
  }
  mark(id,next,reason) {
    if(!STATES.has(next)) throw new Error('INVALID_DELIVERY_STATE');
    const entry=this.state.deliveryOutbox[id];if(!entry) throw new Error('UNKNOWN_DELIVERY');
    if(entry.state==='DELIVERED' && next!=='DELIVERED') return entry;
    const updated={...entry,state:next,updatedAt:new Date().toISOString()};if(reason) updated.reason=String(reason).slice(0,120);
    if(['ACKNOWLEDGED','DELIVERED','FAILED_PERMANENT','EXPIRED'].includes(next)) delete updated.recovery;
    this.#write('outbox',id,updated);return updated;
  }
  clearRecovery(id) {
    const entry=this.state.deliveryOutbox[id];if(!entry) throw new Error('UNKNOWN_DELIVERY');
    const updated={...entry};delete updated.recovery;this.#write('outbox',id,updated);
  }
  deliveredIntent(intentId) {
    const updates=Object.values(this.state.deliveryOutbox).filter(entry=>entry.intentId===intentId && entry.messageType==='PAYMENT_FORWARD' && ['SENDING','SENT','ACKNOWLEDGED','FAILED_TEMPORARY'].includes(entry.state)).map(entry=>{const next={...entry,state:'DELIVERED',updatedAt:new Date().toISOString()};delete next.recovery;return next;});
    if(this.database) this.database.transaction(()=>{for(const entry of updates) this.database.put('outbox',entry.messageId,entry);});
    for(const entry of updates) this.state.deliveryOutbox[entry.messageId]=entry;
    if(!this.database) this.persist();
  }
  #prune() {
    for(const key of ['deliveryOutbox','deliveryInbox']) {
      const entries=Object.entries(this.state[key]);
      if(entries.length>500) {
        let remove=entries.length-500;
        for(const [id,item] of entries) if(remove>0 && (key==='deliveryInbox' || !item.recovery)) {if(this.database) this.database.transaction(()=>this.database.remove(key==='deliveryInbox'?'inbox':'outbox',id));delete this.state[key][id];remove--;}
      }
    }
  }
  snapshot() {return {outbox:Object.values(this.state.deliveryOutbox).slice(-100).map(({recovery,...safe})=>safe),inbox:Object.values(this.state.deliveryInbox).slice(-100)};}
  pendingRecovery() {return Object.values(this.state.deliveryOutbox).filter(x=>x.recovery && !['DELIVERED','ACKNOWLEDGED','FAILED_PERMANENT','EXPIRED'].includes(x.state));}
}
