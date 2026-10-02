'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
function label(v, name, max = 160) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`Invalid ${name}`);
  return v.trim();
}
function normalize(raw) {
  if (!raw || typeof raw !== 'object') fail('Missing harvest');
  const clientId = label(raw.batchId, 'submission ID', 80);
  if (!/^[A-Za-z0-9_-]+$/.test(clientId)) fail('Invalid submission ID');
  const grams = raw.quantity?.unit === 'kg' ? raw.quantity.value * 1000 : raw.quantity?.unit === 'g' ? raw.quantity.value : NaN;
  if (typeof raw.quantity?.value !== 'number' || !Number.isSafeInteger(grams) || grams <= 0) fail('Use kg or g with a positive whole-gram mass');
  const lat = raw.location?.latitude, lon = raw.location?.longitude;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) fail('Valid GPS coordinates are required');
  const collected = Date.parse(raw.collectionTimestamp);
  if (!Number.isFinite(collected) || collected > Date.now() + 300000) fail('Invalid collection time');
  if (!Array.isArray(raw.photos) || raw.photos.length < 1 || raw.photos.length > 5) fail('Upload 1 to 5 photos');
  const photos = raw.photos.map(p => {
    const base64 = p?.base64;
    if (typeof base64 !== 'string' || base64.length > 4194304 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) fail('Invalid or oversized photo (maximum 3 MB)');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 4 || bytes.toString('base64') !== base64 || !bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) || !bytes.subarray(-2).equals(Buffer.from([255,217]))) fail('Expected a JPEG photo');
    return { bytes, sha256: sha(bytes), mediaType: 'image/jpeg' };
  });
  let prediction = null;
  if (raw.mlPrediction) {
    const p = raw.mlPrediction;
    if (!Number.isInteger(p.photoIndex) || p.photoIndex < 0 || p.photoIndex >= photos.length || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1) fail('Invalid ML evidence association');
    prediction = { plant: label(p.plant, 'predicted species'), confidence: p.confidence,
      photoSha256: photos[p.photoIndex].sha256, modelVersion: label(p.modelVersion, 'model version'),
      trust: 'UNTRUSTED_CLIENT_PREDICTION', note: 'Prediction made from the selected source photo; uploaded JPEG is a compressed derivative.' };
  }
  return { clientId, photos, record: {
    declaredSpecies: label(raw.herbName, 'declared herb'), originRegion: label(raw.originRegion, 'district/state'), quantityGrams: grams,
    plantPart: label(raw.plantPart, 'plant part'), collectionTimestamp: new Date(collected).toISOString(),
    location: { latitude: lat, longitude: lon, accuracy: Number.isFinite(raw.location.accuracy) && raw.location.accuracy >= 0 ? raw.location.accuracy : null },
    collectorLabel: { name: typeof raw.collector?.name === 'string' ? raw.collector.name.slice(0,160) : '', id: typeof raw.collector?.id === 'string' ? raw.collector.id.slice(0,160) : '' },
    sourceType: label(raw.sourceType, 'source type'), harvestMethod: label(raw.harvestMethod, 'harvest method'),
    qualityNotes: typeof raw.qualityNotes === 'string' ? raw.qualityNotes.slice(0,2000) : '',
    photos: photos.map(p => ({ sha256: p.sha256, mediaType: p.mediaType })), prediction,
  } };
}
function createHarvestService({ directory, contractFor, archive = null }) {
  const locks = new Map();
  const batchId = (uid, clientId) => `HC-${sha(`${uid}:${clientId}`).slice(0,40)}`;
  async function save(file, data) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(temporary, file);
  }
  async function readEntry(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  const response = e => ({ batchId: e.batchId, clientId: e.clientId, evidenceStored: true, committed: e.phase === 'COMMITTED',
    status: e.phase === 'COMMITTED' ? e.ledgerStatus : 'REGISTRATION_PENDING', transactionId: e.transactionId || null,
    message: e.phase === 'COMMITTED' ? 'Recorded on Fabric. Independent review is required before use.' : 'Evidence saved. Retry this submission to check or complete blockchain registration.' });
  async function run(uid, raw) {
    const normalized = normalize(raw);
    const id = batchId(uid, normalized.clientId), folder = path.join(directory, id), file = path.join(folder, 'submission.json');
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const fingerprint = sha(JSON.stringify(normalized.record));
    let entry = await readEntry(file);
    if (entry && (entry.uid !== uid || entry.fingerprint !== fingerprint)) fail('This submission ID already has different evidence. Retry the original record or create a new entry.');
    if (!entry) {
      // Write evidence before creating the durable submission record.
      for (const photo of normalized.photos) await fs.writeFile(path.join(folder, `${photo.sha256}.jpg`), photo.bytes, { mode: 0o600 });
      const manifest = Buffer.from(JSON.stringify({ schema: 1, submittedBy: uid, batchId: id, ...normalized.record }));
      await fs.writeFile(path.join(folder, 'manifest.json'), manifest, { mode: 0o600 });
      entry = { uid, clientId: normalized.clientId, batchId: id, fingerprint, evidenceHash: sha(manifest), phase: 'STORED',
        payload: { batchId: id, species: normalized.record.declaredSpecies, originRegion: normalized.record.originRegion,
          quantityGrams: normalized.record.quantityGrams, harvestEvidenceHash: sha(manifest) } };
      await save(file, entry);
    }
    // Detect changed evidence on every retry rather than silently rewriting it.
    if (sha(await fs.readFile(path.join(folder, 'manifest.json'))) !== entry.evidenceHash) fail('Stored evidence manifest integrity check failed');
    for (const photo of normalized.photos) if (sha(await fs.readFile(path.join(folder, `${photo.sha256}.jpg`))) !== photo.sha256) fail('Stored photo integrity check failed');
    if (archive) {
      for (const photo of normalized.photos) await archive.put(id, 'photo', photo.bytes, photo.sha256);
      await archive.put(id, 'manifest', await fs.readFile(path.join(folder, 'manifest.json')), entry.evidenceHash);
    }
    const contract = contractFor(uid);
    async function reconcile() {
      let history;
      try { history = JSON.parse(Buffer.from(await contract.evaluateTransaction('GetProvenance', id)).toString()); }
      catch (e) { if (/Batch not found/.test(e.message)) return false; throw e; }
      if (history.batch.harvestEvidenceHash !== entry.evidenceHash) fail('Ledger evidence conflict');
      entry.phase = 'COMMITTED'; entry.ledgerStatus = history.batch.status;
      entry.transactionId = history.events.find(e => e.type === 'COLLECTED')?.transactionId || entry.transactionId;
      await save(file, entry); return true;
    }
    try {
      if (await reconcile()) return response(entry);
      const proposal = contract.newProposal('CreateBatch', { arguments: [JSON.stringify(entry.payload)] });
      const transaction = await proposal.endorse();
      entry.transactionId = proposal.getTransactionId(); entry.phase = 'SUBMITTING'; await save(file, entry);
      const commit = await transaction.submit(); const status = await commit.getStatus();
      if (!status.successful) throw Error(`Fabric transaction invalid: ${status.code}`);
      entry.phase = 'COMMITTED'; entry.ledgerStatus = 'PENDING_REVIEW'; await save(file, entry);
      return response(entry);
    } catch (e) {
      // A submission can commit despite a timeout. Re-read before reporting pending.
      try { if (await reconcile()) return response(entry); } catch (readError) {
        if (/Ledger evidence conflict/.test(readError.message)) throw readError;
      }
      entry.phase = 'PENDING'; entry.lastError = e.message; await save(file, entry);
      return response(entry);
    }
  }
  return {
    async submit(uid, raw) {
      const key = `${uid}:${raw?.batchId}`;
      const previous = locks.get(key) || Promise.resolve();
      const task = previous.catch(() => {}).then(() => run(uid, raw)); locks.set(key, task);
      try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
    },
  };
}
module.exports = { createHarvestService, normalize };
