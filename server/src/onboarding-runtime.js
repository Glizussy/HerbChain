'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function onboardingFromEnvironment(gateway){
 if(process.env.HERBCHAIN_ONBOARDING_ENABLED!=='true')return null;
 if(!process.env.HERBCHAIN_DATA_DIR||!process.env.FABRIC_SAMPLES)throw Error('Onboarding requires the evidence directory and FABRIC_SAMPLES');
 const directory=path.join(path.resolve(process.env.HERBCHAIN_DATA_DIR),'.onboarding'),registry=path.join(directory,'identities');
 const adminIds=(process.env.HERBCHAIN_ONBOARDING_ADMIN_IDS||'').split(',').filter(Boolean);
 if(adminIds.some(id=>!/^[a-f0-9-]{36}$/i.test(id)))throw Error('Invalid onboarding administrator account');
 const hourlyLimit=Number(process.env.HERBCHAIN_ONBOARDING_HOURLY_LIMIT||100);
 if(!Number.isInteger(hourlyLimit)||hourlyLimit<1||hourlyLimit>10000)throw Error('Invalid onboarding rate limit');
 const {createCAProvisioner,createMembershipWriter}=require('./ca-onboarding');
 const writeMembership=process.env.HERBCHAIN_MEMBERSHIP_MODE==='supabase'?createMembershipWriter({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY}):async()=>{};
 return require('./onboarding').createOnboarding({directory,adminIds,hourlyLimit,autoFarmers:process.env.HERBCHAIN_AUTO_APPROVE_FARMERS==='true',hasIdentity:gateway.hasIdentity,
   provision:createCAProvisioner({directory,samples:process.env.FABRIC_SAMPLES,projectRoot:process.env.HERBCHAIN_ROOT||path.resolve(__dirname,'../..')}),
   activate:async(r,c)=>{
     // Do not publish an identity to other API/worker processes until membership succeeds.
     await writeMembership(r,c);
     await fs.mkdir(registry,{recursive:true,mode:0o700});const file=path.join(registry,r.userId+'.json'),temp=file+'.'+crypto.randomUUID()+'.tmp';
     await fs.writeFile(temp,JSON.stringify({userId:r.userId,config:c}),{mode:0o600,flag:'wx'});await fs.rename(temp,file);
     gateway.installIdentity(r.userId,c);
   },
 });
}
module.exports={onboardingFromEnvironment};
