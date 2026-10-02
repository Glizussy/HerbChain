'use strict';
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const types = { manifest: 'application/json', review: 'application/json', operation: 'application/json', photo: 'image/jpeg', report: 'application/pdf' };
const BUCKET = 'herbchain-evidence';
function failure(message) { return Object.assign(new Error(message), { statusCode: 503 }); }
// Server-only archive. Never return its credentials or URLs to a browser.
function createEvidenceArchive({ url, key, fetchImpl = fetch }) {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw Error('Evidence storage requires an HTTPS project origin');
  if (!key) throw Error('Missing server-only storage credential');
  const base = origin.origin + '/storage/v1';
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  async function request(route, options = {}) {
    try { return await fetchImpl(base + route, { ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw failure('Private evidence storage is unavailable. Retry the original submission.'); }
  }
  async function privateBucket() {
    const response = await request('/bucket/' + BUCKET);
    if (!response.ok) throw failure('Private evidence bucket is unavailable');
    let bucket; try { bucket = await response.json(); } catch { throw failure('Invalid evidence bucket response'); }
    if (bucket.id !== BUCKET || bucket.public !== false) throw failure('Evidence bucket must be private');
  }
  function objectPath(batchId, kind, hash) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(batchId) || !Object.hasOwn(types, kind) || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid evidence object reference');
    return '/' + BUCKET + '/' + batchId + '/' + kind + '/' + hash;
  }
  async function read(route, hash) {
    const response = await request('/object/authenticated' + route);
    if (!response.ok) throw failure('Archived evidence cannot be verified');
    // Bound the response even when a storage proxy omits Content-Length.
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) throw Error('size');
        chunks.push(Buffer.from(chunk));
      }
    } catch { throw failure('Archived evidence download failed'); }
    const bytes = Buffer.concat(chunks);
    if (digest(bytes) !== hash) throw failure('Archived evidence integrity check failed');
    return bytes;
  }
  return {
    async put(batchId, kind, bytes, expectedHash) {
      bytes = Buffer.from(bytes);
      const hash = digest(bytes), route = objectPath(batchId, kind, hash);
      if (hash !== expectedHash || !bytes.length || bytes.length > 5 * 1024 * 1024) throw Error('Evidence bytes do not match the expected digest or size');
      await privateBucket();
      const response = await request('/object' + route, { method: 'POST', headers: { 'Content-Type': types[kind], 'x-upsert': 'false' }, body: bytes });
      if (!response.ok) {
        // Storage can use HTTP 400 for an existing object. Accept only its documented duplicate code.
        let error; try { error = await response.json(); } catch {}
        if (!(response.status === 409 || (response.status === 400 && ['Duplicate','Asset Already Exists'].includes(error?.error)))) throw failure('Evidence upload failed. Retry the original submission.');
      }
      await read(route, hash); // Success requires exact-byte readback, including duplicate retries.
      return { sha256: hash, bytes: bytes.length };
    },
    async get(batchId, kind, hash) { const route = objectPath(batchId, kind, hash); await privateBucket(); return read(route, hash); }
  };
}
function archiveFromEnvironment(env = process.env) {
  const mode = env.HERBCHAIN_EVIDENCE_MODE || 'local';
  if (mode === 'local') return null;
  if (mode !== 'archive') throw Error('Invalid HERBCHAIN_EVIDENCE_MODE');
  return createEvidenceArchive({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY });
}
module.exports = { createEvidenceArchive, archiveFromEnvironment, digest };
