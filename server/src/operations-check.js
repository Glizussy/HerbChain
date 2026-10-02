'use strict';
// Read-only. Run with the same private environment as the backend.
const fs=require('node:fs'),crypto=require('node:crypto');
(async()=>{
 const base=new URL(process.env.SUPABASE_URL);if(base.protocol!=='https:')throw Error('HTTPS required');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('Server credential missing');
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 async function rpc(name,body={}){const r=await fetch(base.origin+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error('Database health check failed');return r.json();}
 const metrics=await rpc('hc_queue_metrics'),index=await rpc('hc_index_head',{p_channel:process.env.FABRIC_CHANNEL||'herbchain'});
 const identities=JSON.parse(fs.readFileSync(process.env.FABRIC_IDENTITIES_FILE,'utf8'));let soon=0,expired=0;for(const c of Object.values(identities)){const cert=new crypto.X509Certificate(fs.readFileSync(c.certificate));const remaining=(Date.parse(cert.validTo)-Date.now())/86400000;if(remaining<0)expired++;else if(remaining<30)soon++;}
 console.log(JSON.stringify({queue:metrics,index,certificates:{count:Object.keys(identities).length,expired,expireWithin30Days:soon}},null,2));
 if(expired||metrics.uncertain||metrics.expiredLeases||metrics.oldestQueuedSeconds>300)process.exitCode=2;
})().catch(()=>{console.error('Operational check failed. Check the private environment and dependency availability.');process.exitCode=1});
