'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const forge=require('../../node_modules/node-forge');const {createIdentityRegistry}=require('../src/identity-registry');
test('registry verifies matching keys, separates accounts and reloads valid persisted identities',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hc-registry-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 // Synthetic certificate and key only: never use a participant signing key in tests.
 const keys=forge.pki.rsa.generateKeyPair(1024),other=forge.pki.rsa.generateKeyPair(1024),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='01';cert.validity.notBefore=new Date();cert.validity.notAfter=new Date(Date.now()+86400000);cert.setSubject([{name:'commonName',value:'Synthetic onboarding test'}]);cert.setIssuer(cert.subject.attributes);cert.sign(keys.privateKey,forge.md.sha256.create());
 const certificate=path.join(directory,'cert.pem'),privateKey=path.join(directory,'key.pem'),wrongKey=path.join(directory,'wrong.pem');fs.writeFileSync(certificate,forge.pki.certificateToPem(cert));fs.writeFileSync(privateKey,forge.pki.privateKeyToPem(keys.privateKey));fs.writeFileSync(wrongKey,forge.pki.privateKeyToPem(other.privateKey));
 const uid='881ca81b-334b-4a50-8c39-5d5a32cd3cd5',second='881ca81b-334b-4a50-8c39-5d5a32cd3cd6',identities={};const c={role:'collector',mspId:'Org1MSP',fabricIdentity:'fixture-id',certificate,privateKey,tlsCertificate:certificate};let checks=0;
 const options={identities,directory,validateCertificate:()=>checks++};const registry=createIdentityRegistry(options);registry.install(uid,c);assert.equal(checks,1);assert.equal(registry.has(uid),true);assert.throws(()=>registry.install(second,c),/separate identity/);assert.throws(()=>registry.install(uid,{...c,fabricIdentity:'replacement'}),/replace/);assert.throws(()=>registry.install(second,{...c,privateKey:wrongKey}),/does not match/);assert.throws(()=>registry.install(second,{...c,role:'regulator'}),/Invalid enrollment/);
 fs.writeFileSync(path.join(directory,uid+'.json'),JSON.stringify({userId:uid,config:c}));const restored={};createIdentityRegistry({...options,identities:restored}).loadAll();assert.equal(restored[uid].fabricIdentity,'fixture-id');
});
