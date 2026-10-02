'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { digest } = require('./evidence-archive');
// Inventory only immutable bytes. Request journals and signing keys are never uploaded.
async function* evidenceInventory(directory) {
  function item(batchId, kind, bytes, hash) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(batchId) || !/^[a-f0-9]{64}$/.test(hash) || digest(bytes) !== hash) throw Error('Local evidence integrity check failed');
    return { batchId, kind, bytes, hash };
  }
  async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^HC-[a-f0-9]{40}$/.test(entry.name)) continue;
    const folder = path.join(directory, entry.name);
    const submission = await json(path.join(folder, 'submission.json'));
    if (submission.batchId !== entry.name) throw Error('Submission batch mismatch');
    const bytes = await fs.readFile(path.join(folder, 'manifest.json'));
    const manifestItem = item(entry.name, 'manifest', bytes, submission.evidenceHash);
    const manifest = JSON.parse(bytes);
    if (manifest.batchId !== entry.name || !Array.isArray(manifest.photos)) throw Error('Manifest batch mismatch');
    for (const photo of manifest.photos) {
      if (!/^[a-f0-9]{64}$/.test(photo.sha256)) throw Error('Invalid photo reference');
      yield item(entry.name, 'photo', await fs.readFile(path.join(folder, photo.sha256 + '.jpg')), photo.sha256);
    }
    yield manifestItem;
    let review;
    try { review = await json(path.join(folder, 'review.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (review) {
      if (review.document.batchId !== entry.name || review.document.harvestEvidenceHash !== submission.evidenceHash) throw Error('Review batch mismatch');
      yield item(entry.name, 'review', Buffer.from(JSON.stringify(review.document)), review.evidenceHash);
    }
  }
  const root = path.join(directory, '.lifecycle');
  let entries;
  try { entries = await fs.readdir(root); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const name of entries) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const record = await json(path.join(root, name));
    if (record.document.batchId !== record.batchId) throw Error('Operation batch mismatch');
    const doc = item(record.batchId, 'operation', Buffer.from(JSON.stringify(record.document)), record.evidenceHash);
    if (record.document.attachmentHash) yield item(record.batchId, 'report', Buffer.from(record.input.attachment, 'base64'), record.document.attachmentHash);
    yield doc;
  }
}
module.exports = { evidenceInventory };
