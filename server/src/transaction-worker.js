'use strict';
function createTransactionWorker({repository,withParticipant,contractFor,commitStatusFor,actions}){
 async function reconcile(j){
  if(!j.transaction_id)return repository.resolve(j.id,null,'rejected',{reason:'Worker stopped before a transaction was recorded. Refresh and create a new request.'});
  try{return await withParticipant(j.user_id,async()=>{
   const status=await commitStatusFor(j.user_id,j.transaction_id);
   if(!status.successful)return repository.resolve(j.id,j.transaction_id,'rejected',{reason:'Fabric rejected the transaction',validationCode:status.code});
   const h=await actions.history(j.user_id,j.batch_id),p=j.payload;
   const event=h.events.find(e=>e.transactionId===j.transaction_id&&e.type===p.event&&e.actor.identity===p.actor.identity&&e.actor.msp===p.actor.msp);
   if(!event)throw Error('Expected event missing');
   return repository.resolve(j.id,j.transaction_id,'completed',{status:h.batch.status});
  });}catch{return repository.resolve(j.id,j.transaction_id,'reconcile',{reason:'Awaiting authoritative ledger verification or restored account access'});}
 }
 async function run(j){
  let recorded=false;
  try{await withParticipant(j.user_id,async()=>{
   await actions.preflight(j);
   const proposal=contractFor(j.user_id).newProposal(j.payload.method,{arguments:j.payload.args});
   const endorsed=await proposal.endorse();const predicted=JSON.parse(Buffer.from(endorsed.getResult()).toString());
   if(j.payload.expectedSequence&&predicted.sequence!==j.payload.expectedSequence+1)throw Error('Batch changed during endorsement');
   const tx=proposal.getTransactionId();
   // From this point, a failed acknowledgement could mean the ID was persisted.
   recorded=true;
   if(!await repository.recordTransaction(j.id,j.lease_token,tx))throw Error('Lease lost');
   // Recheck membership/assignments immediately before transmission.
   await withParticipant(j.user_id,()=>actions.preflight(j));
   if(!await repository.heartbeat(j.id,j.lease_token,300))throw Error('Lease lost');
   const commit=await endorsed.submit();const status=await commit.getStatus();
   if(!status.successful){await repository.finish(j.id,j.lease_token,'reconcile',{reason:'Verifying Fabric rejection'});return;}
   const h=await actions.history(j.user_id,j.batch_id);
   if(!h.events.some(e=>e.transactionId===tx&&e.type===j.payload.event&&e.actor.identity===j.payload.actor.identity&&e.actor.msp===j.payload.actor.msp))throw Error('Committed event not yet visible');
   await repository.finish(j.id,j.lease_token,'completed',{status:h.batch.status});
  });}catch{
   // Never fabricate a replacement proposal after an ambiguous transmission.
   try{await repository.finish(j.id,j.lease_token,recorded?'reconcile':'rejected',{reason:recorded?'Ledger outcome needs verification':'Preflight or endorsement failed. Refresh the batch and check account access.'});}catch{/* Lease expiry will quarantine this job. */}
  }
 }
 return {run,reconcile,async tick(){const j=await repository.claim(300);if(j)await run(j);for(const pending of await repository.uncertain())await reconcile(pending);return !!j;}};
}
module.exports={createTransactionWorker};
