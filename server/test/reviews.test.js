'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createReviewService } = require('../src/reviews');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t,captureAssessment=null) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hc-review-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const id='HC-'+'a'.repeat(40),dir=path.join(directory,id);await fs.mkdir(dir);
 const photo=Buffer.from('sample image fixture'),photoHash=sha(photo);
 const manifest=Buffer.from(JSON.stringify({batchId:id,submittedBy:'farmer',declaredSpecies:'Tulsi',photos:[{sha256:photoHash}],...(captureAssessment?{captureAssessment}:{})}));
 await fs.writeFile(path.join(dir,'manifest.json'),manifest);await fs.writeFile(path.join(dir,photoHash+'.jpg'),photo);
 const h={batch:{batchId:id,status:'PENDING_REVIEW',harvestEvidenceHash:sha(manifest),species:'Tulsi',quantityGrams:1000},events:[]};
 const mode={timeout:false,offline:false,endorseFail:false};let count=0;
 const contractFor=()=>({evaluateTransaction:async()=>{if(mode.offline)throw Error('UNAVAILABLE');return Buffer.from(JSON.stringify(h))},newProposal:(_name,{arguments:args})=>({getTransactionId:()=> 'review-tx',endorse:async()=>{if(mode.endorseFail)throw Error('Endorsement unavailable');return {submit:async()=>{count++;h.batch.status=args[1]==='APPROVE'?'VERIFIED':'REJECTED';h.events.push({type:'REVIEWED',transactionId:'review-tx',details:{decision:args[1],evidenceHash:args[2]}});if(mode.timeout)throw Error('Timeout after commit');return {getStatus:async()=>({successful:true})}}}}})});
 const participantFor=uid=>({role:uid==='reviewer'?'verifier':'collector'});
 const options={directory,contractFor,participantFor},service=createReviewService(options);
 const input={decision:'APPROVE',notes:'Inspected the collection evidence.',examined:true,evidenceHash:sha(manifest)};
 return {directory,dir,id,h,mode,input,service,options,photoHash,count:()=>count};
}
test('only verifiers can list, read private photos or submit reviews',async t=>{const f=await fixture(t);for(const action of [()=>f.service.queue('farmer'),()=>f.service.evidence('farmer',f.id),()=>f.service.submit('farmer',f.id,f.input)])await assert.rejects(action,/Verifier/);assert.equal(f.count(),0)});
test('queue uses ledger status and evidence integrity is checked before display and commit',async t=>{const f=await fixture(t);assert.equal((await f.service.queue('reviewer')).batches.length,1);assert.equal((await f.service.evidence('reviewer',f.id)).photos.length,1);await fs.writeFile(path.join(f.dir,f.photoHash+'.jpg'),'changed');await assert.rejects(f.service.evidence('reviewer',f.id),/Photo/);await assert.rejects(f.service.submit('reviewer',f.id,f.input),/Photo/);assert.equal(f.count(),0)});
test('manifest tampering, path traversal and stale evidence hashes are rejected',async t=>{const f=await fixture(t);await assert.rejects(f.service.evidence('reviewer','../secret'),/Invalid/);await assert.rejects(f.service.submit('reviewer',f.id,{...f.input,evidenceHash:'b'.repeat(64)}),/Evidence changed/);await fs.appendFile(path.join(f.dir,'manifest.json'),' ');await assert.rejects(f.service.evidence('reviewer',f.id),/Manifest/)});
test('approval stores actual reasoning digest and concurrent/restarted retries commit once',async t=>{const f=await fixture(t);const results=await Promise.all([f.service.submit('reviewer',f.id,f.input),f.service.submit('reviewer',f.id,f.input)]);assert.ok(results.every(r=>r.committed));assert.equal(f.count(),1);const r=JSON.parse(await fs.readFile(path.join(f.dir,'review.json')));assert.equal(sha(JSON.stringify(r.document)),f.h.events[0].details.evidenceHash);assert.equal(r.document.notes,f.input.notes);const restarted=createReviewService(f.options);assert.equal((await restarted.submit('reviewer',f.id,f.input)).status,'VERIFIED');assert.equal(f.count(),1);assert.equal((await restarted.queue('reviewer')).batches.length,0);await assert.rejects(restarted.submit('reviewer',f.id,{...f.input,decision:'REJECT'}),/saved review/)});
test('a timeout after commit reconciles to the committed rejection',async t=>{const f=await fixture(t);f.mode.timeout=true;const r=await f.service.submit('reviewer',f.id,{...f.input,decision:'REJECT'});assert.equal(r.committed,true);assert.equal(r.status,'REJECTED');assert.equal(r.transactionId,'review-tx')});
test('endorsement failure saves a recoverable original decision and does not hide an offline queue',async t=>{const f=await fixture(t);f.mode.endorseFail=true;await assert.rejects(f.service.submit('reviewer',f.id,f.input),/Endorsement/);assert.deepEqual((await f.service.evidence('reviewer',f.id)).savedReview,f.input);f.mode.endorseFail=false;assert.equal((await f.service.submit('reviewer',f.id,f.input)).committed,true);f.mode.offline=true;await assert.rejects(f.service.queue('reviewer'),/UNAVAILABLE/)});
test('self review is rejected even if the account configuration incorrectly grants verifier',async t=>{const f=await fixture(t);const s=createReviewService({...f.options,participantFor:()=>({role:'verifier'})});await assert.rejects(s.submit('farmer',f.id,f.input),/own submission/)});

test('review archive failure keeps original decision retryable without a ledger submission',async t=>{
 const f=await fixture(t);let offline=true;const kinds=[];
 const archive={put:async(id,kind,bytes,digest)=>{if(offline)throw Error('Archive unavailable');assert.equal(sha(bytes),digest);kinds.push(kind);}};
 const service=createReviewService({...f.options,archive});
 await assert.rejects(service.submit('reviewer',f.id,f.input),/Archive unavailable/);assert.equal(f.count(),0);
 offline=false;assert.equal((await service.submit('reviewer',f.id,f.input)).committed,true);
 assert.deepEqual(kinds,['review']);assert.equal(f.count(),1);
});

test('flagged regional evidence blocks local approval and preserves exact reviewer resolution',async t=>{const f=await fixture(t,{version:1,needsResolution:true,concerns:['REGION_UNCONFIRMED']});await assert.rejects(f.service.submit('reviewer',f.id,f.input),/evidence resolving/);assert.equal(f.count(),0);const resolved={...f.input,regionalEvidence:'Cultivation records and independent site visit resolve the regional occurrence gap.'};assert.equal((await f.service.submit('reviewer',f.id,resolved)).status,'VERIFIED');const record=JSON.parse(await fs.readFile(path.join(f.options.directory,f.id,'review.json')));assert.equal(record.document.regionalEvidence,resolved.regionalEvidence);await assert.rejects(f.service.submit('reviewer',f.id,{...resolved,regionalEvidence:'Different supporting documents supplied for the same original review.'}),/saved review/);});
