'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { methods } = require('../lib/batches');
const HASH = 'a'.repeat(64);
function network() {
  let state = new Map(), serial = 0;
  return async (role, method, ...args) => {
    const staged = new Map(state);
    const who = role.includes(':') ? role.split(':')[1] : role;
    const actualRole = role.split(':')[0];
    const msp = ['lab', 'verifier', 'regulator'].includes(actualRole) ? 'Org2MSP' : 'Org1MSP';
    const ctx = { clientIdentity: { getAttributeValue: () => actualRole, getMSPID: () => msp, getID: () => who },
      stub: { getState: async k => staged.get(k) || Buffer.alloc(0), putState: async (k, v) => staged.set(k, v),
        getTxTimestamp: () => ({ seconds: { toString: () => '1800000000' } }), getTxID: () => `tx-${++serial}`, setEvent: () => {} } };
    const result = await methods[method](ctx, ...args); state = staged;
    return JSON.parse(result);
  };
}
const batch = (changes = {}) => JSON.stringify({ batchId: 'HC-001', species: 'Ocimum_tenuiflorum', originRegion: 'Pilot region', quantityGrams: 10000, harvestEvidenceHash: HASH, ...changes });
async function verified(n) { await n('collector', 'CreateBatch', batch()); await n('verifier', 'ReviewBatch', 'HC-001', 'APPROVE', HASH); }
async function transfer(n, from, to) { await n(from, 'ProposeTransfer', 'HC-001', to, 'Org1MSP'); await n(to, 'AcceptTransfer', 'HC-001'); }
test('full collection-to-delivery trail and subsequent recall', async () => {
  const n = network(); await verified(n);
  await transfer(n, 'collector', 'aggregator'); await transfer(n, 'aggregator', 'processor');
  await n('lab', 'RecordLabResult', 'HC-001', 'PASS', HASH);
  await n('processor', 'RecordProcessing', 'HC-001', 'Drying', '8000', HASH);
  await n('lab', 'RecordLabResult', 'HC-001', 'PASS', HASH);
  await transfer(n, 'processor', 'manufacturer');
  await n('manufacturer', 'PackageBatch', 'HC-001', 'Tulsi dried leaves', HASH);
  await transfer(n, 'manufacturer', 'distributor');
  await n('distributor', 'RecordDelivery', 'HC-001', HASH);
  const history = await n('regulator', 'GetProvenance', 'HC-001');
  assert.equal(history.batch.status, 'DELIVERED'); assert.equal(history.batch.quantityGrams, 8000);
  assert.equal(history.events.length, history.batch.sequence);
  assert.deepEqual(history.events.map(e => e.sequence), history.events.map((_, i) => i + 1));
  assert.equal((await n('regulator', 'RecallBatch', 'HC-001', HASH)).status, 'RECALLED');
});
test('rejects duplicate IDs, malformed hashes, nonpositive and fractional mass', async () => {
  const n = network();
  for (const quantityGrams of [0, -1, 0.5]) await assert.rejects(n('collector', 'CreateBatch', batch({ quantityGrams })), /Quantity/);
  await assert.rejects(n('collector', 'CreateBatch', batch({ harvestEvidenceHash: 'bad' })), /SHA-256/);
  await n('collector', 'CreateBatch', batch()); await assert.rejects(n('collector', 'CreateBatch', batch()), /already exists/);
});
test('collector cannot self-approve or record a lab result', async () => {
  const n = network(); await n('collector', 'CreateBatch', batch());
  await assert.rejects(n('collector', 'ReviewBatch', 'HC-001', 'APPROVE', HASH), /Unauthorized/);
  await assert.rejects(n('collector', 'RecordLabResult', 'HC-001', 'PASS', HASH), /Unauthorized/);
  await assert.rejects(n('collector', 'ProposeTransfer', 'HC-001', 'processor', 'Org1MSP'), /Review required/);
});
test('wrong recipient and wrong owner cannot take custody', async () => {
  const n = network(); await verified(n);
  await n('collector', 'ProposeTransfer', 'HC-001', 'processor', 'Org1MSP');
  await assert.rejects(n('aggregator', 'AcceptTransfer', 'HC-001'), /intended recipient/);
  await assert.rejects(n('aggregator', 'CancelTransfer', 'HC-001'), /Only sender/);
  await n('collector', 'CancelTransfer', 'HC-001');
  await assert.rejects(n('collector:other', 'ProposeTransfer', 'HC-001', 'processor', 'Org1MSP'), /current custodian/);
});
test('processing invalidates testing and enforces mass balance', async () => {
  const n = network(); await verified(n); await transfer(n, 'collector', 'processor');
  await assert.rejects(n('processor', 'RecordProcessing', 'HC-001', 'Dry', '9000', HASH), /lab result/);
  await n('lab', 'RecordLabResult', 'HC-001', 'PASS', HASH);
  await assert.rejects(n('processor', 'RecordProcessing', 'HC-001', 'Dry', '11000', HASH), /output mass/);
  await n('processor', 'RecordProcessing', 'HC-001', 'Dry', '9000', HASH);
  await transfer(n, 'processor', 'manufacturer');
  await assert.rejects(n('manufacturer', 'PackageBatch', 'HC-001', 'Product', HASH), /final lab/);
  await n('lab', 'RecordLabResult', 'HC-001', 'PASS', HASH);
  await n('manufacturer', 'PackageBatch', 'HC-001', 'Product', HASH);
  await assert.rejects(n('manufacturer', 'PackageBatch', 'HC-001', 'Product', HASH), /final lab/);
});
test('failed lab result blocks further movement', async () => {
  const n = network(); await verified(n); await n('lab', 'RecordLabResult', 'HC-001', 'FAIL', HASH);
  await assert.rejects(n('collector', 'ProposeTransfer', 'HC-001', 'processor', 'Org1MSP'), /closed/);
  await assert.rejects(n('lab', 'RecordLabResult', 'HC-001', 'PASS', HASH), /closed/);
});
test('missing or wrong-organization roles fail closed', async () => {
  const ctx = { clientIdentity: { getAttributeValue: () => 'lab', getMSPID: () => 'Org1MSP', getID: () => 'forged' } };
  await assert.rejects(methods.GetBatch(ctx, 'HC-001'), /Unauthorized/);
  await assert.rejects(network()('unknown', 'GetBatch', 'HC-001'), /Unauthorized/);
});
