'use strict';
const {actions}=require('./dashboard');
function createIndexRepository({url,key,fetchImpl=fetch}){
  if(!url||!key)throw Error('Batch index requires server-side Supabase credentials');
  const base=new URL(url);if(base.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Index API requires HTTPS');
  async function rpc(name,body){
    let r;try{r=await fetchImpl(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw Object.assign(Error('Batch index unavailable; retry later'),{statusCode:503});}
    if(!r.ok)throw Object.assign(Error('Batch index rejected the request; check indexer and database configuration'),{statusCode:503});
    return r.json();
  }
  return {head:channel=>rpc('hc_index_head',{p_channel:channel}),apply:update=>rpc('hc_apply_block',update),page:params=>rpc('hc_list_batches',params)};
}
function createIndexedDashboard({repository,actorFor,channel}){
  return {async list(uid,query=new URLSearchParams()){
    const a=actorFor(uid),limit=Number(query.get('limit')||25),after=query.get('cursor')||null,q=(query.get('q')||'').trim(),filter=query.get('filter')||'all';
    if(!Number.isInteger(limit)||limit<1||limit>50||q.length>160||after&&!/^[A-Za-z0-9_-]{1,80}$/.test(after)||!['all','tasks','incoming','closed'].includes(filter))throw Object.assign(Error('Invalid batch search or page size'),{statusCode:400});
    const result=await repository.page({p_user:uid,p_channel:channel,p_after:after,p_limit:limit,p_query:q,p_filter:filter});
    if(!result||!Array.isArray(result.rows))throw Error('Invalid batch index response');
    // The RPC has already scoped this page to current membership and assignments.
    const pageActor={...a,assignments:new Set(result.rows.map(row=>row.state.batchId))};
    const same=x=>x?.identity===a.identity&&x?.msp===a.msp;
    const batches=result.rows.map(row=>{const b=row.state,inCustody=b.owner===a.identity&&b.ownerMsp===a.msp;return {batchId:b.batchId,species:b.species,originRegion:b.originRegion,quantityGrams:b.quantityGrams,status:b.status,sequence:b.sequence,labPassed:b.labPassed,productName:b.productName||null,demoStatus:/\bDEMO\b/i.test(b.productName||'')?'SIMULATED':'UNKNOWN',incoming:same(b.pendingTransfer),outgoing:inCustody&&!!b.pendingTransfer,inCustody,published:row.published,actions:actions({batch:b},pageActor)};});
    return {role:a.role,name:a.name,batches,stats:result.stats,pagination:{nextCursor:result.nextCursor,limit,filteredCount:result.filteredCount},indexedThroughBlock:result.indexedThroughBlock,indexedAt:result.indexedAt,checkedAt:new Date().toISOString(),scope:'Committed batches from the database index. Recent transactions may appear after the indexer catches up.',warnings:result.indexedAt?[]:['The batch index has not processed any blocks yet.'],indexed:true};
  }};
}
module.exports={createIndexRepository,createIndexedDashboard};
