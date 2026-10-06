import './configure-demo.mjs';
import { loadEnvFile } from 'node:process';
import readline from 'node:readline';
import path from 'node:path';
import { createLocalNetwork, projectRoot } from './local-network.mjs';
import { validateRuntimeSecurity } from '../src/runtime-security.js';
loadEnvFile(path.join(projectRoot,'.env'));
const {apiKey,signingSecret}=validateRuntimeSecurity({...process.env,AIFP4_BIND_HOST:'127.0.0.1'});
const network=await createLocalNetwork({dataDir:path.resolve(projectRoot,process.env.AIFP4_LOCAL_DATA_DIR ?? '.data/local-demo'),basePort:Number(process.env.AIFP4_PORT ?? 4044),apiKey,signingSecret,payer:process.env.SOLANA_PAYER_SECRET_JSON ?? ''});
console.log(`\nREADY: http://127.0.0.1:${network.port('a')}/\nAPI key: ${apiKey}\nFour independent nodes, TCP + libp2p, persistent storage.\nCommands: stop b | start b | stop c | start c | status | quit\nKeep this terminal running while recording your demo.\n`);
const input=readline.createInterface({input:process.stdin,output:process.stdout});
let closing=false, command=Promise.resolve();
async function close(){if(closing)return;closing=true;input.close();await network.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
input.on('line',line=>{
  command=command.then(async()=>{
    const [verb,id]=line.trim().toLowerCase().split(/\s+/);
    if(verb==='quit') return close();
    if(verb==='status') {for(const id of ['a','b','c','d']) console.log(`node-${id}: ${network.children.has(id)?'running':'stopped'}`);return;}
    if(!['stop','start'].includes(verb)||!['a','b','c','d'].includes(id)){console.log('Use stop/start a|b|c|d, status, or quit');return;}
    await network[verb](id);console.log(`node-${id} ${verb==='stop'?'stopped':'started'}`);
  }).catch(error=>console.error(error.message));
});
