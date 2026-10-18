'use strict';
function createAuthProxy({url,key,fetchImpl=fetch,now=()=>Date.now()}){
 const base=new URL(url);if(base.protocol!=='https:')throw Error('Authentication requires HTTPS Supabase URL');
 const limits=new Map();
 async function upstream(endpoint,method,data){
  try{const response=await fetchImpl(new URL('/auth/v1/'+endpoint,base),{method,headers:{apikey:key,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});const payload=await response.json();if(!response.ok)return {status:response.status,data:{code:typeof payload.code==='string'?payload.code:typeof payload.error_code==='string'?payload.error_code:'auth_service_error'}};return {status:200,data:payload};}
  catch{return {status:503,data:{code:'auth_service_unavailable'}};}
 }
 return {async request({action,method,origin,host,address,input}){
  if(origin){try{if(new URL(origin).host!==host)return {status:403,data:{code:'auth_origin_rejected'}};}catch{return {status:403,data:{code:'auth_origin_rejected'}};}}
  if(action==='settings'&&method==='GET')return upstream('settings','GET');
  if(!['login','signup'].includes(action)||method!=='POST')return {status:404,data:{code:'auth_route_unavailable'}};
  const clock=now(),existing=limits.get(address),bucket=existing&&existing.until>clock?existing:{until:clock+60000,count:0};
  if(++bucket.count>20)return {status:429,data:{code:'over_request_rate_limit'}};if(limits.size>=1000&&!limits.has(address))limits.delete(limits.keys().next().value);limits.set(address,bucket);
  if(!input||typeof input.email!=='string'||input.email.length>254||!input.email.includes('@')||typeof input.password!=='string'||!input.password.length||input.password.length>1024)return {status:400,data:{code:'validation_failed'}};
  const credentials={email:input.email.trim(),password:input.password};
  if(action==='signup'){
   const settings=await upstream('settings','GET');if(settings.status!==200)return settings;
   if(settings.data.mailer_autoconfirm!==true)return {status:409,data:{code:'email_confirmation_enabled'}};
   if(settings.data.disable_signup===true)return {status:403,data:{code:'signup_disabled'}};
   const fields=['full_name','requested_role','contact_mobile','organization_name','region'];credentials.data={};for(const field of fields)if(typeof input.data?.[field]==='string')credentials.data[field]=input.data[field].slice(0,160);
  }
  return upstream(action==='login'?'token?grant_type=password':'signup','POST',credentials);
 }};
}
module.exports={createAuthProxy};
