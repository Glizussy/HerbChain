'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { traceAddress } = require('./labels');
const archive = require('./evidence-archive').archiveFromEnvironment();
const cloudEvidence = require('./cloud-evidence').cloudReaderFromEnvironment(archive);
const { contractFor, participantFor, custodyActor, custodyDirectory, lifecycleActor, dashboardActor, close, withParticipant, prepareDirectory } = require('./gateway');
const onboarding=require('./onboarding-runtime').onboardingFromEnvironment(require('./gateway'));
const { createDashboardService } = require('./dashboard');
const {createIndexRepository,createIndexedDashboard}=require('./batch-index');
const listMode=process.env.HERBCHAIN_BATCH_LIST_MODE||'local';
if(!['local','indexed'].includes(listMode))throw Error('Invalid HERBCHAIN_BATCH_LIST_MODE');
if(listMode==='indexed'&&process.env.HERBCHAIN_MEMBERSHIP_MODE!=='supabase')throw Error('Indexed lists require Supabase membership mode');
const indexedDashboard=listMode==='indexed'?createIndexedDashboard({actorFor:dashboardActor,channel:process.env.FABRIC_CHANNEL||'herbchain',repository:createIndexRepository({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY})}):null;

const dashboard = process.env.HERBCHAIN_DATA_DIR ? createDashboardService({ cloudEvidence, directory: path.resolve(process.env.HERBCHAIN_DATA_DIR), contractFor, actorFor: dashboardActor }) : null;
const { createLifecycleService } = require('./lifecycle');
const lifecycle = process.env.HERBCHAIN_DATA_DIR ? createLifecycleService({ archive, directory: path.resolve(process.env.HERBCHAIN_DATA_DIR), contractFor, actorFor: lifecycleActor }) : null;
const { createTransferService } = require('./transfers');
const transfers = process.env.HERBCHAIN_DATA_DIR ? createTransferService({ directory: path.resolve(process.env.HERBCHAIN_DATA_DIR), contractFor, actorFor: custodyActor, directoryFor: custodyDirectory }) : null;
const { createHarvestService } = require('./harvests');
const { createReviewService } = require('./reviews');
const reviews = process.env.HERBCHAIN_DATA_DIR ? createReviewService({ cloudEvidence, archive, directory: path.resolve(process.env.HERBCHAIN_DATA_DIR), contractFor, participantFor }) : null;
const harvests = process.env.HERBCHAIN_DATA_DIR ? createHarvestService({ archive, directory: path.resolve(process.env.HERBCHAIN_DATA_DIR), contractFor }) : null;
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PUBLIC_IDENTITY']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const writeMode=process.env.HERBCHAIN_WRITE_MODE||'local';
if(!['local','queued'].includes(writeMode))throw Error('Invalid write mode');
if(writeMode==='queued'&&(!archive||!cloudEvidence||listMode!=='indexed'||process.env.HERBCHAIN_MEMBERSHIP_MODE!=='supabase'))throw Error('Queued mode requires memberships, indexed lists, archive writes and cloud reads');
const jobRepository=writeMode==='queued'?require('./transaction-queue').createTransactionQueue({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY}):null;
const queuedActions=jobRepository?require('./queued-actions').createQueuedActions({repository:jobRepository,archive,cloudEvidence,contractFor,actorFor:dashboardActor,prepareDirectory,directoryFor:custodyDirectory}):null;
const bulkTransfers=queuedActions?require('./bulk-transfers').createBulkTransfers(queuedActions):null;
const lotsEnabled=process.env.HERBCHAIN_LOTS_ENABLED==='true';
if(lotsEnabled&&!queuedActions)throw Error('Lot operations require queued writes');
const lotActions=lotsEnabled?require('./lot-actions').createLotActions({repository:jobRepository,archive,actions:queuedActions,actorFor:dashboardActor}):null;
const operations = { CreateBatch: 1, ReviewBatch: 3, ProposeTransfer: 3, AcceptTransfer: 1,
  CancelTransfer: 1, RecordLabResult: 3, RecordProcessing: 4, PackageBatch: 3, RecordDelivery: 2, RecallBatch: 2 };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function authenticate(req) {
  if (!/^Bearer [^\s]+$/.test(req.headers.authorization || '')) throw new Error('Sign in required');
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: req.headers.authorization, apikey: process.env.SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Invalid or expired session');
  const user = await response.json();
  if (!user.id || user.id === process.env.PUBLIC_IDENTITY) throw new Error('Invalid user');
  req.authenticatedUser=user;
  return user.id;
}
async function body(req, limit = 32768) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = http.createServer(async (req, res) => {
  let transactionId;
  try {
    const url = new URL(req.url, 'http://localhost');
    const workspaceFiles={'/participants':'participants.html','/participants.js':'participants.js','/dashboard':'role-workspace.html','/review':'role-workspace.html','/custody':'role-workspace.html','/operations':'role-workspace.html','/activity':'role-workspace.html','/lots':'role-workspace.html','/role-workspace.css':'role-workspace.css','/role-workspace.js':'role-workspace.js','/workspace-components.js':'workspace-components.js','/workspace-store.js':'workspace-store.js','/workspace-translations.json':'workspace-translations.json'};
    if(req.method==='GET'&&Object.hasOwn(workspaceFiles,url.pathname)){const file=workspaceFiles[url.pathname];const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN'});return res.end(fs.readFileSync(path.join(__dirname,'../public',file)));}
    if(req.method==='GET'&&['/workspace-config','/app-qr.svg'].includes(url.pathname)){
      function link(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
      const settings={downloadUrl:link(process.env.HERBCHAIN_APP_DOWNLOAD_URL),appUrl:link(process.env.HERBCHAIN_APP_OPEN_URL)};
      if(url.pathname==='/workspace-config')return json(res,200,settings);
      if(!settings.appUrl)return json(res,404,{error:'App link unavailable'});
      const svg=await require('qrcode').toString(settings.appUrl,{type:'svg',errorCorrectionLevel:'M',margin:4});res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(svg);
    }
    const publicPages = { '/':'landing.html', '/scan':'scan.html', '/trace':'index.html', '/login':'auth.html', '/signup':'auth.html', '/demo':'auth.html', '/ayur.css':'ayur.css', '/ayur-i18n.js':'ayur-i18n.js', '/ayur-translations.json':'ayur-translations.json', '/ayur-public.js':'ayur-public.js', '/ayur-auth.js':'ayur-auth.js', '/ayur-signup-policy.js':'ayur-signup-policy.js', '/ayur-qr.js':'ayur-qr.js', '/herb-illustration.svg':'herb-illustration.svg', '/vendor/jsQR.js':'vendor/jsQR.js' };
    if (req.method === 'GET' && Object.hasOwn(publicPages, url.pathname)) {
      const file = publicPages[url.pathname];
      const mime = {'.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.svg':'image/svg+xml'}[path.extname(file)];
      res.writeHead(200, {'Content-Type':mime+'; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Permissions-Policy':'camera=(self)', 'X-Frame-Options':'SAMEORIGIN'});
      return res.end(fs.readFileSync(path.join(__dirname, '../public', file)));
    }
    if (req.method === 'GET' && ['/dashboard','/dashboard.js','/ayur-workspace-login.js','/ayur-recovery.js','/batch-language.js','/workspace.css','/session-bridge.js','/labels'].includes(url.pathname)) {
      const file = { '/workspace.css':'workspace.css', '/batch-language.js':'batch-language.js', '/dashboard':'dashboard.html', '/dashboard.js':'dashboard.js', '/ayur-workspace-login.js':'ayur-workspace-login.js', '/ayur-recovery.js':'ayur-recovery.js', '/session-bridge.js':'session-bridge.js', '/labels':'labels.html' }[url.pathname];
      res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'SAMEORIGIN' });
      return res.end(fs.readFileSync(path.join(__dirname,'../public',file)));
    }
    if (req.method === 'GET' && url.pathname === '/operations') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.end(fs.readFileSync(path.join(__dirname, '../public/operations.html')));
    }
    if(req.method==='GET'&&['/activity','/lots'].includes(url.pathname)){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end(fs.readFileSync(path.join(__dirname,url.pathname==='/lots'?'../public/lots.html':'../public/activity.html')));
    }
    if (req.method === 'GET' && url.pathname === '/reset-password') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.end(fs.readFileSync(path.join(__dirname, '../public/reset-password.html')));
    }
    if (req.method === 'GET' && url.pathname === '/custody') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.end(fs.readFileSync(path.join(__dirname, '../public/custody.html')));
    }
    if (req.method === 'GET' && url.pathname === '/review') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      return res.end(fs.readFileSync(path.join(__dirname, '../public/review.html')));
    }
    if (req.method === 'GET' && url.pathname === '/review-config') return json(res, 200, { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY });
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { api: 'ready', fabric: 'not checked' });
    const publicMatch = url.pathname.match(/^\/public\/batches\/([A-Za-z0-9_-]{1,80})(\/qr\.svg)?$/);
    if (req.method === 'GET' && publicMatch) {
      const bytes = await contractFor(process.env.PUBLIC_IDENTITY).evaluateTransaction('GetProvenance', publicMatch[1]);
      const { batch, events } = JSON.parse(Buffer.from(bytes).toString());
      // Explicit allowlist: no identities, GPS, hashes, report URLs or free-text notes.
      if (!events.some(e => e.type === 'PACKAGED')) return json(res, 404, { error: 'No published product' });
      const lineage=lotsEnabled?JSON.parse(Buffer.from(await contractFor(process.env.PUBLIC_IDENTITY).evaluateTransaction('GetLineage',batch.batchId)).toString()):null;
      const traceUrl = traceAddress(batch.batchId);
      if (publicMatch[2]) {
        const svg = await require('qrcode').toString(traceUrl.url,{ type:'svg', errorCorrectionLevel:'M', margin:4 });
        res.writeHead(200, { 'Content-Type':'image/svg+xml', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); return res.end(svg);
      }
      return json(res, 200, { batchId: batch.batchId, species: batch.species, originRegion: batch.originRegion,
        productName: batch.productName, status: lineage?.blockedBy.length?'RECALLED_SOURCE':batch.status, quantityGrams:batch.quantityGrams,
        traceUrl:traceUrl.url, publicUrlConfigured:traceUrl.configured, demoStatus:dashboard ? await dashboard.publicDemo({batch,events}) : 'UNKNOWN',
        events: events.map(e => ({ type: e.type, sequence: e.sequence, timestampSeconds: e.timestampSeconds,
          outcome: e.type === 'LAB_TESTED' ? e.details.outcome : undefined })) });
    }
    const uid = await authenticate(req);
    if(req.method==='POST'&&url.pathname==='/api/onboarding'){
      if(!onboarding)return json(res,200,{state:'disabled'});
      // A verified session supplies the UID and requested role. The browser cannot nominate another account.
      return json(res,200,await onboarding.request(req.authenticatedUser));
    }
    if(url.pathname==='/api/admin/onboarding'||/^\/api\/admin\/onboarding\/[a-f0-9-]{36}\/(approve|reject)$/.test(url.pathname)){
      if(!onboarding)return json(res,503,{error:'Participant onboarding is not enabled'});
      return await withParticipant(uid,async()=>{
        if(req.method==='GET'&&url.pathname==='/api/admin/onboarding')return json(res,200,{requests:await onboarding.list(uid)});
        const match=url.pathname.match(/^\/api\/admin\/onboarding\/([a-f0-9-]{36})\/(approve|reject)$/);
        if(req.method==='POST'&&match)return json(res,200,await onboarding.decide(uid,match[1],match[2]));
        return json(res,404,{error:'Route not found'});
      });
    }
    return await withParticipant(uid, async () => {
    const passportMatch=url.pathname.match(/^\/api\/passports\/([A-Za-z0-9_-]{1,80})$/);
    if(req.method==='GET'&&passportMatch){dashboardActor(uid);if(!dashboard)return json(res,503,{error:'Batch storage is unavailable'});return json(res,200,await dashboard.passport(uid,passportMatch[1]));}
    if(req.method==='POST'&&url.pathname==='/api/bulk-transfers'){
      if(!bulkTransfers)return json(res,503,{error:'Background processing is not enabled'});custodyActor(uid);
      return json(res,200,await bulkTransfers.submit(uid,await body(req)));
    }
    const lotMatch=url.pathname.match(/^\/api\/lots\/([A-Za-z0-9_-]{1,80})$/);
    if(lotMatch){if(!lotActions)return json(res,503,{error:'Lot operations are not enabled'});
      await dashboard.provenance(uid,lotMatch[1]);
      if(req.method==='GET')return json(res,200,JSON.parse(Buffer.from(await contractFor(uid).evaluateTransaction('GetLineage',lotMatch[1])).toString()));
      if(req.method==='POST'){const result=await lotActions.submit(uid,lotMatch[1],await body(req));return json(res,result.committed?200:202,result);}
    }
    const jobRetry=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/retry$/);
    if(req.method==='POST'&&jobRetry&&jobRepository){const ok=await jobRepository.retry(uid,jobRetry[1]);return json(res,ok?200:409,{queued:ok,error:ok?undefined:'Only your rejected requests can be retried. Waiting or uncertain requests cannot be reset.'});}
    if(req.method==='GET'&&url.pathname==='/api/jobs'){
      if(!jobRepository)return json(res,200,{jobs:[],enabled:false});
      const jobs=await jobRepository.list(uid);
      return json(res,200,{enabled:true,jobs:jobs.map(j=>({id:j.id,batchId:j.batch_id,operation:j.operation,state:j.state,transactionId:j.transaction_id,createdAt:j.created_at,result:j.result}))});
    }
    if (url.pathname.startsWith('/api/dashboard')) {
      dashboardActor(uid);
      if (!dashboard) return json(res,503,{error:'Dashboard storage is not configured'});
      if (req.method==='GET' && url.pathname==='/api/dashboard') return json(res,200,{...await (indexedDashboard?indexedDashboard.list(uid,url.searchParams):dashboard.list(uid)),features:{queued:!!queuedActions,lots:lotsEnabled&&['aggregator','processor','manufacturer'].includes(dashboardActor(uid).role)}});
      const m=url.pathname.match(/^\/api\/dashboard\/([A-Za-z0-9_-]{1,80})(?:\/reports\/([a-f0-9]{64}))?$/);
      if (m && req.method==='GET' && m[2]) { const bytes=await dashboard.report(uid,m[1],m[2]); res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="report.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); return res.end(bytes); }
      if (m && req.method==='GET') return json(res,200,await dashboard.evidence(uid,m[1]));
      return json(res,404,{error:'Dashboard route not found'});
    }
    if (url.pathname.startsWith('/api/lifecycle')) {
      lifecycleActor(uid);
      if (!lifecycle) return json(res, 503, { error: 'Lifecycle evidence storage is not configured' });
      const m = url.pathname.match(/^\/api\/lifecycle\/([A-Za-z0-9_-]{1,80})$/);
      if (m && req.method === 'GET') return json(res, 200, await lifecycle.detail(uid, m[1]));
      if (m && req.method === 'POST') { const r = await (queuedActions?queuedActions.submit(uid,'OPERATION',m[1],await body(req,8*1024*1024)):lifecycle.submit(uid,m[1],await body(req,8*1024*1024))); return json(res, r.committed ? 200 : 202, r); }
      return json(res, 404, { error: 'Lifecycle route not found' });
    }
    if (url.pathname.startsWith('/api/custody')) {
      custodyActor(uid);
      if (!transfers) return json(res, 503, { error: 'Custody storage is not configured' });
      if (req.method === 'GET' && url.pathname === '/api/custody/participants') { await prepareDirectory(); return json(res, 200, { participants: custodyDirectory(uid) }); }
      if (req.method === 'GET' && url.pathname === '/api/custody') {if(queuedActions){const page=await indexedDashboard.list(uid,new URLSearchParams({filter:'tasks',limit:'50'}));return json(res,200,{...page,batches:page.batches.map(b=>({...b,actions:{propose:b.inCustody&&!b.outgoing,cancel:b.outgoing,accept:b.incoming}})),scope:'First 50 tasks. Use the dashboard to search or load more.'});}return json(res,200,await transfers.queue(uid));}
      const m = url.pathname.match(/^\/api\/custody\/([A-Za-z0-9_-]{1,80})$/);
      if (m && req.method === 'GET') return json(res, 200, await transfers.detail(uid, m[1]));
      if (m && req.method === 'POST') { await prepareDirectory(); const r = await (queuedActions?queuedActions.submit(uid,'TRANSFER',m[1],await body(req)):transfers.submit(uid,m[1],await body(req))); return json(res, r.committed ? 200 : 202, r); }
      return json(res, 404, { error: 'Custody route not found' });
    }
    if (url.pathname.startsWith('/api/reviews')) {
      if (participantFor(uid).role !== 'verifier') return json(res, 403, { error: 'Verifier account required' });
      if (!reviews) return json(res, 503, { error: 'Review evidence storage is not configured' });
      if (req.method === 'GET' && url.pathname === '/api/reviews') {if(queuedActions){const page=await indexedDashboard.list(uid,new URLSearchParams({filter:'tasks',limit:'50'}));return json(res,200,{...page,scope:'First 50 assigned tasks. Use the dashboard to search or load more.'});}return json(res,200,await reviews.queue(uid));}
      const reviewMatch = url.pathname.match(/^\/api\/reviews\/(HC-[a-f0-9]{40})$/);
      if (reviewMatch && req.method === 'GET') return json(res, 200, await reviews.evidence(uid, reviewMatch[1]));
      if (reviewMatch && req.method === 'POST') {
        const result = await (queuedActions?queuedActions.submit(uid,'REVIEW',reviewMatch[1],await body(req)):reviews.submit(uid,reviewMatch[1],await body(req)));
        return json(res, result.committed ? 200 : 202, result);
      }
      return json(res, 404, { error: 'Review route not found' });
    }
    if (req.method === 'GET' && url.pathname === '/api/me') { const p=participantFor(uid); return json(res, 200, {uid,role:p.role,organizationId:p.organizationId,canManageParticipants:!!onboarding?.isAdmin(uid)}); }
    if (req.method === 'POST' && url.pathname === '/api/harvests') {
      if (!harvests) return json(res, 503, { error: 'Harvest storage is not configured on this server' });
      if (participantFor(uid).role !== 'collector') return json(res, 403, { error: 'An enrolled collector account is required' });
      const result = await (queuedActions?queuedActions.submit(uid,'HARVEST',null,await body(req,22*1024*1024)):harvests.submit(uid,await body(req,22*1024*1024)));
      return json(res, result.committed ? 200 : 202, result);
    }
    const contract = contractFor(uid);
    const match = url.pathname.match(/^\/api\/batches\/([A-Za-z0-9_-]{1,80})$/);
    if (req.method === 'GET' && match) {
      if (!dashboard) return json(res,503,{error:'Batch access service is not configured'});
      return json(res, 200, await dashboard.provenance(uid,match[1]));
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions') {
      const p = await body(req);
      if (['RecordLabResult','RecordProcessing','PackageBatch','RecordDelivery','RecallBatch'].includes(p.operation)) return json(res, 400, { error: 'Use /api/lifecycle/:id to save evidence and track the request' });
      if (p.operation === 'CreateBatch') return json(res, 400, { error: 'Use /api/harvests to register a batch with uploaded evidence' });
      if (p.operation === 'ReviewBatch') return json(res, 400, { error: 'Use /api/reviews/:id to save and verify review evidence' });
      if (['ProposeTransfer','AcceptTransfer','CancelTransfer'].includes(p.operation)) return json(res, 400, { error: 'Use /api/custody/:id for tracked handoff requests' });
      if (!Object.hasOwn(operations, p.operation) || !Array.isArray(p.args) || p.args.length !== operations[p.operation] || !p.args.every(a => typeof a === 'string')) {
        return json(res, 400, { error: 'Invalid operation or arguments' });
      }
      const proposal = contract.newProposal(p.operation, { arguments: p.args });
      transactionId = proposal.getTransactionId();
      const endorsed = await proposal.endorse();
      const submitted = await endorsed.submit();
      const status = await submitted.getStatus();
      if (!status.successful) return json(res, 409, { error: 'Fabric transaction invalid', transactionId, code: status.code });
      return json(res, 200, { transactionId, committed: true, batch: JSON.parse(Buffer.from(endorsed.getResult()).toString()) });
    }
    return json(res, 404, { error: 'Route not found' });
    }, {loadAssignments:!(indexedDashboard && req.method==='GET' && url.pathname==='/api/dashboard')});
  } catch (error) {
    // A failure after submission can mean an unknown commit result; do not claim rollback.
    json(res, transactionId ? 503 : (error.statusCode || 400), { error: error.message, transactionId,
      ...(transactionId ? { committed: 'unknown; query batch provenance before retrying' } : {}) });
  }
});
server.requestTimeout = 90000;
server.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1');
process.on('SIGINT', () => server.close(() => { close(); process.exit(0); }));
