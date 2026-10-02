'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createMembershipAccess,createMembershipRepository,canInspectAssignment}=require('../src/memberships');
function fixture(){
 const identities={a:{role:'collector',mspId:'Org1MSP',fabricIdentity:'farmer-a'},b:{role:'collector',mspId:'Org1MSP',fabricIdentity:'farmer-b'},r:{role:'verifier',mspId:'Org2MSP',fabricIdentity:'reviewer'},agg:{role:'aggregator',mspId:'Org1MSP',fabricIdentity:'aggregator'}};
 const rows=Object.fromEntries(Object.entries(identities).map(([uid,c])=>[uid,{user_id:uid,role:c.role,state:'active',organization_id:c.mspId,display_name:uid,fabric_identity:c.fabricIdentity,hc_organizations:{id:c.mspId,msp_id:c.mspId,active:true,name:'Pilot'}}]));
 const grants=[{batch_id:'batch-a',role:'verifier'}];
 const repository={member:async uid=>rows[uid],assignments:async()=>grants,directory:async()=>[rows.agg]};
 const access=createMembershipAccess({identities,mode:'supabase',repository});return {identities,rows,repository,access,grants};
}
test('two farmers keep isolated request contexts even during overlapping requests',async()=>{
 const {access}=fixture();let resume;const gate=new Promise(r=>resume=r);
 const first=access.run('a',async()=>{await gate;assert.equal(access.config('a').fabricIdentity,'farmer-a');assert.throws(()=>access.config('b'),/membership/);});
 await access.run('b',async()=>{assert.equal(access.config('b').fabricIdentity,'farmer-b');resume();});await first;
 assert.throws(()=>access.config('a'),/membership/);
});
test('suspension, organization disabling, role/identity mismatch and database failure deny new requests',async()=>{
 const f=fixture();await f.access.run('a',()=>assert.equal(f.access.config('a').role,'collector'));
 f.rows.a.state='suspended';await assert.rejects(f.access.run('a',()=>assert.fail()),/inactive/);
 f.rows.a.state='active';f.rows.a.hc_organizations.active=false;await assert.rejects(f.access.run('a',()=>assert.fail()),/inactive/);
 f.rows.a.hc_organizations.active=true;f.rows.a.role='regulator';await assert.rejects(f.access.run('a',()=>assert.fail()),/does not match/);
 f.rows.a.role='collector';f.rows.a.fabric_identity='farmer-b';await assert.rejects(f.access.run('a',()=>assert.fail()),/does not match/);
 f.repository.member=async()=>{throw Error('database offline');};await assert.rejects(f.access.run('a',()=>assert.fail()),/offline/);
});
test('assigned oversight scope is refreshed on each request and role-specific',async()=>{
 const f=fixture();await f.access.run('r',()=>{const c=f.access.config('r');assert.equal(canInspectAssignment(c,'batch-a'),true);assert.equal(canInspectAssignment(c,'batch-b'),false);});
 f.grants[0].role='lab';await f.access.run('r',()=>assert.equal(canInspectAssignment(f.access.config('r'),'batch-a'),false));
});
test('recipient directory only resolves loaded, active, enrolled participants',async()=>{
 const f=fixture();await f.access.run('a',async()=>{assert.throws(()=>f.access.config('agg'),/membership/);await f.access.prepareDirectory();assert.deepEqual(f.access.directoryIds(),['agg']);assert.equal(f.access.config('agg').role,'aggregator');});
 f.rows.agg.state='suspended';await assert.rejects(f.access.run('a',()=>f.access.prepareDirectory()),/inactive/);
});
test('file mode remains explicit and unknown modes cannot silently fall back',async()=>{
 const f=fixture(),access=createMembershipAccess({identities:f.identities});await access.run('a',()=>assert.equal(access.config('a').fabricIdentity,'farmer-a'));
 assert.throws(()=>createMembershipAccess({identities:f.identities,mode:'supabse'}),/must be/);
 assert.throws(()=>createMembershipAccess({identities:f.identities,mode:'supabase'}),/repository/);
});
test('indexed pages may delegate assignment checks to SQL without weakening ordinary requests',async()=>{
 const f=fixture();let calls=0;f.repository.assignments=async()=>{calls++;return f.grants;};
 await f.access.run('r',()=>assert.equal(f.access.config('r').assignments.size,0),{loadAssignments:false});assert.equal(calls,0);
 await f.access.run('r',()=>assert.equal(f.access.config('r').assignments.has('batch-a'),true));assert.equal(calls,1);
});
test('REST membership reader paginates without truncation and does not reveal server credentials on errors',async()=>{
 let calls=0;const repo=createMembershipRepository({url:'https://example.test',key:'secret-not-for-clients',pageSize:2,fetchImpl:async url=>{calls++;const offset=Number(url.searchParams.get('offset'));return {ok:true,json:async()=>offset===0?[{batch_id:'1'},{batch_id:'2'}]:[{batch_id:'3'}]};}});
 assert.equal((await repo.assignments('user')).length,3);assert.equal(calls,2);
 const bad=createMembershipRepository({url:'https://example.test',key:'secret-not-for-clients',fetchImpl:async()=>({ok:false})});await assert.rejects(bad.member('a'),e=>e.statusCode===503&&!e.message.includes('secret'));
 assert.throws(()=>createMembershipRepository({url:'http://remote.test',key:'key'}),/HTTPS/);
});
