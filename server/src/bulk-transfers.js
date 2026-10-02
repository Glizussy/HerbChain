'use strict';
function createBulkTransfers(actions){return {async submit(uid,input){
 if(!input||!Array.isArray(input.batches)||input.batches.length<1||input.batches.length>20||!/^[A-Za-z0-9_-]{8,60}$/.test(input.requestId)||typeof input.recipientUid!=='string')throw Error('Select 1 to 20 batches and a recipient');
 const ids=new Set();for(const b of input.batches){if(!b||!/^[A-Za-z0-9_-]{1,80}$/.test(b.batchId)||ids.has(b.batchId)||!Number.isSafeInteger(b.expectedSequence)||b.expectedSequence<1)throw Error('Invalid or duplicate batch selection');ids.add(b.batchId);}
 const results=[];for(const [i,b] of input.batches.entries()){
  try{const result=await actions.submit(uid,'TRANSFER',b.batchId,{requestId:input.requestId+'-'+i,action:'PROPOSE',expectedSequence:b.expectedSequence,recipientUid:input.recipientUid});results.push({batchId:b.batchId,...result});}
  catch{results.push({batchId:b.batchId,committed:false,queueState:'check_required',message:'Could not confirm this request. Retry this saved selection or inspect activity; do not create a replacement yet.'});}
 }return {requestId:input.requestId,results};
}};}
module.exports={createBulkTransfers};
