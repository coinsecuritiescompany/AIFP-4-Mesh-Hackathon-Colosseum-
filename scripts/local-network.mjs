import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export async function waitFor(fn, timeout = 45000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) return value; } catch (error) { if(error.fatal) throw error; last = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out: ${last?.message ?? 'network did not become ready'}`);
}
export async function createLocalNetwork({ dataDir, basePort = 4044, apiKey, signingSecret, payer = '', tickMs = 800 }) {
  if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65000) throw new Error('AIFP4_PORT must be an integer from 1024 to 65000');
  const ids = ['a','b','c','d'], children = new Map(), logs = new Map();
  const port = id => basePort + ids.indexOf(id);
  const tcp = id => port(id) + 100, p2p = id => port(id) + 200;
  const peer = (id, t, p, tc = 10, pc = 10) => ({ id:`node-${id}`, ...(t ? {tcp:{host:'127.0.0.1',port:tcp(id)}} : {}), ...(p ? {p2p:`/ip4/127.0.0.1/tcp/${p2p(id)}`} : {}), cost:{tcp:tc,libp2p:pc} });
  const peers = { a:[peer('b',true,true,10,35),peer('d',false,true,10,30)], b:[peer('a',true,true,10,35),peer('c',false,true)], c:[peer('b',false,true),peer('d',true,false,20)], d:[peer('a',false,true,10,30),peer('c',true,false,20)] };
  fs.mkdirSync(dataDir, {recursive:true,mode:0o700});
  // Fail before starting any node when one of the required ports is occupied.
  for (const n of ids.flatMap(id => [port(id),tcp(id),p2p(id)])) {
    await new Promise((resolve,reject) => { const server=net.createServer(); server.once('error', () => reject(new Error(`Port ${n} is occupied. Stop the old demo or set AIFP4_PORT to another base port.`))); server.listen(n,'127.0.0.1',()=>server.close(resolve)); });
  }
  async function api(id, route, method='GET', body) {
    // Loopback traffic must bypass enterprise HTTP proxies.
    return new Promise((resolve,reject)=>{
      const payload=body===undefined?undefined:JSON.stringify(body);
      const request=http.request({hostname:'127.0.0.1',port:port(id),path:route,method,headers:{'x-aifp4-api-key':apiKey,'content-type':'application/json',...(payload?{'content-length':Buffer.byteLength(payload)}:{})}},response=>{
        const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
          try {const value=JSON.parse(Buffer.concat(chunks));if(response.statusCode>=400) reject(new Error(`${response.statusCode}: ${JSON.stringify(value)}`));else resolve(value);} catch(error){reject(error);}
        });response.on('error',reject);
      });
      request.setTimeout(5000,()=>request.destroy(new Error('Local API timeout')));request.on('error',reject);request.end(payload);
    });
  }
  async function start(id) {
    if (!ids.includes(id)) throw new Error('Choose a, b, c or d');
    if (children.has(id)) return;
    const child=spawn(process.execPath,['src/mesh/start.js'],{cwd:projectRoot,env:{...process.env, AIFP4_API_KEY:apiKey,MESH_HMAC_SECRET:signingSecret,AIFP4_HTTP_BIND:'127.0.0.1',MESH_TCP_BIND:'127.0.0.1',MESH_P2P_BIND:'127.0.0.1',MESH_NODE_ID:`node-${id}`,MESH_DATA_DIR:path.join(dataDir,id),MESH_PEERS:JSON.stringify(peers[id]),MESH_SETTLE_MOCK:id==='c'?'true':'false',SOLANA_PAYER_SECRET_JSON:id==='c'?payer:'',MESH_TCP_PORT:String(tcp(id)),MESH_P2P_PORT:String(p2p(id)),MESH_TICK_MS:String(tickMs),PORT:String(port(id))},stdio:['ignore','pipe','pipe']});
    children.set(id,child);
    let output='';
    for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{ output=(output+chunk.toString()).slice(-8000); logs.set(id,output); });
    child.on('error',error=>logs.set(id,error.message));
    await waitFor(async()=>{
      if(child.exitCode!==null || child.signalCode!==null) throw Object.assign(new Error(`Node ${id} exited: ${logs.get(id)}`), {fatal:true});
      return (await api(id,'/health')).ok;
    },30000).catch(error=>{throw new Error(`${error.message}\nNode ${id}: ${logs.get(id)}`);});
  }
  async function stop(id, crash=false) {
    const child=children.get(id); if(!child) return;
    children.delete(id);
    if(child.exitCode!==null || child.signalCode!==null) return;
    await new Promise(resolve=>{
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
      child.once('exit',()=>{clearTimeout(timer);resolve();}); child.kill(crash?'SIGKILL':'SIGTERM');
    });
  }
  const close=()=>Promise.all([...children.keys()].map(id=>stop(id)));
  async function ready() {
    await waitFor(async()=>{
      const {topology}=await api('a','/v1/mesh/topology');
      return topology.nodes.length===4 && [['node-a','node-b','tcp'],['node-b','node-c','libp2p'],['node-a','node-d','libp2p'],['node-d','node-c','tcp']].every(([from,to,transport])=>topology.links.some(e=>e.from===from&&e.to===to&&e.transport===transport));
    });
  }
  try { await Promise.all(ids.map(start)); await ready(); }
  catch(error) {await close();throw error;}
  return {api,start,stop,close,ready,port,logs,children};
}
