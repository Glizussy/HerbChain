'use strict';
// All time and identity values come from the signed Fabric transaction.
// Derived lots are implemented in lineage.js.
const roles = {
  collector: 'Org1MSP', aggregator: 'Org1MSP', processor: 'Org1MSP',
  manufacturer: 'Org1MSP', distributor: 'Org1MSP',
  verifier: 'Org2MSP', lab: 'Org2MSP', regulator: 'Org2MSP', reader: 'Org2MSP',
};
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function text(value, name, limit = 160) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= limit, `Invalid ${name}`);
  return value.trim();
}
function id(value) { requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value), 'Invalid batch ID'); return value; }
function digest(value) { requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Expected SHA-256 hex digest'); return value; }
function actor(ctx, allowed = Object.keys(roles)) {
  const role = ctx.clientIdentity.getAttributeValue('herbchain.role');
  requireThat(allowed.includes(role) && roles[role] === ctx.clientIdentity.getMSPID(), 'Unauthorized role or organization');
  return { identity: ctx.clientIdentity.getID(), msp: ctx.clientIdentity.getMSPID(), role };
}
async function read(ctx, batchId) {
  const bytes = await ctx.stub.getState(`batch:${id(batchId)}`);
  requireThat(bytes.length > 0, 'Batch not found');
  return JSON.parse(bytes.toString());
}
function movable(b) { requireThat(!['REJECTED', 'RECALLED', 'DELIVERED', 'CONSUMED'].includes(b.status), 'Batch is closed'); }
function owner(b, a) { requireThat(b.owner === a.identity && b.ownerMsp === a.msp, 'Only current custodian may perform this action'); requireThat(!b.pendingTransfer, 'Accept or cancel pending transfer first'); }
async function write(ctx, b, a, type, details) {
  requireThat(b.sequence < 1000, 'Pilot event limit reached');
  b.sequence++;
  const ts = ctx.stub.getTxTimestamp();
  const event = { batchId: b.batchId, sequence: b.sequence, type, actor: a,
    transactionId: ctx.stub.getTxID(), timestampSeconds: ts.seconds.toString(), details };
  await ctx.stub.putState(`event:${b.batchId}:${String(b.sequence).padStart(6, '0')}`, Buffer.from(JSON.stringify(event)));
  await ctx.stub.putState(`batch:${b.batchId}`, Buffer.from(JSON.stringify(b)));
  ctx.stub.setEvent('BatchUpdated', Buffer.from(JSON.stringify({ batchId: b.batchId, type, sequence: b.sequence })));
  return JSON.stringify(b);
}
const methods = {
  async CreateBatch(ctx, raw) {
    const a = actor(ctx, ['collector']);
    const p = JSON.parse(raw);
    const batchId = id(p.batchId);
    requireThat(!(await ctx.stub.getState(`batch:${batchId}`)).length, 'Batch already exists');
    requireThat(Number.isSafeInteger(p.quantityGrams) && p.quantityGrams > 0, 'Quantity must be positive integer grams');
    const b = { batchId, species: text(p.species, 'species'), originRegion: text(p.originRegion, 'origin region'),
      quantityGrams: p.quantityGrams, harvestEvidenceHash: digest(p.harvestEvidenceHash),
      owner: a.identity, ownerMsp: a.msp, status: 'PENDING_REVIEW', sequence: 0, labPassed: false, pendingTransfer: null };
    return write(ctx, b, a, 'COLLECTED', { evidenceHash: b.harvestEvidenceHash });
  },
  async ReviewBatch(ctx, batchId, decision, evidenceHash) {
    const a = actor(ctx, ['verifier']); const b = await read(ctx, batchId);
    requireThat(b.status === 'PENDING_REVIEW', 'Batch already reviewed');
    requireThat(['APPROVE', 'REJECT'].includes(decision), 'Invalid review decision');
    digest(evidenceHash); b.status = decision === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
    return write(ctx, b, a, 'REVIEWED', { decision, evidenceHash });
  },
  async ProposeTransfer(ctx, batchId, recipientIdentity, recipientMsp) {
    const a = actor(ctx, ['collector', 'aggregator', 'processor', 'manufacturer', 'distributor']);
    const b = await read(ctx, batchId); movable(b); owner(b, a);
    requireThat(b.status !== 'PENDING_REVIEW', 'Review required');
    text(recipientIdentity, 'recipient identity', 2048);
    requireThat(recipientMsp === 'Org1MSP' && recipientIdentity !== a.identity, 'Invalid recipient');
    b.pendingTransfer = { identity: recipientIdentity, msp: recipientMsp };
    return write(ctx, b, a, 'TRANSFER_PROPOSED', b.pendingTransfer);
  },
  async AcceptTransfer(ctx, batchId) {
    const a = actor(ctx, ['aggregator', 'processor', 'manufacturer', 'distributor']);
    const b = await read(ctx, batchId); movable(b);
    requireThat(b.pendingTransfer?.identity === a.identity && b.pendingTransfer?.msp === a.msp, 'Only intended recipient may accept');
    b.owner = a.identity; b.ownerMsp = a.msp; b.pendingTransfer = null;
    return write(ctx, b, a, 'TRANSFER_ACCEPTED', {});
  },
  async CancelTransfer(ctx, batchId) {
    const a = actor(ctx); const b = await read(ctx, batchId); movable(b);
    requireThat(b.owner === a.identity && b.ownerMsp === a.msp && b.pendingTransfer, 'Only sender may cancel pending transfer');
    b.pendingTransfer = null; return write(ctx, b, a, 'TRANSFER_CANCELLED', {});
  },
  async RecordLabResult(ctx, batchId, outcome, reportHash) {
    const a = actor(ctx, ['lab']); const b = await read(ctx, batchId); movable(b);
    requireThat(['VERIFIED', 'PROCESSED'].includes(b.status) && !b.pendingTransfer, 'Testing unavailable in current state');
    requireThat(['PASS', 'FAIL'].includes(outcome), 'Invalid lab outcome'); digest(reportHash);
    b.labPassed = outcome === 'PASS';
    if (!b.labPassed) b.status = 'REJECTED';
    return write(ctx, b, a, 'LAB_TESTED', { outcome, reportHash });
  },
  async RecordProcessing(ctx, batchId, method, outputGrams, evidenceHash) {
    const a = actor(ctx, ['processor']); const b = await read(ctx, batchId); movable(b); owner(b, a);
    requireThat(['VERIFIED', 'PROCESSED'].includes(b.status) && b.labPassed, 'Passing lab result required before processing');
    const grams = Number(outputGrams);
    requireThat(Number.isSafeInteger(grams) && grams > 0 && grams <= b.quantityGrams, 'Invalid output mass');
    text(method, 'processing method'); digest(evidenceHash);
    const inputGrams = b.quantityGrams; b.quantityGrams = grams; b.status = 'PROCESSED'; b.labPassed = false;
    return write(ctx, b, a, 'PROCESSED', { method, inputGrams, outputGrams: grams, evidenceHash });
  },
  async PackageBatch(ctx, batchId, productName, evidenceHash) {
    const a = actor(ctx, ['manufacturer']); const b = await read(ctx, batchId); movable(b); owner(b, a);
    requireThat(b.status === 'PROCESSED' && b.labPassed, 'Processed batch with passing final lab result required');
    b.productName = text(productName, 'product name'); digest(evidenceHash); b.status = 'PACKAGED';
    return write(ctx, b, a, 'PACKAGED', { productName: b.productName, evidenceHash });
  },
  async RecordDelivery(ctx, batchId, receiptHash) {
    const a = actor(ctx, ['distributor']); const b = await read(ctx, batchId); owner(b, a);
    requireThat(b.status === 'PACKAGED', 'Only packaged batches can be delivered'); digest(receiptHash);
    b.status = 'DELIVERED'; return write(ctx, b, a, 'DELIVERED', { receiptHash });
  },
  async RecallBatch(ctx, batchId, noticeHash) {
    const a = actor(ctx, ['regulator']); const b = await read(ctx, batchId); digest(noticeHash);
    requireThat(b.status !== 'RECALLED', 'Already recalled'); b.status = 'RECALLED'; b.pendingTransfer = null;
    return write(ctx, b, a, 'RECALLED', { noticeHash });
  },
  async GetBatch(ctx, batchId) { actor(ctx); return JSON.stringify(await read(ctx, batchId)); },
  async GetProvenance(ctx, batchId) {
    actor(ctx); const b = await read(ctx, batchId); const events = [];
    for (let n = 1; n <= b.sequence; n++) {
      const bytes = await ctx.stub.getState(`event:${b.batchId}:${String(n).padStart(6, '0')}`);
      requireThat(bytes.length, 'Missing event'); events.push(JSON.parse(bytes.toString()));
    }
    return JSON.stringify({ batch: b, events });
  },
};
require('./lineage')({methods,actor,read,write,owner,id,digest,requireThat});
module.exports = { methods };
