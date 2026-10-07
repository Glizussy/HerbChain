'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {roleMsp}=require('./memberships');
function createIdentityRegistry({identities,directory,validateCertificate}){
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const file=uid=>{if(!uuid.test(uid))throw Error('Invalid enrolled account');return path.join(directory,uid.toLowerCase()+'.json');};
 function install(uid,c){
   if(!roleMsp[c?.role]||roleMsp[c.role]!==c.mspId||!c.fabricIdentity)throw Error('Invalid enrollment configuration');
   const cert=fs.readFileSync(c.certificate);validateCertificate(c,cert);
   const privateKey=crypto.createPrivateKey(fs.readFileSync(c.privateKey));
   const certificate=new crypto.X509Certificate(cert);
   if(!certificate.checkPrivateKey(privateKey))throw Error('Enrollment key does not match certificate');
   fs.accessSync(c.tlsCertificate,fs.constants.R_OK);
   if(identities[uid]){if(identities[uid].fabricIdentity!==c.fabricIdentity||identities[uid].mspId!==c.mspId||identities[uid].role!==c.role)throw Error('Refusing to replace an enrolled identity');return;}
   if(Object.values(identities).some(x=>x.fabricIdentity===c.fabricIdentity&&x.mspId===c.mspId))throw Error('Each account requires a separate identity');
   identities[uid]=c;
 }
 function load(uid){if(!directory)return;if(identities[uid])return;const target=file(uid);if(fs.existsSync(target)){const r=JSON.parse(fs.readFileSync(target,'utf8'));if(r.userId!==uid)throw Error('Enrollment account mismatch');install(uid,r.config);}}
 function loadAll(){if(!directory||!fs.existsSync(directory))return;for(const name of fs.readdirSync(directory)){if(name.endsWith('.json')&&uuid.test(name.slice(0,-5)))load(name.slice(0,-5));}}
 return {install,load,loadAll,has:uid=>{load(uid);return Object.hasOwn(identities,uid);}};
}
module.exports={createIdentityRegistry};
