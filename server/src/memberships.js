'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const roleMsp = Object.freeze({collector:'Org1MSP',aggregator:'Org1MSP',processor:'Org1MSP',manufacturer:'Org1MSP',distributor:'Org1MSP',verifier:'Org2MSP',lab:'Org2MSP',regulator:'Org2MSP'});
const oversight = new Set(['verifier','lab','regulator']);
const recipients = new Set(['aggregator','processor','manufacturer','distributor']);
function denied(message='Active enrolled membership required') { return Object.assign(new Error(message),{statusCode:403}); }
function canInspectAssignment(actor,batchId) {
  return actor.scope !== 'assigned' || !oversight.has(actor.role) || actor.assignments?.has(batchId) === true;
}
function createMembershipRepository({url,key,fetchImpl=fetch,pageSize=200}) {
  if(!url || !key) throw Error('Supabase membership mode requires SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY');
  const base=new URL(url);
  if(base.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw Error('Membership API requires HTTPS');
  async function rows(table,params) {
    const all=[];
    for(let offset=0;offset<100000;offset+=pageSize){
      const target=new URL('/rest/v1/'+table,base);target.search=new URLSearchParams({...params,limit:String(pageSize),offset:String(offset)}).toString();
      let r;
      try {r=await fetchImpl(target,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000),redirect:'error'});}catch {throw Object.assign(Error('Membership service unavailable; try again later'),{statusCode:503});}
      if(!r.ok)throw Object.assign(Error('Membership service unavailable; check server configuration'),{statusCode:503});
      const data=await r.json();if(!Array.isArray(data))throw Error('Invalid membership response');
      all.push(...data);if(data.length<pageSize)return all;
    }
    throw Error('Membership result exceeds supported size; narrow the query');
  }
  const select='user_id,organization_id,role,state,display_name,fabric_identity,hc_organizations!inner(id,msp_id,active,name)';
  return {
    async member(uid){const found=await rows('hc_memberships',{select,user_id:'eq.'+uid,order:'user_id.asc'});if(found.length!==1)throw denied();return found[0];},
    async assignments(uid){return rows('hc_batch_assignments',{select:'batch_id,role',user_id:'eq.'+uid,order:'batch_id.asc'});},
    async directory(){return rows('hc_memberships',{select,state:'eq.active',role:'in.(aggregator,processor,manufacturer,distributor)','hc_organizations.active':'eq.true',order:'user_id.asc'});}
  };
}
function createMembershipAccess({identities,mode='file',repository}) {
  if(!['file','supabase'].includes(mode))throw Error('HERBCHAIN_MEMBERSHIP_MODE must be file or supabase');
  if(mode==='supabase'&&!repository)throw Error('Membership repository is required');
  const context=new AsyncLocalStorage();
  function local(uid){if(!Object.hasOwn(identities,uid))throw denied('Account is not enrolled. Ask the administrator to link your account.');return identities[uid];}
  function bind(row){
    const c=local(row.user_id),org=row.hc_organizations;
    if(row.state!=='active'||org?.active!==true)throw denied('Your membership or organization is inactive. Contact the administrator.');
    if(!Object.hasOwn(roleMsp,row.role)||c.role!==row.role||c.mspId!==org.msp_id||roleMsp[row.role]!==org.msp_id||!c.fabricIdentity||c.fabricIdentity!==row.fabric_identity)throw denied('Membership does not match the enrolled Fabric identity');
    return {...c,displayName:row.display_name,organizationId:row.organization_id,organizationName:org.name,scope:'assigned'};
  }
  async function run(uid,fn,{loadAssignments=true}={}){
    if(mode==='file'){local(uid);return fn();}
    const c=bind(await repository.member(uid));
    c.assignments=new Set();
    if(loadAssignments&&oversight.has(c.role))for(const grant of await repository.assignments(uid)){if(grant.role===c.role)c.assignments.add(grant.batch_id);}
    return context.run({uid,bindings:new Map([[uid,c]]),directory:null},fn);
  }
  function config(uid){
    if(mode==='file')return local(uid);
    const state=context.getStore();
    // Public tracing is the sole unauthenticated Fabric identity.
    if(!state&&uid===process.env.PUBLIC_IDENTITY&&local(uid).role==='reader')return local(uid);
    if(!state?.bindings.has(uid))throw denied();return state.bindings.get(uid);
  }
  async function prepareDirectory(){
    if(mode==='file')return;
    const state=context.getStore();if(!state)throw denied();
    if(state.directory!==null)return; // Reuse only within this authenticated request.
    const rows=await repository.directory();state.directory=[];
    for(const row of rows){
      if(!Object.hasOwn(identities,row.user_id))continue; // Not enrolled on this gateway yet.
      const c=bind(row);if(!recipients.has(c.role))continue;
      state.bindings.set(row.user_id,c);state.directory.push(row.user_id);
    }
  }
  function directoryIds(){if(mode==='file')return Object.keys(identities);const state=context.getStore();if(!state?.directory)throw Error('Participant directory not loaded');return state.directory;}
  return {run,config,prepareDirectory,directoryIds};
}
module.exports={createMembershipRepository,createMembershipAccess,canInspectAssignment,roleMsp};
