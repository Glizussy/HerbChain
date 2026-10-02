'use strict';
const path = require('node:path');
const root = process.env.HERBCHAIN_ROOT || path.resolve(__dirname, '..');
const { evidenceInventory } = require(path.join(root, 'server/src/evidence-inventory'));
const { createEvidenceArchive } = require(path.join(root, 'server/src/evidence-archive'));
(async () => {
  const flags = process.argv.slice(2);
  if (flags.some(x => x !== '--upload')) throw Error('Usage: node archive-evidence.cjs [--upload]');
  const directory = process.env.HERBCHAIN_DATA_DIR || path.join(require('node:os').homedir(), 'herbchain-fabric/harvest-data');
  // Validate the complete inventory before uploading anything. Memory stays bounded to one object.
  let count = 0, bytes = 0;
  for await (const item of evidenceInventory(directory)) { count++; bytes += item.bytes.length; }
  console.log(`Local inventory verified: ${count} objects, ${bytes} bytes. Ledger correspondence has not been checked.`);
  if (!flags.includes('--upload')) return console.log('Dry run only. No uploads or deletions.');
  const archive = createEvidenceArchive({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY});
  let copied = 0;
  for await (const item of evidenceInventory(directory)) { await archive.put(item.batchId,item.kind,item.bytes,item.hash); copied++; }
  console.log(`Archived and readback-verified ${copied} objects. Local files retained.`);
})().catch(() => { console.error('Archive stopped. Check configuration and local evidence integrity; no local files were deleted. Retry is safe.'); process.exitCode=1; });
