'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalize, createHarvestService } = require('../src/harvests');
function harvest(changes = {}) {
  return { batchId: 'HC-phone-test', herbName: 'Tulsi', originRegion: 'Pune, Maharashtra', plantPart: 'Leaf',
    quantity: { value: 1, unit: 'kg' }, collectionTimestamp: '2026-01-01T00:00:00Z',
    location: { latitude: 18.5, longitude: 73.8, accuracy: 8 }, collector: { name: 'Sample collector', id: '' },
    sourceType: 'Cultivated', harvestMethod: 'Hand-picked', photos: [{ base64: Buffer.from([255,216,255,1,255,217]).toString('base64') }], ...changes };
}
async function fixture(t, mode = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'herbchain-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ledger = new Map(); let submissions = 0;
  const contractFor = () => ({
    evaluateTransaction: async (_method, id) => {
      if (mode.offline) throw Error('UNAVAILABLE');
      if (!ledger.has(id)) throw Error('Batch not found');
      return Buffer.from(JSON.stringify(ledger.get(id)));
    },
    newProposal: (_method, options) => {
      const payload = JSON.parse(options.arguments[0]);
      return { getTransactionId: () => 'tx-test', endorse: async () => ({ submit: async () => {
        submissions++;
        ledger.set(payload.batchId, { batch: { ...payload, status: 'PENDING_REVIEW' }, events: [{ type: 'COLLECTED', transactionId: 'tx-test' }] });
        if (mode.timeoutAfterCommit) throw Error('Deadline exceeded');
        return { getStatus: async () => ({ successful: true }) };
      } }) };
    },
  });
  return { directory, ledger, mode, contractFor, service: createHarvestService({ directory, contractFor }), count: () => submissions };
}
test('stores evidence privately and submits only a hash/coarse origin to Fabric', async t => {
  const f = await fixture(t); const result = await f.service.submit('user-1', harvest());
  assert.equal(result.committed, true); assert.equal(result.status, 'PENDING_REVIEW'); assert.equal(f.count(), 1);
  const b = f.ledger.get(result.batchId).batch;
  assert.equal(b.quantityGrams, 1000); assert.equal(b.location, undefined); assert.equal(b.photos, undefined);
  const manifest = JSON.parse(await fs.readFile(path.join(f.directory, result.batchId, 'manifest.json')));
  assert.equal(manifest.submittedBy, 'user-1'); assert.equal(manifest.location.latitude, 18.5);
});
test('concurrent and restarted retries do not duplicate a committed batch', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.service.submit('user-1', harvest()), f.service.submit('user-1', harvest())]);
  assert.equal(results[0].batchId, results[1].batchId); assert.equal(f.count(), 1);
  const restarted = createHarvestService({ directory: f.directory, contractFor: f.contractFor });
  assert.equal((await restarted.submit('user-1', harvest())).committed, true); assert.equal(f.count(), 1);
});
test('commit timeout reconciles from ledger and returns the actual committed transaction', async t => {
  const f = await fixture(t, { timeoutAfterCommit: true });
  const result = await f.service.submit('user-1', harvest());
  assert.equal(result.committed, true); assert.equal(result.transactionId, 'tx-test'); assert.equal(f.count(), 1);
});
test('offline evidence remains pending and can be registered on retry', async t => {
  const f = await fixture(t, { offline: true });
  const pending = await f.service.submit('user-1', harvest());
  assert.equal(pending.committed, false); assert.equal(pending.evidenceStored, true); assert.equal(f.count(), 0);
  f.mode.offline = false;
  assert.equal((await f.service.submit('user-1', harvest())).committed, true);
});
test('changed evidence under a previous submission ID is rejected', async t => {
  const f = await fixture(t); await f.service.submit('user-1', harvest());
  await assert.rejects(f.service.submit('user-1', harvest({ herbName: 'Neem' })), /different evidence/);
  assert.equal(f.count(), 1);
});
test('different authenticated users cannot collide on the same client reference', async t => {
  const f = await fixture(t);
  const a = await f.service.submit('user-1', harvest()); const b = await f.service.submit('user-2', harvest());
  assert.notEqual(a.batchId, b.batchId);
});
test('tampered stored photo blocks a retry', async t => {
  const f = await fixture(t); const result = await f.service.submit('user-1', harvest());
  const folder = path.join(f.directory, result.batchId);
  const photo = (await fs.readdir(folder)).find(name => name.endsWith('.jpg'));
  await fs.writeFile(path.join(folder, photo), 'tampered');
  await assert.rejects(f.service.submit('user-1', harvest()), /photo integrity/);
});
test('validates GPS, grams, image type and ML-to-photo association', () => {
  assert.throws(() => normalize(harvest({ location: { latitude: 91, longitude: 0 } })), /GPS/);
  assert.throws(() => normalize(harvest({ quantity: { value: 2, unit: 'bundles' } })), /whole-gram/);
  assert.throws(() => normalize(harvest({ photos: [{ base64: Buffer.from('<script>').toString('base64') }] })), /JPEG/);
  assert.throws(() => normalize(harvest({ mlPrediction: { photoIndex: 6, plant: 'Tulsi', confidence: .9 } })), /association/);
  const normalized = normalize(harvest({ mlPrediction: { photoIndex: 0, plant: 'Tulsi', confidence: .9, modelVersion: 'test-model' } }));
  assert.equal(normalized.record.prediction.trust, 'UNTRUSTED_CLIENT_PREDICTION');
  assert.equal(normalized.record.prediction.photoSha256, normalized.photos[0].sha256);
});

test('cloud outage prevents harvest submission; original retry archives then commits once', async t => {
  const f=await fixture(t);let offline=true;const kinds=[];
  const archive={put:async(id,kind,bytes,digest)=>{if(offline)throw Error('Archive unavailable');assert.equal(require('../src/evidence-archive').digest(bytes),digest);kinds.push(kind);}};
  const service=createHarvestService({directory:f.directory,contractFor:f.contractFor,archive});
  await assert.rejects(service.submit('user-1',harvest()),/Archive unavailable/);assert.equal(f.count(),0);
  offline=false;assert.equal((await service.submit('user-1',harvest())).committed,true);
  assert.deepEqual(kinds,['photo','manifest']);assert.equal(f.count(),1);
  const {evidenceInventory}=require('../src/evidence-inventory');const items=[];
  for await(const item of evidenceInventory(f.directory))items.push(item);
  assert.equal(items.length,2);
  await fs.writeFile(path.join(f.directory,items[0].batchId,'manifest.json'),'tampered');
  await assert.rejects(async()=>{for await(const item of evidenceInventory(f.directory)){}},/integrity/);
});
