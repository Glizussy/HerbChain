'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEvidenceArchive,archiveFromEnvironment,digest}=require('../src/evidence-archive');
function fixture(options={}) {
 const objects=new Map(), calls=[];
 const fetchImpl=async(url,request)=>{
  calls.push({url,request});
  if(options.offline)throw Error('secret credential should not appear');
  if(url.includes('/bucket/'))return Response.json({id:'herbchain-evidence',public:!!options.public});
  const route=url.split('/object')[1].replace('/authenticated','');
  if(request.method==='POST'){
   if(options.denied)return Response.json({error:'denied-secret'},{status:403});
   if(objects.has(route))return Response.json({error:'Duplicate'},{status:400});
   objects.set(route,Buffer.from(request.body));return Response.json({});
  }
  return new Response(options.corrupt?'corrupt':objects.get(route),{status:objects.has(route)?200:404});
 };
 return {objects,calls,archive:createEvidenceArchive({url:'https://example.supabase.co',key:'test-server-key',fetchImpl})};
}
test('archive preserves exact bytes, verifies readback and retries without overwrite',async()=>{
 const f=fixture(), b=Buffer.from('{ "unchanged": true }'), h=digest(b);
 await f.archive.put('HC-test','manifest',b,h);await f.archive.put('HC-test','manifest',b,h);
 assert.equal(f.objects.size,1);assert.deepEqual(await f.archive.get('HC-test','manifest',h),b);
 for(const c of f.calls.filter(x=>x.request.method==='POST'))assert.equal(c.request.headers['x-upsert'],'false');
 assert.ok(f.calls.every(c=>c.request.redirect==='error'));
});
test('public bucket, service failure, denied upload and corrupt readback fail closed',async()=>{
 const b=Buffer.from('evidence'),h=digest(b);
 for(const options of [{public:true},{offline:true},{denied:true},{corrupt:true}]){
  const f=fixture(options);await assert.rejects(f.archive.put('batch','review',b,h),e=>e.statusCode===503&&!/secret/.test(e.message));
  if(options.public)assert.equal(f.objects.size,0);
 }
});
test('invalid hash, path traversal, unsupported kind and large objects never reach storage',async()=>{
 const f=fixture(),b=Buffer.from('test'),h=digest(b);
 for(const args of [['../batch','photo',b,h],['batch','key',b,h],['batch','photo',b,'a'.repeat(64)],['batch','photo',Buffer.alloc(6*1024*1024),h]])await assert.rejects(f.archive.put(...args));
 assert.equal(f.calls.length,0);
 assert.throws(()=>createEvidenceArchive({url:'http://example.com',key:'x'}),/HTTPS/);
 assert.throws(()=>archiveFromEnvironment({HERBCHAIN_EVIDENCE_MODE:'typo'}),/Invalid/);
 assert.equal(archiveFromEnvironment({}),null);
});
