'use strict';
const {digest}=require('./evidence-archive');
const {normalize:harvestInput}=require('./harvests');
const {normalize:operationInput,available}=require('./lifecycle');
const {canInspectAssignment}=require('./memberships');
const check=(ok,message)=>{if(!ok)throw Error(message)};
const opMap={LAB:['RecordLabResult','LAB_TESTED'],PROCESS:['RecordProcessing','PROCESSED'],PACKAGE:['PackageBatch','PACKAGED'],DELIVER:['RecordDelivery','DELIVERED'],RECALL:['RecallBatch','RECALLED']};
function createQueuedActions({repository,archive,cloudEvidence,contractFor,actorFor,prepareDirectory,directoryFor}){
 async function history(uid,id){return JSON.parse(Buffer.from(await contractFor(uid).evaluateTransaction('GetProvenance',id)).toString());}
 function response(j){return {jobId:j.id,batchId:j.batch_id,requestId:j.payload.requestId,clientId:j.payload.clientId,evidenceHash:j.payload.evidenceHash,transactionId:j.transaction_id,committed:j.state==='completed',evidenceStored:true,status:j.state==='completed'?j.result.status:j.state==='rejected'?'REQUEST_REJECTED':'REGISTRATION_PENDING',queueState:j.state,message:j.state==='rejected'?'Request rejected. Inspect activity and refresh the batch before a new action.':j.state==='reconcile'?'Checking the ledger outcome. Do not create a replacement request.':'Saved for processing. Check activity for the outcome.'};}
 async function save(uid,key,id,operation,payload){return response(await repository.enqueue({userId:uid,requestKey:key,batchId:id,operation,payload}));}
 async function store(id,kind,document){const bytes=Buffer.from(JSON.stringify(document)),hash=digest(bytes);await archive.put(id,kind,bytes,hash);return hash;}
 async function preflight(j){
  const uid=j.user_id,p=j.payload,a=actorFor(uid);check(a.identity===p.actor.identity&&a.msp===p.actor.msp&&a.role===p.actor.role,'Signing membership changed');check(canInspectAssignment(a,j.batch_id),'Batch assignment required');
  if(j.operation==='HARVEST'){check(a.role==='collector','Collector required');return;}
  const h=await history(uid,j.batch_id),b=h.batch;check(b.sequence===p.expectedSequence,'Batch changed; refresh before a new request');
  if(j.operation==='REVIEW'){check(a.role==='verifier'&&b.status==='PENDING_REVIEW','Review unavailable');const data=await cloudEvidence.harvest(h);check(data.manifest.submittedBy!==uid,'Self review is forbidden');check(data.manifest.batchId===j.batch_id&&b.harvestEvidenceHash===p.harvestEvidenceHash,'Harvest evidence changed');}
  else if(j.operation==='TRANSFER'){
   const owns=b.owner===a.identity&&b.ownerMsp===a.msp,same=b.pendingTransfer?.identity===a.identity&&b.pendingTransfer?.msp===a.msp;
   check(['collector','aggregator','processor','manufacturer','distributor'].includes(a.role),'Supply role required');check(!['PENDING_REVIEW','REJECTED','RECALLED','DELIVERED','CONSUMED'].includes(b.status),'Batch is closed');
   if(p.action==='PROPOSE'){check(owns&&!b.pendingTransfer,'Transfer unavailable');await prepareDirectory();check(directoryFor(uid).some(x=>x.uid===p.recipientUid),'Recipient unavailable');const recipient=actorFor(p.recipientUid);check(recipient.identity===p.args[1]&&recipient.msp===p.args[2]&&recipient.identity!==a.identity,'Recipient binding changed');}
   else check(p.action==='ACCEPT'?same&&a.role!=='collector':owns&&!!b.pendingTransfer,'Transfer unavailable');
  }else {check(available(b,a).includes(j.operation),'Operation unavailable');if(j.operation==='PROCESS')check(p.outputGrams<=b.quantityGrams,'Output exceeds input mass');}
 }
 async function submit(uid,type,id,input){
  const a=actorFor(uid);let key,p,document;
  if(type==='HARVEST'){
   check(a.role==='collector','Collector required');const n=harvestInput(input);id='HC-'+digest(uid+':'+n.clientId).slice(0,40);key='harvest:'+n.clientId;
   document={schema:1,submittedBy:uid,batchId:id,...n.record};
   for(const photo of n.photos)await archive.put(id,'photo',photo.bytes,photo.sha256);
   const evidenceHash=await store(id,'manifest',document);
   p={clientId:n.clientId,evidenceHash,method:'CreateBatch',event:'COLLECTED',args:[JSON.stringify({batchId:id,species:n.record.declaredSpecies,originRegion:n.record.originRegion,quantityGrams:n.record.quantityGrams,harvestEvidenceHash:evidenceHash})]};
  }else{
   check(/^[A-Za-z0-9_-]{1,80}$/.test(id),'Invalid batch');
   if(type==='REVIEW'){
    check(a.role==='verifier'&&canInspectAssignment(a,id),'Assigned reviewer required');check(input.examined===true&&['APPROVE','REJECT'].includes(input.decision)&&typeof input.notes==='string'&&input.notes.trim().length>=10&&input.notes.length<=4000,'Invalid review');
    key='review:'+id;const old=await repository.get(uid,key);const h=await history(uid,id);
    const originalSeq=old?.payload.expectedSequence??h.batch.sequence;
    document={schema:1,batchId:id,reviewedBy:uid,decision:input.decision,notes:input.notes.trim(),harvestEvidenceHash:input.evidenceHash,examined:true};
    const evidenceHash=await store(id,'review',document);p={evidenceHash,harvestEvidenceHash:input.evidenceHash,expectedSequence:originalSeq,method:'ReviewBatch',event:'REVIEWED',args:[id,input.decision,evidenceHash]};
   }else{
    check(/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId),'Invalid request ID');key=(type==='TRANSFER'?'transfer:':'operation:')+input.requestId;
    if(!input.action){const old=await repository.get(uid,key);check(old&&old.batch_id===id,'Saved request not found');return response(old);}
    if(type==='TRANSFER'){
     check(['PROPOSE','ACCEPT','CANCEL'].includes(input.action)&&Number.isSafeInteger(input.expectedSequence)&&input.expectedSequence>0,'Invalid handoff');
     let args=[id];if(input.action==='PROPOSE'){await prepareDirectory();check(directoryFor(uid).some(x=>x.uid===input.recipientUid),'Recipient unavailable');const recipient=actorFor(input.recipientUid);args=[id,recipient.identity,recipient.msp];}
     p={requestId:input.requestId,action:input.action,expectedSequence:input.expectedSequence,recipientUid:input.action==='PROPOSE'?input.recipientUid:null,method:{PROPOSE:'ProposeTransfer',ACCEPT:'AcceptTransfer',CANCEL:'CancelTransfer'}[input.action],event:{PROPOSE:'TRANSFER_PROPOSED',ACCEPT:'TRANSFER_ACCEPTED',CANCEL:'TRANSFER_CANCELLED'}[input.action],args};
    }else{
     const n=operationInput(input);type=n.action;const {attachment,...fields}=n;const attachmentHash=attachment?digest(Buffer.from(attachment,'base64')):null;
     document={version:1,batchId:id,submittedBy:uid,...fields,attachmentHash};if(attachment)await archive.put(id,'report',Buffer.from(attachment,'base64'),attachmentHash);
     const evidenceHash=await store(id,'operation',document),args=type==='LAB'?[id,n.outcome,evidenceHash]:type==='PROCESS'?[id,n.label,String(n.outputGrams),evidenceHash]:type==='PACKAGE'?[id,n.label,evidenceHash]:[id,evidenceHash];
     p={requestId:input.requestId,expectedSequence:n.expectedSequence,outputGrams:n.outputGrams??null,evidenceHash,method:opMap[type][0],event:opMap[type][1],args};
    }
   }
  }
  p.actor={identity:a.identity,msp:a.msp,role:a.role};
  const existing=await repository.get(uid,key);
  // Exact retries stay valid after the batch advances. SQL compares immutable JSON content.
  if(!existing)await preflight({user_id:uid,batch_id:id,operation:type,payload:p});
  return save(uid,key,id,type,p);
 }
 return {submit,preflight,response,history};
}
module.exports={createQueuedActions};
