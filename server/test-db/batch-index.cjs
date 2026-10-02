'use strict';
const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {actions}=require('../src/dashboard');
(async()=>{const db=new PGlite();try{
 await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid';");
 for(const f of ['001_memberships.sql','002_batch_index.sql','007_lot_read_model.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',f),'utf8'));
 const ids=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
 const org='10000000-0000-4000-8000-000000000001';await db.query("insert into hc_organizations(id,name,msp_id) values ($1,'Pilot','Org1MSP')",[org]);
 for(const [i,role] of ['collector','collector','verifier','aggregator'].entries()){await db.query('insert into auth.users(id) values($1)',[ids[i]]);await db.query('insert into hc_memberships(user_id,organization_id,role,display_name,fabric_identity) values($1,$2,$3,$4,$4)',[ids[i],org,role,'actor'+i]);}
 function update(id,sequence=1,owner='actor0',extra={},type=sequence===1?'COLLECTED':'REVIEWED'){
  const state={batchId:id,species:'Tulsi',originRegion:'Pune Maharashtra',quantityGrams:1000,status:sequence===1?'PENDING_REVIEW':'VERIFIED',sequence,owner,ownerMsp:'Org1MSP',pendingTransfer:null,labPassed:false,...extra};
  return {state,event:{batchId:id,sequence,type,transactionId:id+'-tx-'+sequence,actor:{identity:owner,msp:'Org1MSP'},timestampSeconds:'1800000000',details:{}}};
 }
 const apply=async(block,updates,digest=String(block%10).repeat(64))=>(await db.query('select hc_apply_block($1,$2,$3,$4::jsonb) as r',['herbchain',String(block),digest,JSON.stringify(updates)])).rows[0].r;
 const page=async(user=ids[0],after=null,query='',filter='all',limit=25)=>(await db.query('select hc_list_batches($1,$2,$3,$4,$5,$6) as r',[user,'herbchain',after,limit,query,filter])).rows[0].r;
 await apply(0,[update('batch-a'),update('batch-other',1,'actor1')]);await apply(1,[]);
 assert.equal((await apply(0,[])).replayed,true);assert.equal((await db.query('select count(*)::int as n from hc_index_events')).rows[0].n,2);
 await assert.rejects(apply(0,[],'f'.repeat(64)),/differs/);await assert.rejects(apply(3,[]),/Block gap/);
 await assert.rejects(apply(2,[update('batch-a',2),update('batch-other',9,'actor1')]),/sequence gap/);
 assert.equal((await db.query('select next_block::text as n from hc_index_heads')).rows[0].n,'2');assert.equal((await page()).rows[0].state.sequence,1);
 await apply(2,[update('batch-a',2)]);assert.equal((await page(ids[1])).rows.length,1);assert.equal((await page(ids[2])).rows.length,0);
 await db.query("insert into hc_batch_assignments(user_id,batch_id,role) values($1,'batch-a','verifier')",[ids[2]]);assert.equal((await page(ids[2])).rows.length,1);
 await db.query('delete from hc_batch_assignments where user_id=$1',[ids[2]]);assert.equal((await page(ids[2])).rows.length,0);
 await apply(3,[update('batch-a',3,'actor0',{pendingTransfer:{identity:'actor3',msp:'Org1MSP'}},'TRANSFER_PROPOSED')]);
 assert.equal((await page(ids[3],null,'','incoming')).rows.length,1);
 await apply(4,[update('batch-a',4,'actor0',{},'TRANSFER_CANCELLED')]);assert.equal((await page(ids[3])).rows.length,0);
 await apply(5,[update('batch-a',5,'actor3',{},'TRANSFER_ACCEPTED')]);assert.equal((await page(ids[0])).rows.length,1);assert.equal((await page(ids[3])).rows.length,1);
 const count=Number(process.env.HC_INDEX_TEST_BATCHES||200);const rows=Array.from({length:count},(_,i)=>update('scale-'+String(i).padStart(6,'0')));
 await apply(6,rows);let cursor=null,seen=new Set(),pages=0;
 do {const r=await page(ids[0],cursor);assert.ok(r.rows.length<=25);for(const row of r.rows){assert.ok(!seen.has(row.state.batchId));seen.add(row.state.batchId);}cursor=r.nextCursor;pages++;}while(cursor);
 assert.equal(seen.size,count+1);assert.equal((await page(ids[0],null,'Maharashtra')).filteredCount,count+1);assert.equal((await page(ids[0],null,'unmatched')).rows.length,0);
 assert.equal((await page(ids[1])).stats.total,1);
 // Check SQL task filtering against the existing application rules across all states/roles.
 for(const role of ['collector','aggregator','verifier','lab','processor','manufacturer','distributor','regulator'])for(const status of ['PENDING_REVIEW','VERIFIED','PROCESSED','PACKAGED','DELIVERED','REJECTED','RECALLED'])for(const pendingTransfer of [null,{identity:'actor0',msp:'Org1MSP'},{identity:'elsewhere',msp:'Org1MSP'}]){
  const b=update('test',1,'actor0',{status,pendingTransfer,labPassed:true}).state;
  const actual=(await db.query('select hc_batch_has_task($1::jsonb,$2,$3,$4) as value',[JSON.stringify(b),role,'actor0','Org1MSP'])).rows[0].value;
  assert.equal(actual,actions({batch:b},{role,identity:'actor0',msp:'Org1MSP'}).length>0,role+' '+status);
 }
 await db.exec('set role authenticated');await assert.rejects(db.query("select hc_list_batches($1,'herbchain')",[ids[0]]),e=>e.code==='42501');await assert.rejects(db.exec('select * from hc_batch_index'),e=>e.code==='42501');await db.exec('reset role');
 await db.query("update hc_memberships set state='suspended' where user_id=$1",[ids[0]]);await assert.rejects(page(),/Active membership/);
 console.log('PASS: atomic checkpoint rollback, idempotent replay, gap detection, membership/assignment visibility, cancelled recipient access, search, '+(count+1)+' batches across '+pages+' pages, task-rule parity and private RPC grants.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
