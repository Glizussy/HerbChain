'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {digest}=require('../src/evidence-archive');
const {createCloudEvidenceReader,cloudReaderFromEnvironment}=require('../src/cloud-evidence');
const {createDashboardService}=require('../src/dashboard');
const {createReviewService}=require('../src/reviews');
function fixture(){
 const id='HC-'+'e'.repeat(40),objects=new Map(),calls=[];
 function put(kind,value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)),hash=digest(bytes);objects.set(kind+':'+hash,bytes);return hash;}
 const photoHash=put('photo',Buffer.from('photo fixture')),pdf=Buffer.from('%PDF-1.7\nfixture'),reportHash=put('report',pdf);
 const manifestHash=put('manifest',{batchId:id,submittedBy:'farmer',location:{latitude:1,longitude:2},photos:[{sha256:photoHash}]});
 const reviewHash=put('review',{batchId:id,harvestEvidenceHash:manifestHash,decision:'APPROVE',notes:'Evidence inspected.'});
 const operationHash=put('operation',{batchId:id,demo:true,notes:'Demo lab test',attachmentHash:reportHash});
 const actorFor=uid=>({role:uid==='farmer'||uid==='other'?'collector':uid,identity:uid,msp:'Org1MSP',scope:'assigned',assignments:new Set(uid==='verifier'?[id]:[])});
 const h={batch:{batchId:id,status:'VERIFIED',sequence:3,owner:'processor',ownerMsp:'Org1MSP',harvestEvidenceHash:manifestHash},events:[{type:'COLLECTED',actor:actorFor('farmer'),transactionId:'tx1',sequence:1},{type:'REVIEWED',actor:actorFor('verifier'),transactionId:'tx2',sequence:2,details:{evidenceHash:reviewHash,decision:'APPROVE'}},{type:'LAB_TESTED',actor:actorFor('lab'),transactionId:'tx3',sequence:3,details:{reportHash:operationHash}}]};
 const archive={get:async(batch,kind,hash)=>{assert.equal(batch,id);calls.push(kind+':'+hash);const bytes=objects.get(kind+':'+hash);if(!bytes)throw Error('Archive missing');return bytes;}};
 const cloudEvidence=createCloudEvidenceReader(archive);
 // Deliberately nonexistent: proves evidence reads do not need local files/journals.
 const options={directory:require('node:path').join(require('node:os').tmpdir(),'hc-missing-'+require('node:crypto').randomUUID()),actorFor,contractFor:()=>({evaluateTransaction:async()=>Buffer.from(JSON.stringify(h))}),cloudEvidence};
 return {id,objects,calls,h,pdf,manifestHash,operationHash,photoHash,reportHash,cloudEvidence,options,service:createDashboardService(options)};
}
test('cloud restore reads farmer evidence, committed review and PDF with no local evidence directory',async()=>{
 const f=fixture();const d=await f.service.evidence('farmer',f.id);
 assert.equal(d.harvest.manifest.location.latitude,1);assert.equal(d.harvest.photos.length,1);assert.equal(d.review.decision,'APPROVE');assert.equal(d.operations.length,1);
 assert.deepEqual(await f.service.report('farmer',f.id,f.operationHash),f.pdf);
});
test('authorization precedes cloud access; custodian receives no harvest photos or GPS',async()=>{
 const f=fixture();await assert.rejects(f.service.evidence('other',f.id),/not assigned/);await assert.rejects(f.service.report('other',f.id,f.operationHash),/not assigned/);assert.equal(f.calls.length,0);
 const d=await f.service.evidence('processor',f.id);assert.equal(d.harvest,null);assert.equal(JSON.stringify(d).includes('latitude'),false);assert.ok(f.calls.every(x=>x.startsWith('operation:')));
 await assert.rejects(f.service.evidence('lab',f.id),/not assigned/);
});
test('missing or tampered cloud objects fail instead of using local files',async()=>{
 const f=fixture();f.objects.set('photo:'+f.photoHash,Buffer.from('tampered'));await assert.rejects(f.service.evidence('farmer',f.id),/integrity/);
 f.objects.delete('operation:'+f.operationHash);await assert.rejects(f.service.evidence('processor',f.id),/missing/);assert.equal(await f.service.publicDemo(f.h),'UNKNOWN');
});
test('uncommitted objects are not read; report bytes are downloaded and checked only when requested',async()=>{
 const f=fixture();await f.service.evidence('processor',f.id);assert.ok(!f.calls.some(x=>x.startsWith('report:')));
 f.objects.set('report:'+f.reportHash,Buffer.from('tampered'));await assert.rejects(f.service.report('processor',f.id,f.operationHash),/integrity/);
 f.h.events=f.h.events.filter(e=>e.type!=='LAB_TESTED');f.calls.length=0;await assert.rejects(f.service.report('processor',f.id,f.operationHash),/No verified/);assert.equal(f.calls.length,0);
});
test('reviewer cloud evidence respects assignments and works without local harvest files',async()=>{
 const f=fixture(),service=createReviewService({...f.options,participantFor:f.options.actorFor});
 const d=await service.evidence('verifier',f.id);assert.equal(d.photos.length,1);assert.equal(d.evidenceHash,f.manifestHash);
 const denied=createReviewService({...f.options,participantFor:()=>({role:'verifier',scope:'assigned',assignments:new Set()})});f.calls.length=0;await assert.rejects(denied.evidence('verifier',f.id),/not assigned/);assert.equal(f.calls.length,0);
});
test('cloud mode requires archive writes and rejects unknown modes',()=>{
 assert.equal(cloudReaderFromEnvironment(null,{}),null);
 assert.throws(()=>cloudReaderFromEnvironment(null,{HERBCHAIN_EVIDENCE_READ_MODE:'cloud'}),/require/);
 assert.throws(()=>cloudReaderFromEnvironment({},{HERBCHAIN_EVIDENCE_READ_MODE:'typo'}),/require/);
});

test('every lifecycle event uses its specific committed digest field and rejects cross-batch documents',async()=>{
 const f=fixture();f.h.events=[];
 for(const [type,field]of Object.entries({LAB_TESTED:'reportHash',PROCESSED:'evidenceHash',PACKAGED:'evidenceHash',DELIVERED:'receiptHash',RECALLED:'noticeHash'})){
  const doc=Buffer.from(JSON.stringify({batchId:f.id,notes:type,demo:true,attachmentHash:null})),hash=digest(doc);f.objects.set('operation:'+hash,doc);f.h.events.push({type,details:{[field]:hash}});
 }
 assert.equal((await f.cloudEvidence.operations(f.h)).length,5);
 const wrong=Buffer.from(JSON.stringify({batchId:'another-batch'})),hash=digest(wrong);f.objects.set('operation:'+hash,wrong);f.h.events=[{type:'LAB_TESTED',details:{reportHash:hash}}];
 await assert.rejects(f.cloudEvidence.operations(f.h),/batch mismatch/);
});
