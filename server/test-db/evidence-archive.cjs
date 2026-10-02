'use strict';
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id int primary key,bucket_id text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
 GRANT ALL ON storage.buckets TO anon,authenticated;
 CREATE POLICY broad_bucket_policy ON storage.buckets FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
 GRANT USAGE ON SCHEMA storage TO anon,authenticated;
 GRANT ALL ON storage.objects TO anon,authenticated;
 CREATE POLICY existing_broad_policy ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
 INSERT INTO storage.objects VALUES(1,'herbchain-evidence'),(2,'other');`);
 const sql=fs.readFileSync(path.join(__dirname,'../migrations/003_evidence_archive.sql'),'utf8');
 await db.exec(sql);await db.exec(sql);
 assert.equal((await db.query("SELECT public FROM storage.buckets WHERE id='herbchain-evidence'")).rows[0].public,false);
 for(const role of ['anon','authenticated']){
 await db.exec('SET ROLE '+role);
 assert.deepEqual((await db.query('SELECT id FROM storage.objects')).rows,[{id:2}]);
 await assert.rejects(db.exec("INSERT INTO storage.objects VALUES(3,'herbchain-evidence')"));
 assert.equal((await db.query("UPDATE storage.objects SET bucket_id='other' WHERE id=1 RETURNING id")).rows.length,0);
 assert.equal((await db.query('DELETE FROM storage.objects WHERE id=1 RETURNING id')).rows.length,0);
 assert.equal((await db.query("UPDATE storage.buckets SET public=true WHERE id='herbchain-evidence' RETURNING id")).rows.length,0);
 await db.exec('RESET ROLE');
 }
 await db.exec("UPDATE storage.buckets SET public=true WHERE id='herbchain-evidence'");
 await assert.rejects(db.exec(sql),/public/);await db.exec('ROLLBACK');
 console.log('Evidence bucket SQL passed: repeatable, private, anonymous/authenticated denied despite broad policies; other buckets preserved.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
