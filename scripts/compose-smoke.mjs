import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const base=process.env.AIFP4_SMOKE_URL ?? 'http://127.0.0.1:4044';
const key=process.env.AIFP4_API_KEY ?? 'sandbox-demo-key';
async function api(route,method='GET',body) {
  const response=await fetch(base+route,{method,headers:{'x-aifp4-api-key':key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  const value=await response.json(); if(!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`); return value;
}
async function waitFor(fn,seconds=60) {
  const until=Date.now()+seconds*1000; let last;
  while(Date.now()<until) { try { const result=await fn(); if(result) return result; } catch(error) { last=error; } await new Promise(resolve=>setTimeout(resolve,1000)); }
  throw new Error(`Timed out: ${last?.message ?? 'condition not met'}`);
}
const payment=()=>({agentId:'agent_demo',beneficiary:'ai-data-api',amountMinor:250,asset:'USDC',purpose:'Docker Mesh smoke',idempotencyKey:randomUUID()});
await waitFor(async()=>{
  const {topology}=await api('/v1/mesh/topology');
  return topology.nodes.length>=4 && topology.links.some(e=>e.from==='node-b'&&e.to==='node-c'&&e.transport==='libp2p');
});
const first=await api('/v1/intents','POST',payment());
const settled=await api(`/v1/intents/${first.id}/execute`,'POST');
assert.equal(settled.state,'settled',JSON.stringify(settled));
assert.deepEqual(settled.meshPath,['node-a','node-b','node-c']);
assert.deepEqual(settled.transportPath.map(e=>e.transport),['tcp','libp2p']);
assert.equal(settled.receiptVerified,true);
console.log('Docker cross-transport path: A --TCP--> B --libp2p--> C, verified receipt');
execFileSync('docker',['compose','stop','mesh-node-b'],{stdio:'inherit'});
try {
  await waitFor(async()=>!(await api('/v1/mesh/peers')).peers.find(p=>p.nodeId==='node-b').online,20);
  const next=await api('/v1/intents','POST',payment());
  const rerouted=await api(`/v1/intents/${next.id}/execute`,'POST');
  assert.equal(rerouted.state,'settled',JSON.stringify(rerouted));
  assert.deepEqual(rerouted.meshPath,['node-a','node-d','node-c']);
  assert.equal(rerouted.receiptVerified,true);
  console.log('Docker node failure path: A --libp2p--> D --TCP--> C, verified receipt');
} finally { execFileSync('docker',['compose','start','mesh-node-b'],{stdio:'inherit'}); }
