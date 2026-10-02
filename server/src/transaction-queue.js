'use strict';
// Internal server repository. Queue records include private data; never return them wholesale to clients.
function createTransactionQueue({url,key,fetchImpl=fetch}){
 const base=new URL(url);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('Transaction queue requires HTTPS project origin');
 if(!key)throw Error('Transaction queue requires a server credential');
 async function rpc(name,payload){
  let response;
  try{response=await fetchImpl(base.origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Object.assign(Error('Transaction queue unavailable'),{statusCode:503});}
  if(!response.ok)throw Object.assign(Error('Transaction queue request rejected'),{statusCode:503});
  try{return await response.json();}catch{throw Object.assign(Error('Invalid transaction queue response'),{statusCode:503});}
 }
 return {
  enqueue:({userId,requestKey,batchId,operation,payload})=>rpc('hc_enqueue_job',{p_user:userId,p_key:requestKey,p_batch:batchId,p_operation:operation,p_payload:payload}),
  retry:(uid,id)=>rpc('hc_retry_rejected_job',{p_user:uid,p_id:id}),
  get:(uid,key)=>rpc('hc_get_job',{p_user:uid,p_key:key}),
  list:(uid,before=null)=>rpc('hc_user_jobs',{p_user:uid,p_before:before}),
  uncertain:()=>rpc('hc_uncertain_jobs',{}),
  resolve:(id,transactionId,state,result)=>rpc('hc_resolve_job',{p_id:id,p_transaction:transactionId,p_state:state,p_result:result}),
  claim:(seconds=60)=>rpc('hc_claim_job',{p_seconds:seconds}),
  heartbeat:(id,token,seconds=60)=>rpc('hc_heartbeat_job',{p_id:id,p_token:token,p_seconds:seconds}),
  recordTransaction:(id,token,transactionId)=>rpc('hc_record_job_transaction',{p_id:id,p_token:token,p_transaction:transactionId}),
  finish:(id,token,state,result)=>rpc('hc_finish_job',{p_id:id,p_token:token,p_state:state,p_result:result})
 };
}
module.exports={createTransactionQueue};
