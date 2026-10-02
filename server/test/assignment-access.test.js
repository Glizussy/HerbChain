'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const {createDashboardService}=require('../src/dashboard');const {createReviewService}=require('../src/reviews');const {createLifecycleService}=require('../src/lifecycle');
test('assignment removal blocks dashboard, raw provenance, review evidence and lifecycle actions despite prior participation',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hc-assignments-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const id='HC-'+'a'.repeat(40);await fs.mkdir(path.join(directory,id));
 const bytes=Buffer.from(JSON.stringify({batchId:id,submittedBy:'farmer',photos:[]}));await fs.writeFile(path.join(directory,id,'manifest.json'),bytes);
 const assignments=new Set([id]);let calls=0;
 const actor=role=>({role,identity:role,msp:'Org2MSP',scope:'assigned',assignments});
 const h={batch:{batchId:id,status:'PENDING_REVIEW',owner:'farmer',ownerMsp:'Org1MSP',quantityGrams:1000,sequence:1,species:'Tulsi',harvestEvidenceHash:crypto.createHash('sha256').update(bytes).digest('hex')},events:[{type:'REVIEWED',actor:actor('verifier'),details:{}},{type:'LAB_TESTED',actor:actor('lab'),details:{}}]};
 const contractFor=()=>({evaluateTransaction:async()=>{calls++;return Buffer.from(JSON.stringify(h));},newProposal:()=>assert.fail('An unassigned operation must not reach Fabric')});
 const dashboard=createDashboardService({directory,contractFor,actorFor:actor});const reviews=createReviewService({directory,contractFor,participantFor:actor});const lifecycle=createLifecycleService({directory,contractFor,actorFor:actor});
 assert.equal((await reviews.queue('verifier')).batches.length,1);assert.equal((await reviews.evidence('verifier',id)).manifest.batchId,id);
 assert.equal((await dashboard.provenance('verifier',id)).batch.batchId,id);assert.equal((await lifecycle.detail('lab',id)).role,'lab');
 assignments.clear();calls=0;
 assert.equal((await reviews.queue('verifier')).batches.length,0);assert.equal((await dashboard.list('lab')).batches.length,0);assert.equal(calls,0);
 for(const role of ['verifier','lab','regulator']){
   await assert.rejects(dashboard.evidence(role,id),/not assigned/);await assert.rejects(dashboard.provenance(role,id),/not assigned/);await assert.rejects(dashboard.report(role,id,'b'.repeat(64)),/not assigned/);
 }
 await assert.rejects(reviews.evidence('verifier',id),/not assigned/);
 await assert.rejects(reviews.submit('verifier',id,{decision:'APPROVE',notes:'I examined the harvest.',examined:true}),/not assigned/);
 for(const role of ['lab','regulator']){await assert.rejects(lifecycle.detail(role,id),/not assigned/);await assert.rejects(lifecycle.submit(role,id,{requestId:'request-123'}),/not assigned/);}
});
