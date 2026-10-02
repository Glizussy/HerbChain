'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function check(ok, message) { if (!ok) throw Error(message); }
const types = { PROPOSE: 'TRANSFER_PROPOSED', ACCEPT: 'TRANSFER_ACCEPTED', CANCEL: 'TRANSFER_CANCELLED' };
const methods = { PROPOSE: 'ProposeTransfer', ACCEPT: 'AcceptTransfer', CANCEL: 'CancelTransfer' };
function createTransferService({ directory, contractFor, actorFor, directoryFor }) {
  const locks = new Map();
  function id(value) { check(typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value), 'Invalid batch ID'); return value; }
  const same = (a,b) => a?.identity === b.identity && a?.msp === b.msp;
  const owns = (b,a) => b.owner === a.identity && b.ownerMsp === a.msp;
  async function history(uid,batchId) { id(batchId); return JSON.parse(Buffer.from(await contractFor(uid).evaluateTransaction('GetProvenance',batchId)).toString()); }
  function allowed(b,a) {
    const open = !['PENDING_REVIEW','REJECTED','RECALLED','DELIVERED','CONSUMED'].includes(b.status);
    return { propose: open && owns(b,a) && !b.pendingTransfer, cancel: open && owns(b,a) && !!b.pendingTransfer,
      accept: open && a.role !== 'collector' && same(b.pendingTransfer,a) };
  }
  async function detail(uid,batchId) {
    const a=actorFor(uid),h=await history(uid,batchId);
    check(owns(h.batch,a) || same(h.batch.pendingTransfer,a) || h.events.some(e=>same(e.actor,a)), 'This batch is not assigned to your account');
    return { ...h, actions: allowed(h.batch,a) };
  }
  async function queue(uid) {
    const a=actorFor(uid),batches=[],warnings=[];
    for(const e of await fs.readdir(directory,{withFileTypes:true})) {
      if(!e.isDirectory() || !/^HC-[a-f0-9]{40}$/.test(e.name)) continue;
      let h;try {h=await history(uid,e.name)} catch(error){if(/Batch not found/.test(error.message)){warnings.push(`${e.name}: registration pending`);continue}throw error}
      const b=h.batch;if(owns(b,a)||same(b.pendingTransfer,a)) batches.push({batchId:b.batchId,species:b.species,quantityGrams:b.quantityGrams,status:b.status,incoming:same(b.pendingTransfer,a),outgoing:owns(b,a)&&!!b.pendingTransfer,actions:allowed(b,a)});
    }
    return { batches,warnings,scope:'Locally stored harvests currently owned by or offered to your account' };
  }
  async function save(file,data) {const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(data),{mode:0o600});await fs.rename(tmp,file)}
  async function run(uid,batchId,input) {
    const a=actorFor(uid);id(batchId);
    check(input && Object.hasOwn(types,input.action),'Invalid transfer action');
    check(typeof input.requestId==='string' && /^[A-Za-z0-9_-]{8,80}$/.test(input.requestId),'Invalid request ID');
    check(Number.isSafeInteger(input.expectedSequence) && input.expectedSequence>0,'Load the current batch before acting');
    let recipient=null;
    if(input.action==='PROPOSE') {
      check(directoryFor(uid).some(p=>p.uid===input.recipientUid),'Choose an enrolled recipient');
      recipient=actorFor(input.recipientUid);check(recipient.identity!==a.identity,'Cannot transfer to yourself');
    }
    const payload={uid,batchId,action:input.action,expectedSequence:input.expectedSequence,recipientUid:input.action==='PROPOSE'?input.recipientUid:null};
    const fingerprint=sha(JSON.stringify(payload));
    const root=path.join(directory,'.transfers');await fs.mkdir(root,{recursive:true,mode:0o700});
    const file=path.join(root,sha(uid+':'+input.requestId)+'.json');let record;
    try{record=JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
    if(record)check(record.fingerprint===fingerprint,'Request ID already used for a different transfer');
    else record={fingerprint,payload,transactionIds:[],phase:'STORED'};
    let h=await history(uid,batchId);
    function findCommit(history) {
      const e=history.events.find(e=>record.transactionIds.includes(e.transactionId)&&e.type===types[input.action]&&same(e.actor,a));
      if(e){record.phase='COMMITTED';record.transactionId=e.transactionId;return true}return false;
    }
    const result=()=>({batchId,requestId:input.requestId,committed:record.phase==='COMMITTED',transactionId:record.transactionId||record.transactionIds.at(-1)||null,status:h.batch.status});
    if(findCommit(h)){await save(file,record);return result()}
    check(h.batch.sequence===input.expectedSequence,'Batch changed. Refresh its history before making a new request.');
    check(allowed(h.batch,a)[input.action.toLowerCase()], 'Action not allowed for this custodian, recipient or batch status');
    await save(file,record);
    const args=input.action==='PROPOSE'?[batchId,recipient.identity,recipient.msp]:[batchId];
    let attempted=false;
    try {
      const proposal=contractFor(uid).newProposal(methods[input.action],{arguments:args});
      const endorsed=await proposal.endorse();
      // A retry must not become a new business action after a concurrent change.
      const endorsedBatch=JSON.parse(Buffer.from(endorsed.getResult()).toString());
      check(endorsedBatch.sequence===input.expectedSequence+1,'Batch changed during endorsement; reload history');
      record.transactionIds.push(proposal.getTransactionId());record.phase='SUBMITTING';await save(file,record);
      attempted=true;const commit=await endorsed.submit();const status=await commit.getStatus();
      if(!status.successful)throw Error(`Transaction invalid: ${status.code}`);
      record.phase='COMMITTED';record.transactionId=proposal.getTransactionId();h.batch=endorsedBatch;await save(file,record);return result();
    } catch(error) {
      try {h=await history(uid,batchId);if(findCommit(h)){await save(file,record);return result()}}catch{}
      record.phase='PENDING';await save(file,record);
      if(!attempted)throw error;
      return result();
    }
  }
  async function locked(key,fn){const task=(locks.get(key)||Promise.resolve()).catch(()=>{}).then(fn);locks.set(key,task);try{return await task}finally{if(locks.get(key)===task)locks.delete(key)}}
  return { detail,queue,async submit(uid,batchId,input){actorFor(uid);id(batchId);return locked('request:'+uid+':'+input?.requestId,()=>locked('batch:'+batchId,()=>run(uid,batchId,input)))} };
}
module.exports={createTransferService};
