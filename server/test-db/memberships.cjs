'use strict';
// In-memory PostgreSQL, never a connection to the configured Supabase project.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/001_memberships.sql'),'utf8'));
 const a='20000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002',r='20000000-0000-4000-8000-000000000003';
 const org='10000000-0000-4000-8000-000000000001',org2='10000000-0000-4000-8000-000000000002';
 await db.query('insert into auth.users(id) values ($1),($2),($3)',[a,b,r]);
 await db.query("insert into hc_organizations(id,name,msp_id) values ($1,'Supply','Org1MSP'),($2,'Oversight','Org2MSP')",[org,org2]);
 for(const [uid,role,o] of [[a,'collector',org],[b,'collector',org],[r,'verifier',org2]])await db.query('insert into hc_memberships(user_id,organization_id,role,display_name,fabric_identity) values ($1,$2,$3,$4,$5)',[uid,o,role,role,uid]);
 for(const uid of [a,b])await db.query("insert into hc_farms(owner_user_id,organization_id,name,district,state,latitude,longitude) values ($1,$2,'Farm','Pune','Maharashtra',18,73)",[uid,org]);
 await db.query("insert into hc_batch_assignments(user_id,batch_id,role) values ($1,'batch-a','verifier')",[r]);
 async function asUser(uid){await db.exec('reset role; set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);}
 await asUser(a);
 assert.equal((await db.query('select * from hc_memberships')).rows.length,1);
 assert.equal((await db.query('select * from hc_farms')).rows.length,1);
 assert.equal((await db.query('select * from hc_organizations')).rows.length,1);
 assert.equal((await db.query('select * from hc_batch_assignments')).rows.length,0);
 assert.equal((await db.query('select * from hc_farms where owner_user_id=$1',[b])).rows.length,0);
 for(const sql of ["update hc_memberships set role='regulator'","insert into hc_batch_assignments(user_id,batch_id,role) values ('"+r+"','batch-b','verifier')",'delete from hc_farms'])await assert.rejects(db.exec(sql),e=>e.code==='42501');
 await asUser(b);assert.equal((await db.query('select owner_user_id from hc_farms')).rows[0].owner_user_id,b);
 await asUser(r);assert.equal((await db.query('select * from hc_batch_assignments')).rows.length,1);assert.equal((await db.query('select * from hc_farms')).rows.length,0);
 await db.exec('reset role; set role anon');for(const table of ['hc_memberships','hc_farms','hc_organizations','hc_batch_assignments'])await assert.rejects(db.exec('select * from '+table),e=>e.code==='42501');
 await db.exec('reset role; set role service_role');assert.equal((await db.query('select * from hc_memberships')).rows.length,3);
 await db.query("update hc_memberships set state='suspended' where user_id=$1",[a]);
 await asUser(a);assert.equal((await db.query('select * from hc_farms')).rows.length,0);assert.equal((await db.query('select * from hc_organizations')).rows.length,0);
 await db.exec('reset role');await db.query('update hc_organizations set active=false where id=$1',[org2]);await asUser(r);assert.equal((await db.query('select * from hc_batch_assignments')).rows.length,0);
 await db.exec('reset role');
 await assert.rejects(db.query("insert into hc_farms(owner_user_id,organization_id,name,district,state) values ($1,$2,'Invalid','District','State')",[r,org2]),e=>e.code==='23503');
 await assert.rejects(db.query("insert into hc_batch_assignments(user_id,batch_id,role) values ($1,'batch-b','verifier')",[a]),e=>e.code==='23503');
 console.log('PASS: migration, two-farmer isolation, assigned reviewer, denied role escalation/client writes/anonymous access, suspension, disabled organization and role constraints (in-memory PostgreSQL).');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
