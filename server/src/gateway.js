'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const grpc = require('@grpc/grpc-js');
const { connect, signers, hash } = require('@hyperledger/fabric-gateway');
const identities = JSON.parse(fs.readFileSync(process.env.FABRIC_IDENTITIES_FILE, 'utf8'));
const { createMembershipRepository, createMembershipAccess } = require('./memberships');
const mode = process.env.HERBCHAIN_MEMBERSHIP_MODE || 'file';
const access = createMembershipAccess({identities,mode,repository:mode==='supabase'?createMembershipRepository({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY}):undefined});
const connections = new Map();
const maxConnections=Number(process.env.FABRIC_MAX_CONNECTIONS||128);
if(!Number.isInteger(maxConnections)||maxConnections<1||maxConnections>4096)throw Error('Invalid Gateway connection limit');
function dashboardActor(uid) {
  const c = access.config(uid);
  const organizations = { collector: 'Org1MSP', aggregator: 'Org1MSP', processor: 'Org1MSP', manufacturer: 'Org1MSP', distributor: 'Org1MSP', verifier: 'Org2MSP', lab: 'Org2MSP', regulator: 'Org2MSP' };
  if (!c || !Object.hasOwn(organizations,c.role) || c.mspId !== organizations[c.role] || !c.fabricIdentity) throw Error('An enrolled participant account is required');
  return { role:c.role, identity:c.fabricIdentity, msp:c.mspId, name:c.displayName || c.role, scope:c.scope, assignments:c.assignments, organizationId:c.organizationId };
}
function lifecycleActor(uid) {
  const c = access.config(uid);
  const organizations = { lab: 'Org2MSP', regulator: 'Org2MSP', processor: 'Org1MSP', manufacturer: 'Org1MSP', distributor: 'Org1MSP' };
  if (!c || !Object.hasOwn(organizations, c.role) || organizations[c.role] !== c.mspId || !c.fabricIdentity) throw Error('An enrolled lifecycle participant is required');
  return { role: c.role, identity: c.fabricIdentity, msp: c.mspId, scope:c.scope, assignments:c.assignments };
}
function custodyActor(uid) {
  const c = access.config(uid);
  if (!c || c.mspId !== 'Org1MSP' || !['collector','aggregator','processor','manufacturer','distributor'].includes(c.role) || !c.fabricIdentity) throw Error('An enrolled supply participant is required');
  return { uid, role: c.role, identity: c.fabricIdentity, msp: c.mspId, name: c.displayName || c.role };
}
function custodyDirectory(uid) {
  custodyActor(uid);
  return access.directoryIds().map(id=>({id,c:access.config(id)})).filter(({c}) => c.fabricIdentity && c.mspId === 'Org1MSP' && ['aggregator','processor','manufacturer','distributor'].includes(c.role))
    .map(({id,c}) => ({ uid:id, role:c.role, name:c.displayName || c.role, organization:c.organizationName }));
}
function participantFor(uid) {
  const c=access.config(uid);
  return { role:c.role || 'unconfigured', scope:c.scope, assignments:c.assignments, organizationId:c.organizationId };
}
function contractFor(uid) {
  access.config(uid); // Recheck request membership even when a Gateway connection is cached.
  if (!connections.has(uid)) {
    if(connections.size>=maxConnections)throw Object.assign(Error('Gateway connection capacity reached; retry later'),{statusCode:503});
    const c = access.config(uid);
    const client = new grpc.Client(c.endpoint, grpc.credentials.createSsl(fs.readFileSync(c.tlsCertificate)), {
      'grpc.ssl_target_name_override': c.hostOverride,
    });
    const gateway = connect({ client,
      identity: { mspId: c.mspId, credentials: fs.readFileSync(c.certificate) },
      signer: signers.newPrivateKeySigner(crypto.createPrivateKey(fs.readFileSync(c.privateKey))), hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 10000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),
      submitOptions: () => ({ deadline: Date.now() + 15000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    connections.set(uid, { client, gateway, contract: gateway.getNetwork(process.env.FABRIC_CHANNEL || 'herbchain').getContract(process.env.FABRIC_CHAINCODE || 'herbchain', 'HerbChain') });
  }
  return connections.get(uid).contract;
}
async function commitStatusFor(uid,transactionId){
  contractFor(uid);const c=access.config(uid),protos=require('@hyperledger/fabric-protos');
  const creator=new protos.msp.SerializedIdentity();creator.setMspid(c.mspId);creator.setIdBytes(fs.readFileSync(c.certificate));
  const request=new protos.gateway.CommitStatusRequest();request.setChannelId(process.env.FABRIC_CHANNEL||'herbchain');request.setTransactionId(transactionId);request.setIdentity(creator.serializeBinary());
  const signed=new protos.gateway.SignedCommitStatusRequest();signed.setRequest(request.serializeBinary());
  return connections.get(uid).gateway.newCommit(signed.serializeBinary()).getStatus({deadline:Date.now()+10000});
}
function close() { for (const c of connections.values()) { c.gateway.close(); c.client.close(); } }
module.exports = { commitStatusFor, contractFor, participantFor, custodyActor, custodyDirectory, lifecycleActor, dashboardActor, close, withParticipant:access.run, prepareDirectory:access.prepareDirectory };
