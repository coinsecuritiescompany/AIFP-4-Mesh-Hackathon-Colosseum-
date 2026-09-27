import fs from 'node:fs';
import path from 'node:path';
import { hashBytes, MAX_ENVELOPE_BYTES, MAX_FRAGMENTS } from './fragmenter.js';

// Optional per-node file persists incomplete transfers across process restarts.
// Do not share this file between processes; the Mesh node has one writer.
export class Reassembler {
  constructor(file = null, { maxPending = 64, maxStoredBytes = 1048576 } = {}) {
    this.file=file; this.maxPending=maxPending; this.maxStoredBytes=maxStoredBytes;
    this.pending=file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {};
  }
  persist() {
    if(!this.file) return;
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    const tmp=`${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify(this.pending),{mode:0o600});
    fs.renameSync(tmp,this.file); fs.chmodSync(this.file,0o600);
  }
  accept(fragment, now = Date.now()) {
    const f=fragment;
    if(!f || f.protocolVersion!==1 || !/^[0-9a-f-]{36}$/.test(f.messageId ?? '') || f.fragmentId!==`${f.messageId}:${f.fragmentIndex}` || !Number.isInteger(f.fragmentIndex) || !Number.isInteger(f.fragmentCount) || f.fragmentCount<1 || f.fragmentCount>MAX_FRAGMENTS || f.fragmentIndex<0 || f.fragmentIndex>=f.fragmentCount || !/^[0-9a-f]{64}$/.test(f.originalPayloadHash ?? '') || !/^[0-9a-f]{64}$/.test(f.fragmentHash ?? '') || !Number.isFinite(Date.parse(f.createdAt)) || !Number.isFinite(Date.parse(f.expiresAt)) || Date.parse(f.createdAt)>now+30000 || Date.parse(f.expiresAt)<=now || Date.parse(f.expiresAt)>now+86400000 || !(f.payload instanceof Uint8Array) || !f.payload.length || f.payload.length>MAX_ENVELOPE_BYTES) throw new Error('INVALID_FRAGMENT');
    if(hashBytes(f.payload)!==f.fragmentHash) throw new Error('CORRUPT_FRAGMENT');
    for(const [id,entry] of Object.entries(this.pending)) if(entry.expiresAt<=now) delete this.pending[id];
    const entry=this.pending[f.messageId];
    if(entry && (entry.count!==f.fragmentCount || entry.hash!==f.originalPayloadHash || entry.expiresAt!==Date.parse(f.expiresAt))) throw new Error('FRAGMENT_CONFLICT');
    if(!entry && Object.keys(this.pending).length>=this.maxPending) throw new Error('FRAGMENT_QUEUE_FULL');
    const next=entry ?? {count:f.fragmentCount,hash:f.originalPayloadHash,expiresAt:Date.parse(f.expiresAt),parts:{},size:0};
    const chunk=Buffer.from(f.payload);
    if(next.parts[f.fragmentIndex]) {
      if(next.parts[f.fragmentIndex]!==chunk.toString('base64')) throw new Error('FRAGMENT_CONFLICT');
      return {status:'duplicate'};
    }
    const stored=Object.values(this.pending).reduce((sum,item)=>sum+item.size,0);
    if(next.size+chunk.length>MAX_ENVELOPE_BYTES || stored+chunk.length>this.maxStoredBytes) throw new Error('FRAGMENT_QUEUE_FULL');
    next.parts[f.fragmentIndex]=chunk.toString('base64'); next.size+=chunk.length;
    this.pending[f.messageId]=next;
    if(Object.keys(next.parts).length!==next.count) {this.persist();return {status:'incomplete',received:Object.keys(next.parts).length,count:next.count};}
    const bytes=Buffer.concat(Array.from({length:next.count},(_,index)=>Buffer.from(next.parts[index],'base64')));
    delete this.pending[f.messageId]; this.persist();
    if(hashBytes(bytes)!==next.hash) throw new Error('CORRUPT_REASSEMBLY');
    return {status:'complete',bytes};
  }
}
