'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { canInspectAssignment } = require('./memberships');
const {approvalCheck}=require('./harvest-checks');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function check(ok, message) { if (!ok) throw Error(message); }
function createReviewService({ directory, contractFor, participantFor, archive = null, cloudEvidence = null }) {
  const locks = new Map();
  function authorize(uid) { check(participantFor(uid).role === 'verifier', 'Verifier account required'); }
  function folder(id) { check(/^HC-[a-f0-9]{40}$/.test(id), 'Invalid uploaded batch ID'); return path.join(directory, id); }
  async function history(uid, id) {
    return JSON.parse(Buffer.from(await contractFor(uid).evaluateTransaction('GetProvenance', id)).toString());
  }
  async function evidence(uid, id) {
    authorize(uid);
    check(canInspectAssignment(participantFor(uid),id),'Batch is not assigned to this reviewer');
    const dir = folder(id), provenance = await history(uid, id);
    const cloud = cloudEvidence ? await cloudEvidence.harvest(provenance) : null;
    const bytes = cloud ? null : await fs.readFile(path.join(dir, 'manifest.json'));
    check(cloud || sha(bytes) === provenance.batch.harvestEvidenceHash, 'Manifest does not match ledger evidence');
    const manifest = cloud ? cloud.manifest : JSON.parse(bytes);
    check(manifest.batchId === id && Array.isArray(manifest.photos) && manifest.photos.length <= 5, 'Invalid evidence manifest');
    const photos = [];
    for (const p of manifest.photos) {
      check(/^[a-f0-9]{64}$/.test(p.sha256), 'Invalid photo digest');
      const photo = cloud ? Buffer.from(cloud.photos.find(x=>x.sha256===p.sha256).base64,'base64') : await fs.readFile(path.join(dir, `${p.sha256}.jpg`));
      check(sha(photo) === p.sha256, 'Photo does not match evidence manifest');
      photos.push({ sha256: p.sha256, base64: photo.toString('base64') });
    }
    let savedReview = null;
    try {
      const r = JSON.parse(await fs.readFile(path.join(dir, 'review.json'), 'utf8'));
      check(sha(JSON.stringify(r.document)) === r.evidenceHash, 'Saved review integrity check failed');
      if (r.document.reviewedBy === uid) savedReview = { decision: r.document.decision, notes: r.document.notes,...(r.document.regionalEvidence?{regionalEvidence:r.document.regionalEvidence}:{}), examined: true, evidenceHash: r.document.harvestEvidenceHash };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { ...provenance, manifest, photos, evidenceHash: provenance.batch.harvestEvidenceHash, savedReview };
  }
  async function queue(uid) {
    authorize(uid);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const batches = [], warnings = [];
    for (const e of entries) {
      if (!e.isDirectory() || !/^HC-[a-f0-9]{40}$/.test(e.name) || !canInspectAssignment(participantFor(uid),e.name)) continue;
      try {
        const { batch } = await history(uid, e.name);
        if (batch.status === 'PENDING_REVIEW') batches.push({ batchId: batch.batchId, species: batch.species, originRegion: batch.originRegion, quantityGrams: batch.quantityGrams, status: batch.status });
      } catch (error) {
        if (/Batch not found/.test(error.message)) warnings.push(`${e.name}: registration not yet confirmed`);
        else throw error;
      }
    }
    return { batches, warnings, scope: 'Harvests stored by this backend' };
  }
  async function save(file, data) {
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 }); await fs.rename(tmp, file);
  }
  async function run(uid, id, input) {
    authorize(uid);
    check(input && ['APPROVE', 'REJECT'].includes(input.decision), 'Choose APPROVE or REJECT');
    check(typeof input.notes === 'string' && input.notes.trim().length >= 10 && input.notes.length <= 4000, 'Enter review reasoning of 10 to 4000 characters');
    check(input.examined === true, 'Confirm you examined the evidence');
    const data = await evidence(uid, id);
    check(input.evidenceHash === data.evidenceHash, 'Evidence changed; reload before reviewing');
    check(data.manifest.submittedBy !== uid, 'A collector cannot review their own submission');
    approvalCheck(data.manifest,input);
    const file = path.join(folder(id), 'review.json');
    let record;
    try { record = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (record) {
      check(record.document.reviewedBy === uid && record.document.decision === input.decision && record.document.notes === input.notes.trim() && (record.document.regionalEvidence||'')===(input.regionalEvidence||'').trim() && record.document.harvestEvidenceHash === data.evidenceHash, 'A saved review already exists. Retry its original decision and notes.');
      check(sha(JSON.stringify(record.document)) === record.evidenceHash, 'Saved review integrity check failed');
    } else {
      check(data.batch.status === 'PENDING_REVIEW', 'Batch is no longer awaiting review');
      const document = { schema: 1, batchId: id, reviewedBy: uid, reviewedAt: new Date().toISOString(), decision: input.decision, notes: input.notes.trim(), ...(input.regionalEvidence?{regionalEvidence:input.regionalEvidence.trim()}:{}),harvestEvidenceHash: data.evidenceHash, examined: true };
      record = { document, evidenceHash: sha(JSON.stringify(document)), phase: 'STORED' };
      await save(file, record);
    }
    if (archive) await archive.put(id, 'review', Buffer.from(JSON.stringify(record.document)), record.evidenceHash);
    async function reconcile() {
      const h = await history(uid, id);
      const event = h.events.find(e => e.type === 'REVIEWED');
      if (!event) { check(h.batch.status === 'PENDING_REVIEW', 'Batch is no longer awaiting review'); return false; }
      check(event.details.evidenceHash === record.evidenceHash && event.details.decision === record.document.decision, 'Another review is already committed');
      record.phase = 'COMMITTED'; record.transactionId = event.transactionId; record.status = h.batch.status;
      await save(file, record); return true;
    }
    const result = () => ({ batchId: id, committed: record.phase === 'COMMITTED', transactionId: record.transactionId || null, status: record.phase === 'COMMITTED' ? record.status : 'REVIEW_PENDING', decision: record.document.decision });
    if (await reconcile()) return result();
    let submitted = false;
    try {
      const proposal = contractFor(uid).newProposal('ReviewBatch', { arguments: [id, record.document.decision, record.evidenceHash] });
      const endorsed = await proposal.endorse();
      record.transactionId = proposal.getTransactionId(); record.phase = 'SUBMITTING'; await save(file, record);
      submitted = true;
      const commit = await endorsed.submit(); const status = await commit.getStatus();
      if (!status.successful) throw Error(`Review transaction invalid: ${status.code}. Reload ledger history.`);
      record.phase = 'COMMITTED'; record.status = input.decision === 'APPROVE' ? 'VERIFIED' : 'REJECTED'; await save(file, record);
      return result();
    } catch (error) {
      try { if (await reconcile()) return result(); } catch (readError) {
        if (/Another review|no longer awaiting/.test(readError.message)) throw readError;
      }
      record.phase = 'PENDING'; await save(file, record);
      if (!submitted) throw error;
      return result();
    }
  }
  return { queue, evidence, async submit(uid, id, input) {
    authorize(uid); folder(id);
    const task = (locks.get(id) || Promise.resolve()).catch(() => {}).then(() => run(uid, id, input)); locks.set(id, task);
    try { return await task; } finally { if (locks.get(id) === task) locks.delete(id); }
  } };
}
module.exports = { createReviewService };
