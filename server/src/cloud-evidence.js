'use strict';
const {digest}=require('./evidence-archive');
const fields={LAB_TESTED:'reportHash',PROCESSED:'evidenceHash',PACKAGED:'evidenceHash',DELIVERED:'receiptHash',RECALLED:'noticeHash'};
// Call only after authorizing the requesting account against this ledger history.
// Committed ledger references form the catalog; no storage listing or local journal scan.
function createCloudEvidenceReader(archive){
 function check(ok,message){if(!ok)throw Error(message);}
 async function bytes(id,kind,hash){
  check(/^[A-Za-z0-9_-]{1,80}$/.test(id)&&/^[a-f0-9]{64}$/.test(hash),'Invalid ledger evidence reference');
  const data=Buffer.from(await archive.get(id,kind,hash));
  check(digest(data)===hash,'Cloud evidence integrity check failed');return data;
 }
 async function document(id,kind,hash){const data=await bytes(id,kind,hash);const value=JSON.parse(data);check(value.batchId===id,'Cloud evidence batch mismatch');return value;}
 async function harvest(h){
  const id=h.batch.batchId,m=await document(id,'manifest',h.batch.harvestEvidenceHash);
  check(Array.isArray(m.photos)&&m.photos.length>=1&&m.photos.length<=5,'Invalid evidence photos');
  const photos=[];for(const p of m.photos){const data=await bytes(id,'photo',p.sha256);photos.push({sha256:p.sha256,base64:data.toString('base64')});}
  return {manifest:m,photos};
 }
 async function review(h){
  const event=h.events.find(e=>e.type==='REVIEWED');if(!event)return null;
  const doc=await document(h.batch.batchId,'review',event.details.evidenceHash);
  check(doc.harvestEvidenceHash===h.batch.harvestEvidenceHash&&doc.decision===event.details.decision,'Cloud review does not match ledger');
  return {document:doc,event};
 }
 async function operation(h,event){
  const hash=event.details?.[fields[event.type]];
  const doc=await document(h.batch.batchId,'operation',hash);
  if(doc.attachmentHash)check(/^[a-f0-9]{64}$/.test(doc.attachmentHash),'Invalid report reference');
  return {record:{batchId:h.batch.batchId,document:doc,evidenceHash:hash},event};
 }
 async function operations(h){const result=[];for(const event of h.events)if(Object.hasOwn(fields,event.type))result.push(await operation(h,event));return result;}
 async function report(h,hash){
  const event=h.events.find(e=>Object.hasOwn(fields,e.type)&&e.details?.[fields[e.type]]===hash);
  check(event,'No verified PDF for this event');const {record}=await operation(h,event);
  check(record.document.attachmentHash,'No verified PDF for this event');
  const data=await bytes(h.batch.batchId,'report',record.document.attachmentHash);
  check(data.subarray(0,5).toString()==='%PDF-','Invalid archived PDF');return data;
 }
 return {harvest,review,operations,report};
}
function cloudReaderFromEnvironment(archive,env=process.env){
 const mode=env.HERBCHAIN_EVIDENCE_READ_MODE||'local';
 if(mode==='local')return null;
 if(mode!=='cloud'||!archive)throw Error('Cloud evidence reads require archive write mode');
 return createCloudEvidenceReader(archive);
}
module.exports={createCloudEvidenceReader,cloudReaderFromEnvironment};
