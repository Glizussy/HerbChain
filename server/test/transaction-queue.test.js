'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {createTransactionQueue}=require('../src/transaction-queue');
test('queue adapter uses server-only RPCs and preserves request and lease identifiers',async()=>{
 const calls=[];const q=createTransactionQueue({url:'https://example.supabase.co',key:'server-key',fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(true);}});
 await q.enqueue({userId:'user',requestKey:'request',batchId:'batch',operation:'LAB',payload:{evidenceHash:'hash'}});
 await q.claim();await q.heartbeat('job','lease');await q.recordTransaction('job','lease','tx');await q.finish('job','lease','reconcile',{reason:'unknown'});
 assert.equal(calls.length,5);assert.equal(JSON.parse(calls[0].options.body).p_user,'user');assert.equal(JSON.parse(calls[3].options.body).p_transaction,'tx');assert.equal(JSON.parse(calls[4].options.body).p_token,'lease');
 assert.ok(calls.every(c=>c.options.redirect==='error'&&c.options.headers.Authorization==='Bearer server-key'));
});
test('queue failures do not expose database responses or credentials',async()=>{
 for(const fetchImpl of [async()=>{throw Error('server-key')},async()=>new Response('server-key',{status:500}),async()=>new Response('invalid-json')]){
  const q=createTransactionQueue({url:'https://example.supabase.co',key:'server-key',fetchImpl});await assert.rejects(q.claim(),e=>e.statusCode===503&&!e.message.includes('server-key'));
 }
 assert.throws(()=>createTransactionQueue({url:'http://example.com',key:'x'}),/HTTPS/);
});
