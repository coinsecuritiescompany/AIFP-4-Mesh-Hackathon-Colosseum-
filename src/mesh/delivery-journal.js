const STATES=new Set(['CREATED','QUEUED','FRAGMENTING','WAITING_LINK','SENDING','SENT','ACKNOWLEDGED','DELIVERED','FAILED_TEMPORARY','FAILED_PERMANENT','EXPIRED']);
export class DeliveryJournal {
  constructor(state,persist) {
    this.state=state;this.persist=persist;
    state.deliveryOutbox ??={};state.deliveryInbox ??={};
  }
  outgoing(message,{intentId,transport,to}) {
    const id=message.messageId;
    if(this.state.deliveryOutbox[id]) throw new Error('DUPLICATE_DELIVERY');
    this.state.deliveryOutbox[id]={messageId:id,intentId,transport,to,messageType:message.messageType,state:'CREATED',createdAt:message.createdAt,expiresAt:message.expiresAt,updatedAt:new Date().toISOString()};
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
    this.persist();return entry;
  }
  deliveredIntent(intentId) {
    for(const entry of Object.values(this.state.deliveryOutbox)) if(entry.intentId===intentId && entry.messageType==='PAYMENT_FORWARD' && ['SENDING','SENT','ACKNOWLEDGED'].includes(entry.state)) {entry.state='DELIVERED';entry.updatedAt=new Date().toISOString();}
    this.persist();
  }
  #prune() {
    for(const key of ['deliveryOutbox','deliveryInbox']) {
      const entries=Object.entries(this.state[key]);
      if(entries.length>500) for(const [id] of entries.slice(0,entries.length-500)) delete this.state[key][id];
    }
  }
  snapshot() {return {outbox:Object.values(this.state.deliveryOutbox).slice(-100),inbox:Object.values(this.state.deliveryInbox).slice(-100)};}
}
