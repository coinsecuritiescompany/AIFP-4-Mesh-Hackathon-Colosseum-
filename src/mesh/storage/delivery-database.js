import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../../canonical.js';

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
      CREATE TABLE IF NOT EXISTS delivery_inbox (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_seen (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS delivery_seen_expiry ON delivery_seen(expires_at);
      CREATE TABLE IF NOT EXISTS mesh_bundles (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, state TEXT NOT NULL, expires_at INTEGER NOT NULL, bytes INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mesh_bundles_state ON mesh_bundles(state,expires_at);
      CREATE TABLE IF NOT EXISTS mesh_hops (id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL);`);
    this.transaction(() => {
      if (this.db.prepare("SELECT value FROM delivery_meta WHERE key='legacy_imported'").get()) return;
      for (const [kind, records] of [['outbox', legacy.deliveryOutbox], ['inbox', legacy.deliveryInbox]]) {
        for (const [id, record] of Object.entries(records ?? {})) this.db.prepare(`INSERT OR IGNORE INTO delivery_${kind} (id,record) VALUES (?,?)`).run(id, JSON.stringify(record));
      }
      this.db.prepare("INSERT INTO delivery_meta VALUES ('legacy_imported','1')").run();
    });
    this.transaction(() => {
      if (this.db.prepare("SELECT value FROM delivery_meta WHERE key='seen_imported'").get()) return;
      for (const [id,expiry] of Object.entries(legacy.seen ?? {})) if (Number.isSafeInteger(expiry) && expiry>Date.now()) this.db.prepare('INSERT OR IGNORE INTO delivery_seen VALUES (?,?)').run(id,expiry);
      this.db.prepare("INSERT INTO delivery_meta VALUES ('seen_imported','1')").run();
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
  seen() { return Object.fromEntries(this.db.prepare('SELECT id,expires_at FROM delivery_seen WHERE expires_at > ?').all(Date.now()).map(({id,expires_at})=>[id,expires_at])); }
  acceptInbound(message,entry) {
    const expiry=Date.parse(message.expiresAt), now=Date.now();
    return this.transaction(() => {
      this.db.prepare('DELETE FROM delivery_seen WHERE expires_at <= ?').run(now);
      if(this.db.prepare('SELECT 1 FROM delivery_seen WHERE id=?').get(message.messageId)) throw new Error('REPLAY');
      if(entry && this.db.prepare('SELECT 1 FROM delivery_inbox WHERE id=?').get(message.messageId)) throw new Error('DUPLICATE_INBOUND_DELIVERY');
      this.db.prepare('INSERT INTO delivery_seen VALUES (?,?)').run(message.messageId,expiry);
      if(entry) this.put('inbox',message.messageId,entry);
    });
  }
  bundle(id) {
    const row=this.db.prepare('SELECT record FROM mesh_bundles WHERE id=?').get(id);
    return row?JSON.parse(row.record):null;
  }
  bundles(states=null) {
    if(states && (!Array.isArray(states) || !states.length)) return [];
    const rows=states ? this.db.prepare(`SELECT record FROM mesh_bundles WHERE state IN (${states.map(()=>'?').join(',')}) ORDER BY rowid`).all(...states) : this.db.prepare('SELECT record FROM mesh_bundles ORDER BY rowid').all();
    return rows.map(row=>JSON.parse(row.record));
  }
  hop(id) { const row=this.db.prepare('SELECT record FROM mesh_hops WHERE id=?').get(id);return row?JSON.parse(row.record):null; }
  hops(bundleId) {return this.db.prepare('SELECT record FROM mesh_hops WHERE bundle_id=? ORDER BY rowid').all(bundleId).map(row=>JSON.parse(row.record));}
  insertBundle(bundle) {
    const bytes=Buffer.byteLength(JSON.stringify(bundle));
    if(!bundle.bundleId || !bundle.intentId || !Number.isFinite(Date.parse(bundle.expiresAt)) || Date.parse(bundle.expiresAt)<=Date.now() || bytes>65536 || !['payment','receipt','ack'].includes(bundle.kind) || bundle.bundleHash!==sha256(bundle.payload) || bundle.state!=='QUEUED') throw new Error('INVALID_BUNDLE');
    const active=this.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS bytes FROM mesh_bundles WHERE state NOT IN ('DELIVERED','EXPIRED','FAILED_PERMANENT') AND expires_at>?").get(Date.now());
    if(active.count>=64 || active.bytes+bytes>4*1024*1024) throw new Error('MESH_QUEUE_FULL');
    // Admission reserves space for receipts and ACKs even under an intent
    // flood. Never accept payment custody that cannot fit its control traffic.
    const perKind=this.db.prepare("SELECT COUNT(*) AS count FROM mesh_bundles WHERE json_extract(record,'$.kind')=? AND state NOT IN ('DELIVERED','EXPIRED','FAILED_PERMANENT') AND expires_at>?").get(bundle.kind,Date.now());
    if(perKind.count>={payment:32,receipt:16,ack:16}[bundle.kind]) throw new Error('MESH_QUEUE_FULL');
    const perOrigin=this.db.prepare("SELECT COUNT(*) AS count FROM mesh_bundles WHERE json_extract(record,'$.originNodeId')=? AND json_extract(record,'$.kind')=? AND state NOT IN ('DELIVERED','EXPIRED','FAILED_PERMANENT') AND expires_at>?").get(bundle.originNodeId,bundle.kind,Date.now());
    if(perOrigin.count>=16) throw new Error('MESH_ORIGIN_QUEUE_FULL');
    this.db.prepare('INSERT INTO mesh_bundles VALUES (?,?,?,?,?,?)').run(bundle.bundleId,bundle.intentId,bundle.state,Date.parse(bundle.expiresAt),bytes,JSON.stringify(bundle));
  }
  createBundle(bundle) { return this.transaction(()=>this.insertBundle(bundle)); }
  createDelivery(bundle,hop) {
    return this.transaction(()=>{
      this.insertBundle(bundle);
      if(hop.bundleId!==bundle.bundleId || !hop.hopDeliveryId || !hop.nextHop || !hop.transport || hop.state!=='READY') throw new Error('INVALID_HOP');
      this.db.prepare('INSERT INTO mesh_hops VALUES (?,?,?,?)').run(hop.hopDeliveryId,hop.bundleId,hop.state,JSON.stringify(hop));
    });
  }
  acceptBundle(message,entry,bundle) {
    return this.transaction(()=>{
      const now=Date.now(),expiry=Date.parse(message.expiresAt);
      this.db.prepare('DELETE FROM delivery_seen WHERE expires_at <= ?').run(now);
      if(this.db.prepare('SELECT 1 FROM delivery_seen WHERE id=?').get(message.messageId)) throw new Error('REPLAY');
      const existing=this.bundle(bundle.bundleId);
      if(existing && existing.bundleHash!==bundle.bundleHash) throw new Error('BUNDLE_CONFLICT');
      if(!existing) this.insertBundle(bundle);
      this.db.prepare('INSERT INTO delivery_seen VALUES (?,?)').run(message.messageId,expiry);
      this.put('inbox',message.messageId,entry);
      return {duplicate:!!existing};
    });
  }
  updateBundle(id,from,to,patch={}) {
    const nextStates={QUEUED:['WAITING_LINK','SUBMITTED','HOP_ACCEPTED','EXPIRED','FAILED_PERMANENT','DELIVERED'],WAITING_LINK:['QUEUED','SUBMITTED','HOP_ACCEPTED','EXPIRED','FAILED_PERMANENT','DELIVERED'],SUBMITTED:['QUEUED','HOP_ACCEPTED','EXPIRED','DELIVERED','FAILED_PERMANENT'],HOP_ACCEPTED:['DELIVERED','EXPIRED'],DELIVERED:[],EXPIRED:[],FAILED_PERMANENT:[]};
    if(!nextStates[from]?.includes(to)) throw new Error('INVALID_BUNDLE_TRANSITION');
    return this.transaction(()=>{
      const current=this.bundle(id);
      if(!current || current.state!==from) throw new Error('STALE_BUNDLE_STATE');
      const next={...current,...patch,state:to,updatedAt:new Date().toISOString()};
      this.db.prepare('UPDATE mesh_bundles SET state=?,record=? WHERE id=?').run(to,JSON.stringify(next),id);
      return next;
    });
  }
  createHop(hop) {
    if(!hop.hopDeliveryId || !this.bundle(hop.bundleId) || !hop.nextHop || !hop.transport) throw new Error('INVALID_HOP');
    return this.transaction(()=>this.db.prepare('INSERT INTO mesh_hops VALUES (?,?,?,?)').run(hop.hopDeliveryId,hop.bundleId,hop.state,JSON.stringify(hop)));
  }
  updateHop(id,from,to,patch={}) {
    const allowed={READY:['SUBMITTED','HOP_ACCEPTED','FAILED_TEMPORARY','EXPIRED'],SUBMITTED:['HOP_ACCEPTED','FAILED_TEMPORARY','EXPIRED'],FAILED_TEMPORARY:['READY','HOP_ACCEPTED','EXPIRED'],HOP_ACCEPTED:[],EXPIRED:[]};
    if(!allowed[from]?.includes(to)) throw new Error('INVALID_HOP_TRANSITION');
    return this.transaction(()=>{
      const current=this.hop(id);if(!current || current.state!==from) throw new Error('STALE_HOP_STATE');
      const next={...current,...patch,state:to,updatedAt:new Date().toISOString()};
      this.db.prepare('UPDATE mesh_hops SET state=?,record=? WHERE id=?').run(to,JSON.stringify(next),id);return next;
    });
  }
  close() { this.db.close(); }
}
