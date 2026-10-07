'use strict';
const $ = id => document.getElementById(id);
let stream = null, frame = null, scanning = false, torch = false, currentRecord = null, traceRequest = 0, cameraRequest = 0;
function message(id, key, error = false) { const el = $(id); el.hidden = false; el.dataset.i18n = key; el.textContent = Ayur.t(key); el.classList.toggle('error', error); }
function stopCamera() { cameraRequest++; scanning = false; cancelAnimationFrame(frame); stream?.getTracks().forEach(t => t.stop()); stream = null; if ($('video')) $('video').srcObject = null; if ($('flash')) $('flash').hidden = true; }
function openBatch(batch) { stopCamera(); location.assign('/trace?batch=' + encodeURIComponent(batch)); }
function decode(canvas) { const ctx = canvas.getContext('2d', { willReadFrequently: true }); const image = ctx.getImageData(0, 0, canvas.width, canvas.height); return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data; }
function checkQR(value) { const batch = AyurQR.batchFromQR(value); if (batch) openBatch(batch); return !!batch; }
async function startCamera() {
  stopCamera();
  const request = cameraRequest;
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return message('scannerMessage', 'cameraSecure', true);
  $('startCamera').disabled = true;
  try {
    const candidate = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    if (document.hidden || request !== cameraRequest) { candidate.getTracks().forEach(t => t.stop()); return; }
    stream = candidate; $('video').srcObject = stream; await $('video').play(); scanning = true; $('scannerMessage').hidden = true;
    const track = stream.getVideoTracks()[0]; $('flash').hidden = !track.getCapabilities?.().torch;
    const canvas = document.createElement('canvas'); let last = 0;
    function tick(time) {
      if (!scanning) return;
      if (time - last > 180 && $('video').videoWidth) {
        last = time; canvas.width = Math.min(900, $('video').videoWidth); canvas.height = Math.round(canvas.width * $('video').videoHeight / $('video').videoWidth);
        canvas.getContext('2d').drawImage($('video'), 0, 0, canvas.width, canvas.height);
        try { const value = decode(canvas); if (value && checkQR(value)) return; if (value) message('scannerMessage', 'qrInvalid', true); } catch { stopCamera(); message('scannerMessage', 'cameraDenied', true); return; }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  } catch { stopCamera(); message('scannerMessage', 'cameraDenied', true); }
  finally { $('startCamera').disabled = false; }
}
async function uploadQR(file) {
  stopCamera(); if (!file) return;
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) return message('scannerMessage', 'qrInvalid', true);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (!checkQR(decode(canvas))) message('scannerMessage', 'qrInvalid', true);
  } catch { message('scannerMessage', 'qrInvalid', true); }
  finally { bitmap?.close(); $('qrImage').value = ''; }
}
function node(tag, text, cls) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; }
const sample = { batchId: 'DEMO-EXAMPLE', species: 'Ocimum_tenuiflorum', productName: 'Sample Tulsi leaves', originRegion: 'Sample growing region', status: 'DELIVERED', demoStatus: 'SIMULATED', events: ['COLLECTED', 'REVIEWED', 'TRANSFER_ACCEPTED', 'PROCESSED', 'LAB_TESTED', 'PACKAGED', 'DELIVERED'].map((type, i) => ({ type, sequence: i + 1, timestampSeconds: String(1767225600 + i * 86400), ...(type === 'LAB_TESTED' ? { outcome: 'PASS' } : {}) })) };
const herbs = { Ocimum_tenuiflorum: ['Tulsi', 'तुलसी', 'तुळस', 'తులసి'], Azadirachta_indica: ['Neem', 'नीम', 'कडुनिंब', 'వేప'] };
function date(value) { const d = new Date(Number(value) * 1000); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(Ayur.locale, { day: 'numeric', month: 'short', year: 'numeric' }) : Ayur.t('notAvailable'); }
function renderRecord() {
  const p = currentRecord; if (!p) return;
  const held = ['RECALLED', 'RECALLED_SOURCE'].includes(p.status);
  const names = herbs[p.species]; $('herbName').textContent = names?.[Ayur.languages.indexOf(Ayur.locale)] || p.productName || Ayur.t('journey');
  $('species').textContent = (p.species || '').replaceAll('_', ' '); $('localName').textContent = names ? names.join(' · ') : Ayur.t('notAvailable');
  $('productName').textContent = p.productName || ''; $('recordBadge').textContent = Ayur.t('recordAvailable');
  $('herbDescription').textContent = Ayur.t('description');
  $('herbUse').textContent = Ayur.t('plantPart') + ': ' + Ayur.t('notAvailable') + ' · ' + Ayur.t('traditional') + ': ' + Ayur.t('notAvailable');
  $('demoBadge').hidden = p.demoStatus !== 'SIMULATED'; $('demoBadge').classList.add('demo-badge');
  if (held) message('traceMessage', 'recalled', true); else if (p.demoStatus === 'SIMULATED') message('traceMessage', 'demoNote'); else if (p.demoStatus === 'UNKNOWN') message('traceMessage', 'qualityNote'); else $('traceMessage').hidden = true;
  const facts = $('sourceFacts'); facts.replaceChildren();
  for (const [label, value] of [['batch', p.batchId], ['region', p.originRegion || Ayur.t('notAvailable')], ['harvestDate', p.events.find(e => e.type === 'COLLECTED') ? date(p.events.find(e => e.type === 'COLLECTED').timestampSeconds) : Ayur.t('notAvailable')]]) { const row = node('div'); row.append(node('dt', Ayur.t(label)), node('dd', value)); facts.append(row); }
  $('timeline').replaceChildren();
  for (const event of p.events) { const li = node('li'); li.append(node('strong', Ayur.dictionary[event.type] ? Ayur.t(event.type) : Ayur.t('recorded')), node('small', date(event.timestampSeconds)), node('span', Ayur.t('recorded'), 'badge')); $('timeline').append(li); }
  const tests = p.events.filter(e => e.type === 'LAB_TESTED'); $('tests').replaceChildren();
  if (!tests.length) $('tests').append(node('p', Ayur.t('notAvailable')));
  for (const test of tests) { const row = node('p'); row.append(node('span', ['PASS', 'FAIL'].includes(test.outcome) ? Ayur.t(test.outcome) : Ayur.t('recorded'), 'badge'), node('small', ' · ' + date(test.timestampSeconds))); $('tests').append(row); }
  $('technicalRecord').textContent = JSON.stringify({ batchId: p.batchId, status: p.status, demoStatus: p.demoStatus, recordedEvents: p.events.length, note: 'This public summary omits participant identities, precise locations and private evidence. Per-transaction cryptographic details are not published here.' }, null, 2);
  $('herbRecord').hidden = false;
}
async function loadRecord(batch) {
  const request = ++traceRequest; currentRecord = null; $('herbRecord').hidden = true; message('traceMessage', 'loading');
  try {
    const r = await fetch('/public/batches/' + encodeURIComponent(batch), { cache: 'no-store' }); if (!r.ok) throw Error();
    const p = await r.json(); if (!p.batchId || !Array.isArray(p.events)) throw Error();
    if (request !== traceRequest) return; currentRecord = p; renderRecord();
  } catch { if (request === traceRequest) message('traceMessage', 'unavailable', true); }
}
window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('ayur-language', renderRecord);
(async () => {
  await Ayur.init(); document.querySelector('.menu-toggle').onclick = e => { const open = document.querySelector('.nav-links').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(open)); };
  if ($('startCamera')) {
    $('startCamera').onclick = startCamera; $('qrImage').onchange = e => uploadQR(e.target.files[0]);
    $('flash').onclick = async () => { try { torch = !torch; await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch }] }); $('flash').setAttribute('aria-pressed', String(torch)); } catch { message('scannerMessage', 'cameraDenied', true); } };
  }
  if ($('batchForm')) $('batchForm').onsubmit = e => { e.preventDefault(); if (!$('batchForm').reportValidity()) return; const batch = $('batch').value.trim(); if ($('traceMessage')) { history.replaceState(null, '', '/trace?batch=' + encodeURIComponent(batch)); loadRecord(batch); } else openBatch(batch); };
  if ($('traceMessage')) { const params = new URLSearchParams(location.search); if (params.get('demo') === '1') { currentRecord = sample; renderRecord(); } else if (params.get('batch') && /^[A-Za-z0-9_-]{1,80}$/.test(params.get('batch'))) { $('batch').value = params.get('batch'); await loadRecord(params.get('batch')); } }
})().catch(() => { const el = $('traceMessage') || $('scannerMessage'); if (el) { el.hidden = false; el.textContent = 'This page could not load. Please refresh and try again.'; } });
