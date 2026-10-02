'use strict';
// Offline preparation: reads public enrollment certificates, never private keys.
const fs=require('node:fs'),path=require('node:path');
const {loadParticipants}=require('./participant-accounts.cjs');const {membershipSeed}=require('./membership-seed.cjs');
const [root,accountsFile,outputFile]=process.argv.slice(2);
if(!root||!accountsFile||!outputFile)throw Error('Usage: node prepare-membership-seed.cjs PROJECT_ROOT ACCOUNTS_JSON OUTPUT_SQL');
const {ClientIdentity}=require(path.join(path.resolve(root),'blockchain/chaincode/node_modules/fabric-shim'));
const entries=loadParticipants(['--accounts',accountsFile]),identities={},seen=new Set();
for(const p of entries){
 const mspId=p.org==='org1'?'Org1MSP':'Org2MSP';
 const idBytes=fs.readFileSync(path.join(root,'blockchain/identities',p.identityName,'msp/signcerts/cert.pem'));
 const cert=new ClientIdentity({getChannelID:()=> 'herbchain',getTxID:()=> 'seed-preflight',getCreator:()=>({mspid:mspId,idBytes})});
 if(cert.getAttributeValue('herbchain.role')!==p.role)throw Error('Certificate role mismatch: '+p.identityName);
 const fabricIdentity=cert.getID();if(seen.has(mspId+fabricIdentity))throw Error('Duplicate signing identity');seen.add(mspId+fabricIdentity);
 identities[p.userId]={mspId,fabricIdentity};
}
fs.writeFileSync(outputFile,membershipSeed(entries,identities),{flag:'wx',mode:0o600});
console.log('Prepared '+entries.length+' memberships in '+outputFile+'. No database or ledger changes.');
