'use strict';
// Run inside Ubuntu. Argument is a Supabase Auth user UUID, never a password/key.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseEnv } = require('node:util');
const { loadParticipants } = require('./participant-accounts.cjs');
const args=process.argv.slice(2);
let exportPath=null;
if(args[0]==='--export-memberships'){args.shift();exportPath=args.shift();if(!exportPath)throw Error('Specify an output SQL path');}
const entries=loadParticipants(args);
const accounts=Object.fromEntries(entries.map(p=>[p.role,p.userId]));
const uid = accounts.collector, reviewerUid = accounts.verifier, aggregatorUid = accounts.aggregator;
const root = process.env.HERBCHAIN_ROOT || path.resolve(__dirname, '..');
const samples = process.env.FABRIC_SAMPLES || path.join(os.homedir(), 'herbchain-fabric/fabric-samples');
const { ClientIdentity } = require(path.join(root, 'blockchain/chaincode/node_modules/fabric-shim'));
function identity(name, role, org) {
  const msp = path.join(root, 'blockchain/identities', name, 'msp');
  const keys = fs.readdirSync(path.join(msp, 'keystore')).filter(n => fs.statSync(path.join(msp, 'keystore', n)).isFile());
  if (keys.length !== 1) throw Error(`Expected one signing key for ${name}`);
  const c = { role, mspId: org === 'org1' ? 'Org1MSP' : 'Org2MSP', certificate: path.join(msp, 'signcerts/cert.pem'), privateKey: path.join(msp, 'keystore', keys[0]),
    tlsCertificate: path.join(samples, `test-network/organizations/peerOrganizations/${org}.example.com/tlsca/tlsca.${org}.example.com-cert.pem`),
    endpoint: org === 'org1' ? 'localhost:7051' : 'localhost:9051', hostOverride: `peer0.${org}.example.com` };
  const cert = new ClientIdentity({ getChannelID: () => 'herbchain', getTxID: () => 'preflight', getCreator: () => ({ mspid: c.mspId, idBytes: fs.readFileSync(c.certificate) }) });
  if (cert.getAttributeValue('herbchain.role') !== role) throw Error(`Incorrect ${name} certificate role`);
  c.fabricIdentity = cert.getID(); c.displayName = name;
  fs.accessSync(c.tlsCertificate, fs.constants.R_OK); return c;
}
const identities = { 'consumer-reader': identity('reader1', 'reader', 'org2') };
for (const participant of entries) {
  identities[participant.userId] = identity(participant.identityName, participant.role, participant.org);
  identities[participant.userId].displayName=participant.displayName;
}
const certificateIds=new Set();
for(const c of Object.values(identities)){const id=c.mspId+':'+c.fabricIdentity;if(certificateIds.has(id))throw Error('Two accounts share a Fabric signing identity');certificateIds.add(id);}
if(exportPath){
  fs.writeFileSync(exportPath,require('./membership-seed.cjs').membershipSeed(entries,identities),{flag:'wx',mode:0o600});
  console.log('Membership seed prepared at '+exportPath+'. No database changes or API startup performed.');
  process.exit(0);
}
const env = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
if (!env.EXPO_PUBLIC_SUPABASE_URL || !env.EXPO_PUBLIC_SUPABASE_ANON_KEY) throw Error('App .env is missing Supabase URL/anon key');
const dataDir = path.resolve(samples, '../harvest-data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
// One backend process per local evidence directory; stops cross-process races.
const lock = path.join(dataDir, '.api.lock');
try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
catch (e) { if (e.code === 'EEXIST') throw Error(`Harvest API lock exists: ${lock}. Check the recorded process before removing a stale lock.`); throw e; }
process.on('exit', () => { try { fs.unlinkSync(lock); } catch {} });
const runDir = fs.mkdtempSync(path.resolve(samples, '../farmer-api-'));
const config = path.join(runDir, 'identities.json');
fs.writeFileSync(config, JSON.stringify(identities, null, 2), { mode: 0o600 });
Object.assign(process.env, { HOST: '127.0.0.1', PORT: '3002', HERBCHAIN_DATA_DIR: dataDir, FABRIC_IDENTITIES_FILE: config,
  FABRIC_CHANNEL: 'herbchain', FABRIC_CHAINCODE: 'herbchain', PUBLIC_IDENTITY: 'consumer-reader',
  SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY: env.EXPO_PUBLIC_SUPABASE_ANON_KEY });
require(path.join(root, 'server/src/server.js'));
console.log('Farmer API configured on http://127.0.0.1:3002 (Ubuntu localhost).');
console.log(`Collector account: ${uid}. Private evidence directory: ${dataDir}`);
console.log('Use a reachable HTTPS proxy URL for the Android app. This message does not verify live Fabric or Supabase connectivity.');
console.log('Keep this terminal open. Ctrl+C stops the API.');
console.log('Reviewer portal: http://127.0.0.1:3002/review');
console.log('Custody portal: http://127.0.0.1:3002/custody');
console.log('Lab and supply operations: http://127.0.0.1:3002/operations');
console.log('Unified participant dashboard: http://127.0.0.1:3002/dashboard');
console.log('Configured roles: ' + Object.keys(accounts).join(', '));
console.log('Enrolled participants: '+entries.length+'. Membership mode: '+(process.env.HERBCHAIN_MEMBERSHIP_MODE||'file'));
console.log(aggregatorUid ? `Aggregator account mapped: ${aggregatorUid}` : 'Optional third account argument: aggregator Supabase UUID.');
console.log(reviewerUid ? `Reviewer account mapped: ${reviewerUid}` : 'Reviewer not mapped yet. Optional second argument: reviewer Supabase UUID.');
