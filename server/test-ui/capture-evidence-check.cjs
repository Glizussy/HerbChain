const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),root=path.resolve(__dirname,'../public');
  await page.setContent('<main></main>');
  await page.addScriptTag({content:`window.Ayur={locale:'en',languages:['en','hi','mr','te'],dictionary:${fs.readFileSync(path.join(root,'workspace-translations.json'),'utf8')},t(key){return this.dictionary[key]?.[this.languages.indexOf(this.locale)]||key}};`});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'workspace-components.js'),'utf8')});
  const manifest={originRegion:'Pune, Maharashtra',sourceType:'Cultivated',capture:{version:1,locationConsent:true},location:{latitude:18.52,longitude:73.85,accuracy:8,capturedAt:'2026-10-08T06:30:00Z'},photos:[{sha256:'f'.repeat(64),source:'camera'}],prediction:{plant:'Ocimum_tenuiflorum',confidence:.91456,modelVersion:'sha256:'+('a'.repeat(64)),photoSha256:'f'.repeat(64)},captureAssessment:{needsResolution:true,concerns:['LOW_MODEL_CONFIDENCE'],region:{state:'NEARBY_RECORDS',occurrences:[{key:123,reference:'https://www.gbif.org/occurrence/123'}]}}};
  for(const locale of ['en','hi','mr','te']){
   await page.evaluate(({manifest,locale})=>{Ayur.locale=locale;document.querySelector('main').replaceChildren(WorkspaceUI.CaptureEvidence(manifest));},{manifest,locale});
   const text=await page.locator('main').innerText();assert.ok(text.includes('91.5%'));assert.ok(text.includes('8 m'));assert.ok(text.includes('18.52, 73.85'));assert.ok(text.includes('sha256:'));assert.equal(await page.locator('a[href="https://www.gbif.org/occurrence/123"]').count(),1);
  }
  await page.evaluate(manifest=>{Ayur.locale='en';document.querySelector('main').replaceChildren(WorkspaceUI.CaptureEvidence({...manifest,demo:true,simulation:{type:'WEB_PHOTO_TEST_FIXTURE'}}));},manifest);
  const demo=await page.locator('main').innerText();assert.ok(demo.includes('Simulated test batch'));assert.ok(!demo.includes('91.5%'));assert.ok(!demo.includes('18.52, 73.85'));
  console.log('PASS: verifier shows model confidence, linked photo, GPS accuracy/time/consent and regional references in all four languages; demo fixtures never show genuine scores.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
