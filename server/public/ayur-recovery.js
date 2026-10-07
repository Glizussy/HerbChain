'use strict';
let token = null, config = null;
const recoveryFragment = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
(async () => {
  await Ayur.init();
  document.querySelector('.menu-toggle').onclick = e => { const open = document.querySelector('.nav-links').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(open)); };
  const message = document.getElementById('message'), form = document.getElementById('recoveryForm');
  function tell(key) { message.dataset.i18n = key; message.textContent = Ayur.t(key); }
  if (recoveryFragment.get('type') !== 'recovery' || !recoveryFragment.get('access_token') || recoveryFragment.get('error')) return tell('recoveryError');
  token = recoveryFragment.get('access_token');
  try {
    config = await fetch('/review-config').then(r => { if (!r.ok) throw Error(); return r.json(); });
    const r = await fetch(config.url + '/auth/v1/user', { headers: { apikey: config.anonKey, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error(); form.hidden = false; tell('passwordHint');
  } catch { token = null; return tell('recoveryError'); }
  form.onsubmit = async e => {
    e.preventDefault(); if (!token || !form.reportValidity()) return;
    const password = document.getElementById('newPassword'), confirm = document.getElementById('newConfirm');
    if (password.value !== confirm.value) return tell('passwordHint');
    const button = document.getElementById('savePassword'); button.disabled = true;
    try {
      const r = await fetch(config.url + '/auth/v1/user', { method: 'PUT', headers: { apikey: config.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Error(); token = null; password.value = ''; confirm.value = ''; form.hidden = true; tell('passwordSaved');
    } catch { tell('recoveryError'); }
    finally { button.disabled = false; }
  };
})().catch(() => { document.getElementById('message').textContent = 'Please open a new recovery link from your email.'; });
