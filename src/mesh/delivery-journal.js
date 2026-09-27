const STATES=new Set(['CREATED','QUEUED','FRAGMENTING','WAITING_LINK','SENDING','SENT','ACKNOWLEDGED','DELIVERED','FAILED_TEMPORARY','FAILED_PERMANENT','EXPIRED']);
export class DeliveryJournal {
  constructor(state,persist) {
    this.state=state;this.persist=persist;
    state.deliveryOutbox ??={};state.deliveryInbox ??={};
  }
  outgoing(message,{intentId,transport,to,recovery}) {
    const id=message.messageId;
    if(this.state.deliveryOutbox[id]) throw new Error('DUPLICATE_DELIVERY');
    if(this.pendingRecovery().length>=64) throw new Error('OUTBOX_FULL');
    if(recovery && Buffer.byteLength(JSON.stringify(recovery))>65536) throw new Error('OUTBOX_PAYLOAD_TOO_LARGE');
    this.state.deliveryOutbox[id]={messageId:id,intentId,transport,to,messageType:message.messageType,state:'CREATED',createdAt:message.createdAt,expiresAt:message.expiresAt,updatedAt:new Date().toISOString(),...(recovery?{recovery}:{})};
    this.#prune();this.persist();return id;
  }
  incoming(message,{from,transport}) {
    if(this.state.deliveryInbox[message.messageId]) throw new Error('DUPLICATE_INBOUND_DELIVERY');
    this.state.deliveryInbox[message.messageId]={messageId:message.messageId,messageType:message.messageType,from,transport,receivedAt:new Date().toISOString()};
    this.#prune();this.persist();
  }
  mark(id,next,reason) {
    if(!STATES.has(next)) throw new Error('INVALID_DELIVERY_STATE');
    const entry=this.state.deliveryOutbox[id];if(!entry) throw new Error('UNKNOWN_DELIVERY');
    if(entry.state==='DELIVERED' && next!=='DELIVERED') return entry;
    entry.state=next;entry.updatedAt=new Date().toISOString();if(reason) entry.reason=String(reason).slice(0,120);
    if(['ACKNOWLEDGED','DELIVERED','FAILED_PERMANENT','EXPIRED'].includes(next)) delete entry.recovery;
    this.persist();return entry;
  }
  deliveredIntent(intentId) {
    for(const entry of Object.values(this.state.deliveryOutbox)) if(entry.intentId===intentId && entry.messageType==='PAYMENT_FORWARD' && ['SENDING','SENT','ACKNOWLEDGED','FAILED_TEMPORARY'].includes(entry.state)) {entry.state='DELIVERED';entry.updatedAt=new Date().toISOString();delete entry.recovery;}
    this.persist();
  }
  #prune() {
    for(const key of ['deliveryOutbox','deliveryInbox']) {
      const entries=Object.entries(this.state[key]);
      if(entries.length>500) {
        let remove=entries.length-500;
        for(const [id,item] of entries) if(remove>0 && (key==='deliveryInbox' || !item.recovery)) {delete this.state[key][id];remove--;}
      }
    }
  }
  snapshot() {return {outbox:Object.values(this.state.deliveryOutbox).slice(-100).map(({recovery,...safe})=>safe),inbox:Object.values(this.state.deliveryInbox).slice(-100)};}
  pendingRecovery() {return Object.values(this.state.deliveryOutbox).filter(x=>x.recovery && !['DELIVERED','ACKNOWLEDGED','FAILED_PERMANENT','EXPIRED'].includes(x.state));}
}
