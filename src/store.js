import fs from 'node:fs';
import path from 'node:path';

export class IntentStore {
  constructor(file = null) {
    this.file = file;
    this.data = { agents: [], policies: [], intents: [], receipts: [], transactions: [], events: [] };
    if (file && fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }
  all(kind) { return [...this.data[kind]]; }
  find(kind, id) { return this.data[kind].find(x => x.id === id) ?? null; }
  add(kind, item) { this.data[kind].push(item); this.persist(); return item; }
  saveKind(kind, item) {
    const index = this.data[kind].findIndex(x => x.id === item.id);
    if (index < 0) this.data[kind].push(item); else this.data[kind][index] = item;
    this.persist(); return item;
  }
  create(intent) {
    const previous = this.data.intents.find(x => x.idempotencyKey === intent.idempotencyKey);
    if (previous) return { created: false, intent: previous };
    return { created: true, intent: this.add('intents', intent) };
  }
  get(id) { return this.find('intents', id); }
  save(intent) { return this.saveKind('intents', intent); }
  commitMeshReceipt(intentId, receipt, transaction) {
    const current=this.get(intentId);
    if(!current || receipt.intentId!==intentId || transaction.intentId!==intentId) throw new Error('INVALID_MESH_RECEIPT_COMMIT');
    if(current.state==='settled') return current;
    const previousReceipt=this.data.receipts.find(r=>r.intentId===intentId);
    const previousTransaction=this.data.transactions.find(t=>t.intentId===intentId);
    if((previousReceipt && (previousReceipt.receiptId!==receipt.receiptId || previousReceipt.receiptHash!==receipt.receiptHash)) || (previousTransaction && previousTransaction.reference!==transaction.reference)) throw new Error('SETTLEMENT_RECORD_CONFLICT');
    const settled={...current,receipt,state:'settled',meshPath:receipt.meshPath,transportPath:receipt.transportPath,receiptVerified:true};
    const previous=this.data;
    this.data={...previous,
      intents:previous.intents.map(i=>i.id===intentId?settled:i),
      receipts:previousReceipt?previous.receipts:[...previous.receipts,receipt],
      transactions:previousTransaction?previous.transactions:[...previous.transactions,transaction]};
    try {this.persist();} catch(error) {this.data=previous;throw error;}
    return settled;
  }
  queued() { return this.all('intents').filter(x => x.state === 'queued'); }
}
