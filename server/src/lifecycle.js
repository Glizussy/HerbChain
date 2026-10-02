'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { canInspectAssignment } = require('./memberships');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function check(ok, message) { if (!ok) throw Error(message); }
const operations = {
  LAB: { role: 'lab', method: 'RecordLabResult', event: 'LAB_TESTED' },
  PROCESS: { role: 'processor', method: 'RecordProcessing', event: 'PROCESSED' },
  PACKAGE: { role: 'manufacturer', method: 'PackageBatch', event: 'PACKAGED' },
  DELIVER: { role: 'distributor', method: 'RecordDelivery', event: 'DELIVERED' },
  RECALL: { role: 'regulator', method: 'RecallBatch', event: 'RECALLED' },
};
function available(batch, actor) {
  if(!canInspectAssignment(actor,batch.batchId))return [];
  const owner = batch.owner === actor.identity && batch.ownerMsp === actor.msp;
  const stationary = !batch.pendingTransfer;
  return Object.keys(operations).filter(action => {
    if (operations[action].role !== actor.role) return false;
    if (action === 'RECALL') return batch.status !== 'RECALLED';
    if (!stationary) return false;
    if (action === 'LAB') return ['VERIFIED','PROCESSED'].includes(batch.status);
    if (!owner) return false;
    if (action === 'PROCESS') return ['VERIFIED','PROCESSED'].includes(batch.status) && batch.labPassed;
    if (action === 'PACKAGE') return batch.status === 'PROCESSED' && batch.labPassed;
    return batch.status === 'PACKAGED';
  });
}
function normalize(input) {
  check(Object.hasOwn(operations, input.action), 'Unknown lifecycle action');
  check(Number.isSafeInteger(input.expectedSequence) && input.expectedSequence > 0, 'Refresh the batch before submitting');
  check(typeof input.notes === 'string' && input.notes.trim().length >= 10 && input.notes.length <= 6000, 'Record evidence notes between 10 and 6000 characters');
  check(input.examined === true && typeof input.demo === 'boolean', 'Confirm the evidence and identify whether this is a simulated demo');
  const p = { action: input.action, expectedSequence: input.expectedSequence, notes: input.notes.trim(), demo: input.demo, examined: true };
  if (input.action === 'LAB') { check(['PASS','FAIL'].includes(input.outcome), 'Choose the lab outcome'); p.outcome = input.outcome; }
  if (['PROCESS','PACKAGE'].includes(input.action)) { check(typeof input.label === 'string' && input.label.trim().length > 0 && input.label.length <= 160, 'Enter a method or product name (maximum 160 characters)'); p.label = input.label.trim(); }
  if (input.action === 'PROCESS') { check(Number.isSafeInteger(input.outputGrams) && input.outputGrams > 0, 'Enter positive whole grams'); p.outputGrams = input.outputGrams; }
  if (input.attachment) {
    check(typeof input.attachment === 'string' && input.attachment.length <= 7 * 1024 * 1024 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.attachment), 'Invalid report encoding');
    const bytes = Buffer.from(input.attachment, 'base64');
    check(bytes.length > 5 && bytes.length <= 5 * 1024 * 1024 && bytes.subarray(0,5).toString() === '%PDF-', 'Attach a PDF report up to 5 MB');
    p.attachment = input.attachment;
  }
  check(input.action !== 'LAB' || p.demo || p.attachment, 'A non-demo lab result requires a PDF report');
  return p;
}
function createLifecycleService({ directory, contractFor, actorFor, archive = null }) {
  const locks = new Map(), root = path.join(directory, '.lifecycle');
  const batchIdValid = id => check(typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id), 'Invalid batch ID');
  const requestValid = id => check(typeof id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(id), 'Invalid request ID');
  async function history(uid, id) { return JSON.parse(Buffer.from(await contractFor(uid).evaluateTransaction('GetProvenance', id)).toString()); }
  async function detail(uid, id) {
    batchIdValid(id); const actor = actorFor(uid);
    check(canInspectAssignment(actor,id),'Batch is not assigned to this participant');
    const h = await history(uid, id);
    check(['lab','regulator'].includes(actor.role) || (h.batch.owner === actor.identity && h.batch.ownerMsp === actor.msp) || h.events.some(e => e.actor.identity === actor.identity && e.actor.msp === actor.msp), 'Batch is not assigned to this participant');
    return { ...h, actions: available(h.batch, actor), role: actor.role };
  }
  async function save(file, record) { const temp = file + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600 }); await fs.rename(temp, file); }
  async function run(uid, id, input) {
    const actor = actorFor(uid); batchIdValid(id); requestValid(input?.requestId);
    check(canInspectAssignment(actor,id),'Batch is not assigned to this participant');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const file = path.join(root, hash(uid + ':' + input.requestId) + '.json');
    let record; try { record = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (record) {
      check(record.uid === uid && record.batchId === id, 'Request belongs to a different batch');
      if (input.action) check(JSON.stringify(record.input) === JSON.stringify(normalize(input)), 'Saved request cannot be changed');
    } else {
      check(input.action, 'No saved request found. Refresh history, clear the local retry reference, and complete the form again');
      const p = normalize(input);
      check(operations[p.action].role === actor.role, 'Unauthorized lifecycle role');
      const attachmentHash = p.attachment ? hash(Buffer.from(p.attachment, 'base64')) : null;
      const { attachment, ...fields } = p;
      const document = { version: 1, batchId: id, submittedBy: uid, ...fields, attachmentHash };
      record = { uid, batchId: id, input: p, document, evidenceHash: hash(JSON.stringify(document)), transactionIds: [], committed: false };
    }
    check(hash(JSON.stringify(record.document)) === record.evidenceHash, 'Stored evidence integrity check failed');
    const { attachment: storedAttachment, ...storedFields } = record.input;
    check(JSON.stringify(record.document) === JSON.stringify({ version: 1, batchId: id, submittedBy: uid, ...storedFields, attachmentHash: storedAttachment ? hash(Buffer.from(storedAttachment,'base64')) : null }), 'Stored request does not match evidence');
    if (record.input.attachment) check(hash(Buffer.from(record.input.attachment,'base64')) === record.document.attachmentHash, 'Stored report integrity check failed');
    const p = record.input, op = operations[p.action];
    check(op.role === actor.role, 'Unauthorized lifecycle role');
    let h = await history(uid, id);
    const find = () => { const e = h.events.find(e => record.transactionIds.includes(e.transactionId) && e.type === op.event && e.actor.identity === actor.identity && e.actor.msp === actor.msp); if (e) { record.committed = true; record.transactionId = e.transactionId; return true; } return false; };
    const result = () => ({ batchId: id, requestId: input.requestId, committed: record.committed, transactionId: record.transactionId || record.transactionIds.at(-1) || null, evidenceHash: record.evidenceHash, status: h.batch.status });
    if (find()) { await save(file, record); return result(); }
    check(h.batch.sequence === p.expectedSequence, 'Batch changed. Refresh history before creating a new request');
    check(available(h.batch, actor).includes(p.action), 'Action unavailable: check custody, lab result, pending transfer and batch status');
    if (p.action === 'PROCESS') check(p.outputGrams <= h.batch.quantityGrams, 'Output mass cannot exceed input mass');
    await save(file, record);
    if (archive) {
      if (record.input.attachment) await archive.put(id, 'report', Buffer.from(record.input.attachment, 'base64'), record.document.attachmentHash);
      await archive.put(id, 'operation', Buffer.from(JSON.stringify(record.document)), record.evidenceHash);
    }
    const digest = record.evidenceHash;
    const args = p.action === 'LAB' ? [id,p.outcome,digest] : p.action === 'PROCESS' ? [id,p.label,String(p.outputGrams),digest] : p.action === 'PACKAGE' ? [id,p.label,digest] : [id,digest];
    let attempted = false;
    try {
      const proposal = contractFor(uid).newProposal(op.method, { arguments: args });
      const endorsed = await proposal.endorse();
      const batch = JSON.parse(Buffer.from(endorsed.getResult()).toString());
      check(batch.sequence === p.expectedSequence + 1, 'Batch changed during endorsement; refresh history');
      record.transactionIds.push(proposal.getTransactionId()); await save(file, record);
      attempted = true;
      const commit = await endorsed.submit(); const status = await commit.getStatus();
      check(status.successful, 'Fabric marked this transaction invalid');
      record.committed = true; record.transactionId = proposal.getTransactionId(); h.batch = batch;
      await save(file, record); return result();
    } catch (e) {
      try { h = await history(uid,id); if (find()) { await save(file,record); return result(); } } catch {}
      if (!attempted) throw e;
      return result();
    }
  }
  async function locked(key, fn) { const p = (locks.get(key) || Promise.resolve()).catch(()=>{}).then(fn); locks.set(key,p); try { return await p; } finally { if (locks.get(key) === p) locks.delete(key); } }
  return { detail, submit(uid,id,input) { actorFor(uid); batchIdValid(id); requestValid(input?.requestId); return locked('request:'+uid+':'+input.requestId,()=>locked('batch:'+id,()=>run(uid,id,input))); } };
}
module.exports = { createLifecycleService, available, normalize };
