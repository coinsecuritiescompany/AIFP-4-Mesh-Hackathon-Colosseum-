import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// One SQLite writer per node. WAL makes a completed transition durable before
// the caller may submit a message to a transport.
export class DeliveryDatabase {
  constructor(file, legacy = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    fs.chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS delivery_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_outbox (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_inbox (id TEXT PRIMARY KEY, record TEXT NOT NULL);`);
    this.transaction(() => {
      if (this.db.prepare("SELECT value FROM delivery_meta WHERE key='legacy_imported'").get()) return;
      for (const [kind, records] of [['outbox', legacy.deliveryOutbox], ['inbox', legacy.deliveryInbox]]) {
        for (const [id, record] of Object.entries(records ?? {})) this.db.prepare(`INSERT OR IGNORE INTO delivery_${kind} (id,record) VALUES (?,?)`).run(id, JSON.stringify(record));
      }
      this.db.prepare("INSERT INTO delivery_meta VALUES ('legacy_imported','1')").run();
    });
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  load(kind) {
    if (!['inbox','outbox'].includes(kind)) throw new Error('INVALID_DELIVERY_TABLE');
    return Object.fromEntries(this.db.prepare(`SELECT id,record FROM delivery_${kind} ORDER BY rowid`).all().map(({id,record})=>[id,JSON.parse(record)]));
  }
  put(kind,id,record) {
    if (!['inbox','outbox'].includes(kind)) throw new Error('INVALID_DELIVERY_TABLE');
    this.db.prepare(`INSERT INTO delivery_${kind} (id,record) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record`).run(id,JSON.stringify(record));
  }
  remove(kind,id) {
    if (!['inbox','outbox'].includes(kind)) throw new Error('INVALID_DELIVERY_TABLE');
    this.db.prepare(`DELETE FROM delivery_${kind} WHERE id=?`).run(id);
  }
  close() { this.db.close(); }
}
