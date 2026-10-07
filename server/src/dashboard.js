'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { available } = require('./lifecycle');
const { canInspectAssignment } = require('./memberships');
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
function check(ok,message) { if (!ok) throw Error(message); }
const same = (x,a) => x?.identity === a.identity && x?.msp === a.msp;
const owns = (b,a) => b.owner === a.identity && b.ownerMsp === a.msp;
function canView(h,a) { if(['verifier','lab','regulator'].includes(a.role))return canInspectAssignment(a,h.batch.batchId);return owns(h.batch,a) || same(h.batch.pendingTransfer,a) || h.events.some(e=>same(e.actor,a)); }
function actions(h,a) {
  const b=h.batch, list=[];
  if(a.role==='verifier' && b.status==='PENDING_REVIEW') list.push({label:'Review harvest',page:'review'});
  if(['collector','aggregator','processor','manufacturer','distributor'].includes(a.role) && !['PENDING_REVIEW','REJECTED','RECALLED','DELIVERED','CONSUMED'].includes(b.status) && (owns(b,a)||same(b.pendingTransfer,a))) list.push({label:same(b.pendingTransfer,a)?'Accept incoming handoff':b.pendingTransfer?'Manage outgoing handoff':'Transfer custody',page:'custody'});
  for(const action of available(b,a)) list.push({label:{LAB:'Record lab result',PROCESS:'Record processing',PACKAGE:'Record packaging',DELIVER:'Record delivery',RECALL:'Recall batch'}[action],page:'operations'});
  return list.filter((item,index,all)=>all.findIndex(x=>x.page===item.page)===index);
}
function createDashboardService({directory,contractFor,actorFor,cloudEvidence=null}) {
  function valid(id){check(typeof id==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(id),'Invalid batch ID');}
  async function history(uid,id){valid(id);return JSON.parse(Buffer.from(await contractFor(uid).evaluateTransaction('GetProvenance',id)).toString());}
  async function authorized(uid,id){const a=actorFor(uid),h=await history(uid,id);check(canView(h,a),'Batch is not assigned to this account');return {a,h};}
  async function records(){let entries;try{entries=await fs.readdir(path.join(directory,'.lifecycle'))}catch(e){if(e.code==='ENOENT')return [];throw e;}const out=[];for(const name of entries){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;out.push(JSON.parse(await fs.readFile(path.join(directory,'.lifecycle',name),'utf8')));}return out;}
  function verifiedRecords(h,all){const out=[];for(const r of all){if(r.batchId!==h.batch.batchId)continue;const e=h.events.find(e=>Object.values(e.details||{}).includes(r.evidenceHash));if(!e)continue;check(sha(JSON.stringify(r.document))===r.evidenceHash,'Operation evidence integrity check failed');check(r.document.batchId===h.batch.batchId,'Evidence batch mismatch');if(r.document.attachmentHash){check(typeof r.input?.attachment==='string' && sha(Buffer.from(r.input.attachment,'base64'))===r.document.attachmentHash,'Report integrity check failed');}out.push({record:r,event:e});}return out;}
  async function verified(h){return cloudEvidence?cloudEvidence.operations(h):verifiedRecords(h,await records());}
  function demoStatus(h,verified){if(/\bDEMO\b/i.test(h.batch.productName||'')||verified.some(x=>x.record.document.demo===true))return 'SIMULATED';const ops=h.events.filter(e=>['LAB_TESTED','PROCESSED','PACKAGED','DELIVERED','RECALLED'].includes(e.type));return ops.length && ops.every(e=>verified.some(x=>x.event.transactionId===e.transactionId))?'NOT_MARKED':'UNKNOWN';}
  async function publicDemo(h){try{return demoStatus(h,await verified(h));}catch{return 'UNKNOWN';}}
  function summary(h,a,demo){const b=h.batch;return {batchId:b.batchId,species:b.species,originRegion:b.originRegion,quantityGrams:b.quantityGrams,status:b.status,sequence:b.sequence,labPassed:b.labPassed,productName:b.productName||null,demoStatus:demo,incoming:same(b.pendingTransfer,a),outgoing:owns(b,a)&&!!b.pendingTransfer,inCustody:owns(b,a),published:h.events.some(e=>e.type==='PACKAGED'),actions:actions(h,a)};}
  async function list(uid){const a=actorFor(uid),all=cloudEvidence?[]:await records(),batches=[],warnings=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(!entry.isDirectory()||!/^HC-[a-f0-9]{40}$/.test(entry.name)||!canInspectAssignment(a,entry.name))continue;let h;try{h=await history(uid,entry.name);}catch(e){if(/Batch not found/.test(e.message)){warnings.push('Some local submissions are not yet recorded on Fabric.');continue;}throw e;}if(!canView(h,a))continue;let demo='UNKNOWN';try{demo=demoStatus(h,cloudEvidence?await verified(h):verifiedRecords(h,all))}catch{warnings.push(entry.name+': evidence integrity check failed');}batches.push(summary(h,a,demo));}return {role:a.role,name:a.name,batches,warnings:[...new Set(warnings)],scope:'Harvests stored by this backend; refreshed from Fabric',checkedAt:new Date().toISOString()};}
  async function evidence(uid,id){const {a,h}=await authorized(uid,id);return evidenceFor(a,h,id);}
  async function evidenceFor(a,h,id){const verifiedItems=await verified(h);const operations=verifiedItems.map(({record:r,event:e})=>({type:e.type,sequence:e.sequence,transactionId:e.transactionId,evidenceHash:r.evidenceHash,demo:r.document.demo,notes:r.document.notes,label:r.document.label,outcome:r.document.outcome,outputGrams:r.document.outputGrams,hasReport:!!r.document.attachmentHash}));
    let harvest=null,review=null;
    const canReadHarvest=['verifier','regulator'].includes(a.role)||(a.role==='collector' && h.events.some(e=>e.type==='COLLECTED'&&same(e.actor,a)));
    if(canReadHarvest && /^HC-[a-f0-9]{40}$/.test(id)){
      if(cloudEvidence){
        const data=await cloudEvidence.harvest(h);const {submittedBy,...manifest}=data.manifest;
        harvest={manifest,photos:data.photos.map(p=>({base64:p.base64}))};
        const r=await cloudEvidence.review(h);if(r)review={decision:r.document.decision,notes:r.document.notes,transactionId:r.event.transactionId};
      }else{
      const bytes=await fs.readFile(path.join(directory,id,'manifest.json'));check(sha(bytes)===h.batch.harvestEvidenceHash,'Harvest manifest integrity check failed');const m=JSON.parse(bytes);check(m.batchId===id,'Harvest batch mismatch');
      const photos=[];for(const p of m.photos){check(/^[a-f0-9]{64}$/.test(p.sha256),'Invalid photo digest');const bytes=await fs.readFile(path.join(directory,id,p.sha256+'.jpg'));check(sha(bytes)===p.sha256,'Photo integrity check failed');photos.push({base64:bytes.toString('base64')});}
      const {submittedBy,...manifest}=m;harvest={manifest,photos};
      try{const r=JSON.parse(await fs.readFile(path.join(directory,id,'review.json'),'utf8'));const e=h.events.find(e=>e.type==='REVIEWED'&&e.details.evidenceHash===r.evidenceHash);if(e){check(sha(JSON.stringify(r.document))===r.evidenceHash,'Review integrity check failed');review={decision:r.document.decision,notes:r.document.notes,transactionId:e.transactionId};}}catch(e){if(e.code!=='ENOENT')throw e;}
      }
    }
    return {batch:summary(h,a,demoStatus(h,verifiedItems)),operations,harvest,review,events:h.events.map(e=>({type:e.type,sequence:e.sequence,timestampSeconds:e.timestampSeconds,transactionId:e.transactionId}))};
  }
  async function report(uid,id,digest){check(/^[a-f0-9]{64}$/.test(digest),'Invalid report digest');const {h}=await authorized(uid,id);if(cloudEvidence)return cloudEvidence.report(h,digest);const found=verifiedRecords(h,await records()).find(x=>x.record.evidenceHash===digest);check(found?.record.document.attachmentHash,'No verified PDF for this event');return Buffer.from(found.record.input.attachment,'base64');}
  async function passport(uid,id) {
    const {a,h}=await authorized(uid,id), data=await evidenceFor(a,h,id);
    const holder=h.events.slice().reverse().find(e=>e.actor?.identity===h.batch.owner&&e.actor?.msp===h.batch.ownerMsp)?.actor;
    return {...data,relations:{parents:h.batch.parents||[],children:h.batch.children||[]},currentHolder:{role:holder?.role||null,isYou:owns(h.batch,a),name:owns(h.batch,a)?a.name:null},pendingTransfer:!!h.batch.pendingTransfer,
      timeline:h.events.map(e=>({type:e.type,sequence:e.sequence,timestampSeconds:e.timestampSeconds,role:e.actor?.role||null,isYou:same(e.actor,a),
        details:Object.fromEntries(Object.entries(e.details||{}).filter(([k])=>['decision','outcome','method','inputGrams','outputGrams','lossGrams','productName','quantityGrams'].includes(k)))}))};
  }
  return {list,evidence,passport,report,publicDemo, async provenance(uid,id){return (await authorized(uid,id)).h;}};
}
module.exports={createDashboardService,canView,actions};
