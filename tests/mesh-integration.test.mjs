import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { loadIdentity } from '../src/mesh/identity.js';
import { envelope } from '../src/mesh/protocol.js';
import { TcpTransport } from '../src/mesh/transports/tcp.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'aifp4-mesh-test-'));
const base=22000+randomInt(10000), children=new Map(), logs=new Map();
const port=id=>base+{a:0,b:1,c:2,d:3}[id];
const tcp=id=>port(id)+100, p2p=id=>port(id)+200;
const peer=(id,options={})=>({id:`node-${id}`, ...(options.tcp?{tcp:{host:'127.0.0.1',port:tcp(id)}}:{}),...(options.p2p?{p2p:`/ip4/127.0.0.1/tcp/${p2p(id)}`}:{}) ,cost:{tcp:options.tcpCost??10,libp2p:options.p2pCost??10}});
const topology={
  a:[peer('b',{tcp:true,p2p:true,p2pCost:35}),peer('d',{p2p:true,p2pCost:30})],
  b:[peer('a',{tcp:true,p2p:true,p2pCost:35}),peer('c',{p2p:true,p2pCost:10})],
  c:[peer('b',{p2p:true,p2pCost:200}),peer('d',{tcp:true,tcpCost:20})],
  d:[peer('a',{p2p:true,p2pCost:30}),peer('c',{tcp:true,tcpCost:20})]
};
function start(id) {
  const child=spawn(process.execPath,['src/mesh/start.js'],{cwd:process.cwd(),env:{...process.env,MESH_NODE_ID:`node-${id}`,MESH_DATA_DIR:path.join(root,id),MESH_PEERS:JSON.stringify(topology[id]),MESH_SETTLE_MOCK:id==='c'?'true':'false',MESH_TCP_PORT:String(tcp(id)),MESH_TCP_FRAME_MTU:'400',MESH_P2P_FRAME_MTU:'400',MESH_P2P_PORT:String(p2p(id)),MESH_P2P_BIND:'127.0.0.1',MESH_TICK_MS:'600',PORT:String(port(id))},stdio:['ignore','pipe','pipe']});
  let output=''; for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{output+=chunk.toString();logs.set(id,output.slice(-6000));});
  children.set(id,child);
}
function stop(id) { children.get(id)?.kill('SIGKILL'); children.delete(id); }
async function waitFor(fn,timeout=20000) {
  const until=Date.now()+timeout; let last;
  while(Date.now()<until) { try { const result=await fn(); if(result) return result; } catch(error) { last=error; } await new Promise(r=>setTimeout(r,300)); }
  const snapshots={}; for(const id of ['a','b','c','d']) try { snapshots[id]={links:(await api(id,'/v1/mesh/links')).links,routes:(await api(id,'/v1/mesh/routes')).routes.map(x=>x.nodeId),queue:(await api(id,'/v1/mesh/queue')).queue,events:(await api(id,'/v1/mesh/messages')).messages.slice(-10)}; } catch {}
  throw new Error(`Wait timed out: ${last?.message ?? ''} ${JSON.stringify(snapshots)} ${JSON.stringify(Object.fromEntries(logs))}`);
}
async function api(id,route,method='GET',body) {
  const res=await fetch(`http://127.0.0.1:${port(id)}${route}`,{method,headers:{'x-aifp4-api-key':'sandbox-demo-key','content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(4000)});
  const value=await res.json(); if(!res.ok) throw new Error(`${res.status} ${JSON.stringify(value)}`); return value;
}
const payment=()=>({agentId:'agent_demo',beneficiary:'ai-data-api',amountMinor:250,asset:'USDC',purpose:'Mesh integration',idempotencyKey:`integration-${crypto.randomUUID()}`});
async function executeAndWait(id,timeout=30000) {
  const submitted=await api('a',`/v1/intents/${id}/execute`,'POST');
  assert.ok(['queued_for_mesh','settled'].includes(submitted.state));
  return waitFor(async()=>{const current=await api('a',`/v1/intents/${id}`);return current.state==='settled'?current:null;},timeout);
}
try { for(const id of ['c','b','d','a']) start(id); } catch(error) { for(const id of children.keys()) stop(id); throw error; }
test.after(()=>{for(const id of children.keys()) stop(id); fs.rmSync(root,{recursive:true,force:true});});

test('independent nodes discover signed capabilities and heterogeneous links',async()=>{
  await waitFor(async()=>{const topology=await api('a','/v1/mesh/topology'); return topology.topology.nodes.length>=4 && topology.topology.links.some(e=>e.from==='node-a'&&e.to==='node-b'&&e.transport==='tcp') && topology.topology.links.some(e=>e.from==='node-b'&&e.to==='node-c'&&e.transport==='libp2p');},30000);
  await waitFor(async()=>(await api('b','/v1/mesh/links')).links.some(e=>e.to==='node-c'&&e.transport==='libp2p'&&e.online));
  await waitFor(async()=>(await api('c','/v1/mesh/topology')).topology.links.some(e=>e.from==='node-c'&&e.to==='node-d'&&e.transport==='tcp') && (await api('d','/v1/mesh/links')).links.some(e=>e.to==='node-a'&&e.transport==='libp2p'&&e.online));
  const node=await api('a','/v1/mesh/node'); assert.match(node.peerId,/^12D3/);
  assert.equal(node.canSettle,false);
  assert.equal(node.transports.find(t=>t.id==='tcp').mtu,400);
});
test('A to B by TCP, B to C by libp2p settles and verifies receipt',async()=>{
  // C needs the complete advertised return graph before choosing the ACK
  // route; otherwise it can legitimately use its expensive direct C→B edge.
  await waitFor(async()=>{
    const {topology}=await api('c','/v1/mesh/topology');
    return [['node-c','node-d'],['node-d','node-a'],['node-a','node-b']].every(([from,to])=>topology.links.some(edge=>edge.from===from&&edge.to===to));
  });
  const intent=await api('a','/v1/intents','POST',payment());
  const result=await executeAndWait(intent.id);
  assert.equal(result.state,'settled',JSON.stringify(result));
  assert.deepEqual(result.meshPath,['node-a','node-b','node-c']);
  assert.deepEqual(result.transportPath.map(e=>e.transport),['tcp','libp2p']);
  assert.equal(result.receiptVerified,true);
  const journal=(await api('a','/v1/mesh/deliveries')).deliveries;
  assert.ok(journal.outbox.some(x=>x.intentId===intent.id && x.transport==='tcp' && x.state==='DELIVERED'));
  assert.ok((await api('b','/v1/mesh/deliveries')).deliveries.inbox.some(x=>x.messageType==='PAYMENT_FORWARD' && x.transport==='tcp'));
  await waitFor(async()=>{
    const c=(await api('c','/v1/mesh/deliveries')).deliveries.outbox;
    const d=(await api('d','/v1/mesh/deliveries')).deliveries.outbox;
    return c.some(x=>x.messageType==='PAYMENT_RECEIPT'&&x.to==='node-d') && d.some(x=>x.messageType==='PAYMENT_RECEIPT'&&x.to==='node-a') && c.some(x=>x.messageType==='HOP_ACCEPTED'&&x.to==='node-d');
  });
  await waitFor(async()=>(await api('b','/v1/mesh/messages')).messages.some(x=>x.type==='delivery.hop_accepted'&&x.from==='node-c'));
});
test('origin restarts after local submit and later verifies a returning receipt',async()=>{
  const before=(await api('a','/v1/mesh/node')).peerId;
  const intent=await api('a','/v1/intents','POST',payment());
  const submitted=await api('a',`/v1/intents/${intent.id}/execute`,'POST');
  assert.equal(submitted.state,'queued_for_mesh');
  stop('a');
  start('a');
  await waitFor(async()=>(await api('a','/v1/mesh/node')).peerId===before);
  const settled=await waitFor(async()=>{const value=await api('a',`/v1/intents/${intent.id}`);return value.state==='settled'?value:null;},30000);
  assert.equal(settled.receiptVerified,true);
  assert.equal((await api('c','/v1/transactions')).transactions.filter(x=>x.intentId===intent.id).length,1);
});
test('TCP bearer loss leaves A-B libp2p link reachable and payment settles via live bearer',async()=>{
  await api('a','/v1/mesh/transports/tcp','POST',{online:false});
  await waitFor(async()=>(await api('a','/v1/mesh/links')).links.find(l=>l.to==='node-b'&&l.transport==='libp2p')?.online);
  const intent=await api('a','/v1/intents','POST',payment());
  const result=await executeAndWait(intent.id);
  assert.equal(result.state,'settled',JSON.stringify(result));
  assert.equal(result.meshPath[0],'node-a'); assert.equal(result.meshPath.at(-1),'node-c');
  assert.equal(result.transportPath[0].transport,'libp2p');
  await waitFor(async()=>(await api('a','/v1/mesh/links')).links.find(l=>l.to==='node-b'&&l.transport==='libp2p')?.online);
  await api('a','/v1/mesh/transports/tcp','POST',{online:true});
  await waitFor(async()=>(await api('a','/v1/mesh/links')).links.find(l=>l.to==='node-b'&&l.transport==='tcp')?.online);
});
test('real TCP receiver rejects replayed and tampered signed messages',async()=>{
  const a=loadIdentity(path.join(root,'a','identity.json'),'node-a'), sender=new TcpTransport(0,()=>{});
  const hello=envelope(a,'PEER_HELLO',{advertisements:[]},{destinationNodeId:'node-b'});
  const target={tcp:{host:'127.0.0.1',port:tcp('b')}};
  assert.equal((await sender.send(target,hello)).messageType,'PEER_HELLO');
  await assert.rejects(sender.send(target,hello));
  await assert.rejects(sender.send(target,{...envelope(a,'PEER_HELLO',{advertisements:[]},{destinationNodeId:'node-b'}),payload:{advertisements:[{forged:true}]}}));
});
test('node B failure reroutes through D and preserves one settlement',async()=>{
  stop('b');
  await waitFor(async()=>!(await api('a','/v1/mesh/peers')).peers.find(p=>p.nodeId==='node-b').online,9000);
  const intent=await api('a','/v1/intents','POST',payment());
  const result=await executeAndWait(intent.id);
  assert.equal(result.state,'settled',JSON.stringify(result));
  assert.deepEqual(result.meshPath,['node-a','node-d','node-c']);
  assert.deepEqual(result.transportPath.map(e=>e.transport),['libp2p','tcp']);
  const duplicate=await api('a',`/v1/intents/${intent.id}/execute`,'POST');
  assert.equal(duplicate.receipt.receiptId,result.receipt.receiptId);
  assert.equal((await api('c','/v1/transactions')).transactions.filter(t=>t.intentId===intent.id).length,1);
});
test('store and forward after settlement node restart; identity persists',async()=>{
  const before=(await api('c','/v1/mesh/node')).peerId;
  stop('c');
  await waitFor(async()=>!(await api('d','/v1/mesh/peers')).peers.find(p=>p.nodeId==='node-c').online,9000);
  const intent=await api('a','/v1/intents','POST',payment());
  const queued=await api('a',`/v1/intents/${intent.id}/execute`,'POST'); assert.equal(queued.state,'queued_for_mesh');
  start('c');
  await waitFor(async()=>(await api('c','/v1/mesh/node')).peerId===before);
  const result=await waitFor(async()=>{const i=await api('a',`/v1/intents/${intent.id}`);return i.state==='settled'?i:null;},30000);
  assert.equal(result.receiptVerified,true);
});
test('relay persists a bundle across a broken next hop and forwards after recovery',async()=>{
  start('b');
  await waitFor(async()=>(await api('a','/v1/mesh/peers')).peers.find(p=>p.nodeId==='node-b')?.online);
  await waitFor(async()=>(await api('b','/v1/mesh/topology')).topology.nodes.length>=4);
  stop('c');
  const intent=await api('a','/v1/intents','POST',payment());
  const queued=await api('a',`/v1/intents/${intent.id}/execute`,'POST');
  assert.equal(queued.state,'queued_for_mesh');
  const relay=await waitFor(async()=>{
    for(const id of ['b','d']) if((await api(id,'/v1/mesh/queue')).queue.some(x=>x.intentId===intent.id && x.type==='payment')) return id;
    return null;
  },10000);
  stop(relay);start(relay);
  await waitFor(async()=>(await api(relay,'/v1/mesh/queue')).queue.some(x=>x.intentId===intent.id && x.type==='payment'));
  start('c');
  const settled=await waitFor(async()=>{const value=await api('a',`/v1/intents/${intent.id}`); return value.state==='settled'?value:null;},30000);
  assert.equal(settled.receiptVerified,true);
  assert.equal((await api('c','/v1/transactions')).transactions.filter(x=>x.intentId===intent.id).length,1);
});
