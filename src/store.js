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
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data));
    fs.renameSync(temp, this.file);
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
  queued() { return this.all('intents').filter(x => x.state === 'queued'); }
}
