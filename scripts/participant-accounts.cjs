'use strict';
const fs = require('node:fs');
const participants = {
  collector: { name: 'farmer1', org: 'org1' },
  verifier: { name: 'reviewer1', org: 'org2' },
  aggregator: { name: 'aggregator1', org: 'org1' },
  lab: { name: 'lab1', org: 'org2' },
  processor: { name: 'processor1', org: 'org1' },
  manufacturer: { name: 'manufacturer1', org: 'org1' },
  distributor: { name: 'distributor1', org: 'org1' },
  regulator: { name: 'regulator1', org: 'org2' },
};
function validateAccounts(accounts, complete = true) {
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) throw Error('Expected a role-to-account-ID object');
  const seen = new Set(), result = {};
  for (const [role, value] of Object.entries(accounts)) {
    if (!Object.hasOwn(participants, role)) throw Error(`Unknown participant role: ${role}`);
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw Error(`Set a valid Supabase user UUID for ${role}`);
    const uid = value.toLowerCase();
    if (seen.has(uid)) throw Error(`Each role needs a separate account; duplicate at ${role}`);
    seen.add(uid); result[role] = uid;
  }
  for (const role of complete ? Object.keys(participants) : ['collector']) if (!result[role]) throw Error(`Missing ${role} account`);
  return result;
}
function loadAccounts(args) {
  if (args[0] === '--accounts') {
    if (args.length !== 2) throw Error('Usage: start-farmer-api.cjs --accounts /path/to/accounts.json');
    return validateAccounts(JSON.parse(fs.readFileSync(args[1], 'utf8')));
  }
  if (args.length > 3) throw Error('Use --accounts for all participant roles');
  return validateAccounts(Object.fromEntries(['collector','verifier','aggregator'].slice(0,args.length).map((role,i)=>[role,args[i]])), false);
}
const organizationIds = {org1:'10000000-0000-4000-8000-000000000001',org2:'10000000-0000-4000-8000-000000000002'};
function validateParticipants(input) {
  if(!Array.isArray(input) || !input.length)throw Error('Participants must be a non-empty array');
  const users=new Set(),names=new Set();
  return input.map(p=>{
    if(!p || !Object.hasOwn(participants,p.role))throw Error('Unknown participant role');
    if(typeof p.userId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.userId))throw Error('Invalid participant user UUID');
    const userId=p.userId.toLowerCase();
    if(users.has(userId))throw Error('Each account must have one membership in this phase');users.add(userId);
    if(typeof p.identityName!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(p.identityName))throw Error('Invalid enrolled identity name');
    if(names.has(p.identityName))throw Error('Each participant needs a distinct enrolled Fabric identity');names.add(p.identityName);
    const org=participants[p.role].org;
    const organizationId=p.organizationId||organizationIds[org];
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(organizationId))throw Error('Invalid organization UUID');
    const displayName=p.displayName||p.identityName;
    if(typeof displayName!=='string'||!displayName.trim()||displayName.length>160)throw Error('Invalid participant display name');
    return {userId,role:p.role,identityName:p.identityName,org,organizationId:organizationId.toLowerCase(),displayName:displayName.trim()};
  });
}
function loadParticipants(args) {
  if(args[0]==='--accounts'&&args.length===2){
    const data=JSON.parse(fs.readFileSync(args[1],'utf8'));
    if(Array.isArray(data.participants))return validateParticipants(data.participants);
  }
  return validateParticipants(Object.entries(loadAccounts(args)).map(([role,userId])=>({role,userId,identityName:participants[role].name})));
}
module.exports = { participants, organizationIds, validateAccounts, loadAccounts, validateParticipants, loadParticipants };
