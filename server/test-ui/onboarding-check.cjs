const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const publicRoot=path.resolve(__dirname,'../public');
(async()=>{
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://local').pathname;if(pathname==='/review-config'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({url:'https://auth.example.test',anonKey:'fixture'}));}const file=path.join(publicRoot,pathname==='/login'?'auth.html':pathname==='/participants'?'participants.html':pathname.slice(1));try{res.setHeader('Content-Type',({'.js':'application/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
 try{
  for(const mode of ['farmer','staff','failure']){const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let setupCalls=0;
   await page.route('**/api/auth/**',r=>r.request().method()==='OPTIONS'?r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':root,'Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST'}}):r.fulfill({headers:{'Access-Control-Allow-Origin':root},json:{access_token:'fixture',refresh_token:'fixture'}}));
   await page.route('**/api/onboarding',r=>{setupCalls++;assert.equal(r.request().headers().authorization,'Bearer fixture');assert.equal(r.request().postData(),null);return r.fulfill({status:mode==='failure'?503:200,json:{state:mode==='staff'?'pending':'active',error:'private server detail'}});});
   await page.route('**/api/me',r=>r.fulfill({json:{role:'collector'}}));await page.route('**/dashboard',r=>r.fulfill({body:'Farmer workspace'}));
   await page.goto(root+'/login');await page.locator('#email').fill('fixture@example.test');await page.locator('#password').fill('fixture-password');await page.locator('#loginButton').click();
   if(mode==='farmer')await page.waitForURL('**/dashboard');else{await page.waitForFunction(()=>document.querySelector('#loginMessage').textContent.includes('request')||document.querySelector('#loginMessage').textContent.includes('could not finish'));assert.ok(!(await page.locator('#loginMessage').innerText()).includes('private server detail'));}
   assert.equal(setupCalls,1);assert.deepEqual(errors,[]);console.log('PASS automatic login '+mode);await page.close();
  }
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let approved=false;const uid='881ca81b-334b-4a50-8c39-5d5a32cd3cd5';
  await page.addInitScript(()=>sessionStorage.setItem('ayur-signin',JSON.stringify({session:{access_token:'fixture'},createdAt:Date.now()})));
  await page.route('**/api/admin/onboarding',r=>r.fulfill({json:{requests:[{userId:uid,name:'Test laboratory',email:'lab@example.test',role:'lab',state:approved?'active':'pending'}]}}));
  await page.route('**/api/admin/onboarding/*/approve',r=>{approved=true;return r.fulfill({json:{state:'active'}});});page.on('dialog',d=>d.accept());
  await page.goto(root+'/participants');await page.getByRole('button',{name:'Approve access',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('is ready'));assert.equal(approved,true);assert.ok(!(await page.locator('#requests').innerText()).includes(uid));assert.equal(await page.getByRole('button',{name:'Approve access',exact:true}).count(),0);
  for(const lang of ['hi','mr','te']){await page.locator('[data-language]').selectOption(lang);assert.equal(await page.locator('html').getAttribute('lang'),lang);assert.ok(!(await page.locator('h1').innerText()).includes('manageParticipants'));}assert.deepEqual(errors,[]);console.log('PASS administrator approval and translations');await page.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
