'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const roles=['collector','aggregator','processor','manufacturer','distributor','verifier','lab','regulator'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
function createOnboarding({directory,hasIdentity,provision,activate,autoFarmers=true,adminIds=[],hourlyLimit=100}) {
 const pending=new Map(),admins=new Set(adminIds),folder=path.resolve(directory,'requests');let enrolling=0;
 const file=uid=>{if(!uuid.test(uid))fail('Invalid account');return path.join(folder,uid.toLowerCase()+'.json');};
 const publicRecord=r=>({userId:r.userId,name:r.name,email:r.email,role:r.role,state:r.state,createdAt:r.createdAt});
 async function read(uid){try{return JSON.parse(await fs.readFile(file(uid),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function save(r){await fs.mkdir(folder,{recursive:true,mode:0o700});const dest=file(r.userId),temp=dest+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(r),{mode:0o600,flag:'wx'});await fs.rename(temp,dest);}
 async function listRecords(){await fs.mkdir(folder,{recursive:true,mode:0o700});const out=[];for(const name of await fs.readdir(folder)){if(!uuid.test(name.replace(/\.json$/,''))||!name.endsWith('.json'))continue;out.push(await read(name.slice(0,-5)));}return out;}
 async function locked(uid,fn){if(pending.has(uid))return pending.get(uid);const task=Promise.resolve().then(fn);pending.set(uid,task);try{return await task;}finally{pending.delete(uid);}}
 async function enroll(r){
   if(enrolling>=2)fail('Account setup is busy. Try again shortly.',503);
   enrolling++;
   try{
     r.state='enrolling';await save(r);
     const config=await provision(r,()=>save(r));
     await activate(r,config);
     r.state='active';delete r.secret;await save(r);
     return publicRecord(r);
   }catch{r.state='failed';await save(r);fail('Account setup is temporarily unavailable. Retry the same account; no replacement account is needed.',503);}
   finally{enrolling--;}
 }
 return {
   isAdmin:uid=>admins.has(uid),
   async request(user){
     const uid=user.id;if(!uuid.test(uid))fail('Invalid account');
     return locked(uid,async()=>{
       let r=await read(uid);
       if((!r||r.state==='active')&&hasIdentity(uid))return {userId:uid,state:'active'};
       if(!r){
         const metadata=user.user_metadata||{},role=metadata.requested_role;
         if(!roles.includes(role))fail('Choose a participant role when creating your account. Contact the administrator for an existing account without a requested role.');
         const all=await listRecords();if(all.filter(x=>Date.parse(x.createdAt)>Date.now()-3600000).length>=hourlyLimit)fail('Account setup is busy. Please try later.',429);
         r={userId:uid,role,name:String(metadata.full_name||user.email||'Participant').trim().slice(0,160)||'Participant',email:String(user.email||'').slice(0,254),createdAt:new Date().toISOString(),state:'pending',approved:role==='collector'&&autoFarmers,identityName:'account-'+uid.toLowerCase(),secret:crypto.randomBytes(32).toString('hex')};await save(r);
       }
       if(r.state==='rejected')return publicRecord(r);
       if(r.approved)return enroll(r);
       return publicRecord(r);
     });
   },
   async list(admin){if(!admins.has(admin))fail('Participant administration is not allowed',403);return (await listRecords()).map(publicRecord).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
   async decide(admin,uid,decision){
     if(!admins.has(admin))fail('Participant administration is not allowed',403);
     if(!['approve','reject'].includes(decision))fail('Choose approve or reject');
     return locked(uid,async()=>{const r=await read(uid);if(!r)fail('Account request not found',404);if(r.state==='active')return {...publicRecord(r),state:'active'};
       if(decision==='reject'){r.state='rejected';r.approved=false;delete r.secret;await save(r);return publicRecord(r);}
       if(r.state==='rejected')fail('This request was rejected; inspect it before any further approval.',409);
       r.approved=true;r.approvedBy=admin;await save(r);return enroll(r);
     });
   },
 };
}
module.exports={createOnboarding,roles};
