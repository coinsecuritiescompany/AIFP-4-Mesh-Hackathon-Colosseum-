import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { MeshService } from '../src/service.js';
import { createServer } from '../src/server.js';
const route={id:'mock',rail:'mock',network:'sandbox',asset:'USDC',online:true,feeBps:10,fixedFeeMinor:0,latencyMs:80,supportsOfflineQueue:true,minAmountMinor:1,maxAmountMinor:1000000};
const wait=async fn=>{for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI condition timed out');};
test('dashboard handles loading, form authorization, execution, live refresh and preserves typed forms',async()=>{
  const service=new MeshService({routes:[route]});
  const server=createServer({service,apiKey:'sandbox-demo-key'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {window}=parseHTML(fs.readFileSync('public/index.html','utf8'));
  const {document}=window, intervals=[];
  const fetch=(url,options={})=>new Promise((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port:server.address().port,path:url,method:options.method,headers:options.headers},response=>{
      let raw='';response.on('data',c=>raw+=c);response.on('end',()=>resolve({ok:response.statusCode<400,status:response.statusCode,json:async()=>JSON.parse(raw)}));
    });request.on('error',reject);request.end(options.body);
  });
  const context=vm.createContext({document,fetch,sessionStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID},setTimeout,setInterval:fn=>intervals.push(fn),FormData:class {constructor(form){this.entries=Array.from(form.querySelectorAll('[name]')).map(el=>[el.name,el.value ?? el.getAttribute('value')]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}});
  try {
    vm.runInContext(fs.readFileSync('public/app.js','utf8'),context);
    document.querySelector('[data-page="pay"]').click(); // safe while loading
    await wait(()=>document.querySelector('#view').textContent.includes('How a payment moves'));
    document.querySelector('[data-page="pay"]').click();
    const form=document.querySelector('#payment-form');
    const fields={agentId:'agent_demo',asset:'USDC',amountMinor:'250',beneficiary:'ai-data-api',purpose:'UI test'};
    for(const [name,value] of Object.entries(fields)) {
      const el=form.querySelector(`[name="${name}"]`);
      // linkedom select.value is getter-only; pin the chosen browser value.
      Object.defineProperty(el,'value',{value,writable:true,configurable:true});
    }
    form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    await wait(()=>document.querySelector('#execute-button'));
    assert.equal(service.store.all('transactions').length,0);
    document.querySelector('#execute-button').click();
    await wait(()=>service.store.all('transactions').length===1 && document.querySelector('#view').textContent.includes('Settlement recorded'));
    document.querySelector('[data-page="overview"]').click();
    const extra=service.createIntent({idempotencyKey:'ui-background',agentId:'agent_demo',asset:'USDC',amountMinor:100,beneficiary:'api',purpose:'Background'});
    await service.execute(extra.id);
    await intervals[0]();
    assert.ok(document.querySelector('#view').textContent.includes(extra.id.slice(0,18)));
    document.querySelector('[data-page="pay"]').click();
    document.querySelector('[name="purpose"]').value='Do not erase';
    await intervals[0]();
    assert.equal(document.querySelector('[name="purpose"]').value,'Do not erase');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
