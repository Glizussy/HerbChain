'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const runFile=promisify(execFile),orgIds={org1:'10000000-0000-4000-8000-000000000001',org2:'10000000-0000-4000-8000-000000000002'};
function createCAProvisioner({directory,samples,projectRoot,run=runFile,readConfig}){
 const binary=path.join(samples,'bin/fabric-ca-client'),network=path.join(samples,'test-network');
 return async function provision(record,save){
   const org=['collector','aggregator','processor','manufacturer','distributor'].includes(record.role)?'org1':'org2',port=org==='org1'?7054:8054;
   const target=path.join(directory,'accounts',record.userId),msp=path.join(target,'msp'),clientHome=path.join(target,'client'),adminHome=path.join(network,'organizations/peerOrganizations',org+'.example.com'),tls=path.join(network,'organizations/fabric-ca',org,'tls-cert.pem');
   await fs.mkdir(target,{recursive:true,mode:0o700});
   const env={...process.env,FABRIC_CA_CLIENT_HOME:adminHome,FABRIC_CA_CLIENT_URL:'https://localhost:'+port,FABRIC_CA_CLIENT_ID_SECRET:record.secret};
   if(!record.registered){
     try{await run(binary,['register','--caname','ca-'+org,'--id.name',record.identityName,'--id.type','client','--id.attrs','herbchain.role='+record.role+':ecert','--tls.certfiles',tls],{env,timeout:20000,maxBuffer:262144,windowsHide:true});}
     catch(error){if(!/already registered/i.test(String(error.stderr||'')))throw Error('Enrollment registration unavailable');}
     record.registered=true;await save();
   }
   // Recover an interrupted registration/enrollment using the original secret and name.
   const certificate=path.join(msp,'signcerts/cert.pem');
   try{await fs.access(certificate);}catch{
     await fs.mkdir(clientHome,{recursive:true,mode:0o700});
     await run(binary,['enroll','--caname','ca-'+org,'-M',msp,'--tls.certfiles',tls],{env:{...env,FABRIC_CA_CLIENT_HOME:clientHome,FABRIC_CA_CLIENT_URL:'https://'+record.identityName+':'+record.secret+'@localhost:'+port},timeout:20000,maxBuffer:262144,windowsHide:true}).catch(()=>{throw Error('Enrollment service unavailable');});
   }
   // The CLI may persist its URL in a generated config. Do not retain credentials there.
   await fs.rm(path.join(clientHome,'fabric-ca-client-config.yaml'),{force:true});
   await fs.copyFile(path.join(adminHome,'msp/config.yaml'),path.join(msp,'config.yaml'));
   const keys=(await fs.readdir(path.join(msp,'keystore'))).filter(n=>!n.startsWith('.'));if(keys.length!==1)throw Error('Expected one enrollment key');
   await fs.chmod(path.join(msp,'keystore',keys[0]),0o600);
   const c={role:record.role,mspId:org==='org1'?'Org1MSP':'Org2MSP',certificate,privateKey:path.join(msp,'keystore',keys[0]),tlsCertificate:path.join(adminHome,'tlsca','tlsca.'+org+'.example.com-cert.pem'),endpoint:'localhost:'+(org==='org1'?7051:9051),hostOverride:'peer0.'+org+'.example.com',displayName:record.name,organizationId:orgIds[org]};
   if(readConfig)return readConfig(c);
   const {ClientIdentity}=require(path.join(projectRoot,'blockchain/chaincode/node_modules/fabric-shim'));
   const bytes=await fs.readFile(certificate),identity=new ClientIdentity({getChannelID:()=> 'herbchain',getTxID:()=> 'onboarding',getCreator:()=>({mspid:c.mspId,idBytes:bytes})});
   if(identity.getAttributeValue('herbchain.role')!==record.role)throw Error('Incorrect enrolled role');c.fabricIdentity=identity.getID();return c;
 };
}
function createMembershipWriter({url,key,fetchImpl=fetch}){
 if(!url||!key)throw Error('Automatic memberships require server-only Supabase credentials');
 const base=new URL(url);if(base.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Membership API requires HTTPS');
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 async function request(table,method,body,query=''){
   const response=await fetchImpl(url+'/rest/v1/'+table+query,{method,headers:{...headers,Prefer:'resolution=ignore-duplicates,return=minimal'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
   if(!response.ok)throw Error('Membership storage unavailable');return method==='GET'?response.json():null;
 }
 return async function activate(r,c){
   await request('hc_organizations','POST',{id:c.organizationId,name:c.mspId==='Org1MSP'?'Pilot supply participants':'Pilot independent oversight',msp_id:c.mspId});
   await request('hc_memberships','POST',{user_id:r.userId,organization_id:c.organizationId,role:r.role,state:'active',display_name:r.name,fabric_identity:c.fabricIdentity});
   const rows=await request('hc_memberships','GET',null,'?user_id=eq.'+encodeURIComponent(r.userId)+'&select=state,role,fabric_identity,organization_id');
   if(rows.length!==1||rows[0].state!=='active'||rows[0].role!==r.role||rows[0].fabric_identity!==c.fabricIdentity||rows[0].organization_id!==c.organizationId)throw Error('Membership conflict; an existing membership cannot be replaced');
 };
}
module.exports={createCAProvisioner,createMembershipWriter};
