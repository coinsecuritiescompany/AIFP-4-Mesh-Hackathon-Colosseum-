import { MeshService } from '../service.js';
import { IntentStore } from '../store.js';
import { createServer } from '../server.js';
import { SolanaDevnetAdapter } from '../adapters/solana-devnet.js';
import { validateRuntimeSecurity } from '../runtime-security.js';
import { MeshNode } from './node.js';

const env=process.env, nodeId=env.MESH_NODE_ID;
if(!/^[a-z0-9-]{1,48}$/.test(nodeId ?? '')) throw new Error('MESH_NODE_ID is required');
const {apiKey,signingSecret}=validateRuntimeSecurity(env);
const dir=env.MESH_DATA_DIR ?? `.data/${nodeId}`;
const routes=[];
if(env.MESH_SETTLE_MOCK==='true') routes.push({id:'route_mock_usdc',rail:'mock',network:'sandbox',asset:'USDC',online:true,feeBps:10,fixedFeeMinor:0,latencyMs:80,supportsOfflineQueue:true,minAmountMinor:1,maxAmountMinor:1000000});
if(env.SOLANA_PAYER_SECRET_JSON) routes.push({id:'route_solana_sol',rail:'solana-devnet',network:'solana-devnet',asset:'SOL',online:true,feeBps:0,fixedFeeMinor:0,latencyMs:450,supportsOfflineQueue:true,minAmountMinor:1,maxAmountMinor:1000000});
const service=new MeshService({routes,store:new IntentStore(`${dir}/payments.json`),signingSecret:nodeId==='node-a'?signingSecret:'',meshMode:true});
if(env.SOLANA_PAYER_SECRET_JSON) service.registerAdapter('solana-devnet',new SolanaDevnetAdapter(env.SOLANA_PAYER_SECRET_JSON));
const peers=Object.fromEntries(JSON.parse(env.MESH_PEERS ?? '[]').map(p=>[p.id,p]));
const mesh=new MeshNode({nodeId,dataDir:dir,peers,service,tcpPort:Number(env.MESH_TCP_PORT ?? 4100),p2pPort:Number(env.MESH_P2P_PORT ?? 4200),tickMs:Number(env.MESH_TICK_MS ?? 2000)});
await mesh.start();
const server=createServer({service,apiKey,mesh});
server.listen(Number(env.PORT ?? 4044),'0.0.0.0',()=>console.log(`Mesh ${nodeId} API ready; peerId ${mesh.transports.get('libp2p').peerId}`));
async function close() { server.close(); await mesh.stop(); process.exit(0); }
process.on('SIGTERM',close); process.on('SIGINT',close);
