'use strict';
const {digest}=require('./evidence-archive');
function createLotActions({repository,archive,actions,actorFor}){
 const check=(ok,m)=>{if(!ok)throw Error(m)};
 async function preflight(j){const a=actorFor(j.user_id),p=j.payload;check(['aggregator','processor','manufacturer'].includes(a.role)&&a.identity===p.actor.identity&&a.msp===p.actor.msp,'Custodian membership changed');for(const input of p.inputs){const {batch:b}=await actions.history(j.user_id,input.batchId);check(b.owner===a.identity&&b.ownerMsp===a.msp&&!b.pendingTransfer&&['VERIFIED','PROCESSED'].includes(b.status)&&b.sequence===input.expectedSequence,'Source custody or state changed');}}
 async function submit(uid,id,input){
  const a=actorFor(uid);check(['aggregator','processor','manufacturer'].includes(a.role),'Custodian required');check(/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId),'Invalid request');const key='lot:'+input.requestId;
  if(!input.action){const j=await repository.get(uid,key);check(j&&j.batch_id===id,'Request not found');return actions.response(j);}
  check(['SPLIT','MERGE'].includes(input.action),'Invalid lot action');check(typeof input.notes==='string'&&input.notes.trim().length>=10&&input.notes.length<=4000,'Explain the lot operation');check(Number.isSafeInteger(input.lossGrams)&&input.lossGrams>=0,'Enter nonnegative whole grams of loss');
  const inputs=input.action==='SPLIT'?[{batchId:id,expectedSequence:input.expectedSequence}]:input.inputs;
  check(Array.isArray(inputs)&&inputs.length>=1&&inputs.length<=20&&inputs[0].batchId===id,'First source must match this batch');
  for(const i of inputs)check(/^[A-Za-z0-9_-]{1,80}$/.test(i.batchId)&&Number.isSafeInteger(i.expectedSequence)&&i.expectedSequence>0,'Invalid source reference');
  let spec={lossGrams:input.lossGrams};if(input.action==='SPLIT'){check(Array.isArray(input.outputs)&&input.outputs.length>=2&&input.outputs.length<=20,'Choose 2 to 20 outputs');spec.outputs=input.outputs.map(o=>{check(/^LOT-[A-Za-z0-9_-]{1,76}$/.test(o.batchId)&&Number.isSafeInteger(o.quantityGrams)&&o.quantityGrams>0,'Invalid output lot');return {batchId:o.batchId,quantityGrams:o.quantityGrams}});spec.expectedSequence=input.expectedSequence;}else{check(inputs.length>=2&&/^LOT-[A-Za-z0-9_-]{1,76}$/.test(input.outputId),'Choose at least two source lots');spec.inputs=inputs;spec.outputId=input.outputId;}
  const document={version:1,batchId:id,submittedBy:uid,action:input.action,notes:input.notes.trim(),spec},bytes=Buffer.from(JSON.stringify(document)),evidenceHash=digest(bytes);await archive.put(id,'operation',bytes,evidenceHash);spec={...spec,evidenceHash};
  const payload={requestId:input.requestId,inputs,evidenceHash,actor:{identity:a.identity,msp:a.msp,role:a.role},method:input.action==='SPLIT'?'SplitBatch':'MergeBatches',event:input.action==='SPLIT'?'SPLIT':'MERGED',args:input.action==='SPLIT'?[id,JSON.stringify(spec)]:[JSON.stringify(spec)]};
  if(!await repository.get(uid,key))await preflight({user_id:uid,payload});
  return actions.response(await repository.enqueue({userId:uid,requestKey:key,batchId:id,operation:input.action,payload}));
 }
 return {submit,preflight};
}
module.exports={createLotActions};
