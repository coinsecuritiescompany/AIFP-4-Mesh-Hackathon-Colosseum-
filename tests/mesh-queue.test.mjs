import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MeshNode } from '../src/mesh/node.js';

test('durable relay queue caps each origin, persists priority and rejects expired bundles',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aifp-relay-quota-'));
  const service={routes:[],adapters:new Map(),store:{all:()=>[]}};
  try {
    const node=new MeshNode({nodeId:'relay-test',dataDir:dir,peers:{},service});
    const until=new Date(Date.now()+60000).toISOString();
    for(let n=0;n<16;n++) node.queueBundle('payment',{originNodeId:'origin-a',intent:{id:`intent-${n}`}},until,`intent-${n}`);
    assert.throws(()=>node.queueBundle('payment',{originNodeId:'origin-a',intent:{id:'overflow'}},until,'overflow'),/MESH_QUEUE_FULL/);
    node.queueBundle('receipt',{receipt:{settlementNodeId:'settlement',intentId:'return'}},until,'return');
    assert.equal(node.state.queuedBundles.find(x=>x.type==='receipt').priority,2);
    const reloaded=new MeshNode({nodeId:'relay-test',dataDir:dir,peers:{},service});
    assert.equal(reloaded.state.queuedBundles.length,17);
    assert.throws(()=>node.queueBundle('payment',{originNodeId:'other'},new Date(Date.now()-1000).toISOString(),'stale'),/INVALID_QUEUED_BUNDLE/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
