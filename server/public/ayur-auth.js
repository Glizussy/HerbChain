'use strict';
const $ = id => document.getElementById(id);
const roles = [['collector','⌁'],['aggregator','↗'],['verifier','✓'],['lab','♧'],['processor','☀'],['manufacturer','▣'],['distributor','→'],['regulator','◎']];
let config = null, selected = null, step = 0, busy = false;
function showMessage(id, key) { $(id).hidden = false; $(id).dataset.i18n = key; $(id).textContent = Ayur.t(key); }
async function auth(path, payload) {
  config ||= await fetch('/review-config').then(r => { if (!r.ok) throw Error(); return r.json(); });
  return fetch(config.url + '/auth/v1/' + path, { method: 'POST', headers: { apikey: config.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
}
async function signupSettings() {
  config ||= await fetch('/review-config').then(r => { if (!r.ok) throw Error(); return r.json(); });
  const response = await fetch(config.url + '/auth/v1/settings', { headers: { apikey: config.anonKey }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw { uiKey: 'authSettingsUnavailable' };
  AyurSignupPolicy.requireNoEmailConfirmation(await response.json());
}
async function enrollAccount(session, messageId) {
  showMessage(messageId, 'accountSettingUp');
  const response=await fetch('/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw {uiKey:'setupUnavailable'};
  const result=await response.json();
  if(['active','disabled'].includes(result.state))return true;
  showMessage(messageId,result.state==='rejected'?'accessRejected':'accessRequested');return false;
}
function drawCards(id, fn) {
  $(id).replaceChildren();
  for (const [role, icon] of roles) { const b = document.createElement('button'); b.className = 'role-choice'; b.type = 'button'; b.dataset.role = role; b.setAttribute('aria-pressed', String(selected === role)); const i = document.createElement('span'); i.className = 'icon'; i.textContent = icon; i.setAttribute('aria-hidden', 'true'); const content = document.createElement('span'); const name = document.createElement('strong'); name.textContent = Ayur.t(role); const hint = document.createElement('small'); hint.textContent = Ayur.t(role + 'Hint'); content.append(name, hint); b.append(i, content); b.onclick = () => fn(role); $(id).append(b); }
}
function renderStep() {
  $('roleCards').hidden = step !== 0; $('signupForm').hidden = step === 0;
  ['detailsStep','roleStep','passwordStep','confirmationStep'].forEach((id, i) => { $(id).hidden = step !== i + 1; });
  for (const id of ['fullName', 'signupEmail', 'mobile', 'organization', 'region', 'signupPassword', 'confirmPassword']) $(id).disabled = $(id).closest('[id$="Step"]').hidden;
  $('signupControls').hidden = step === 4; $('signupMessage').hidden = true;
  $('selectedRole').textContent = Ayur.t(selected || 'collector'); $('farmerNote').hidden = selected !== 'collector';
  document.querySelectorAll('.progress span').forEach((el, i) => el.classList.toggle('active', i <= step));
  $('signupNext').textContent = Ayur.t(step === 3 ? 'create' : 'next');
}
function selectRole(role) { selected = role; step = 1; renderStep(); $('fullName').focus(); }
async function login(event) {
  event.preventDefault(); if (busy || !$('loginForm').reportValidity()) return; busy = true; $('loginButton').disabled = true; $('loginMessage').hidden = true;
  try {
    const response = await auth('token?grant_type=password', { email: $('email').value.trim(), password: $('password').value }); const session = await response.json(); $('password').value = '';
    if (!response.ok || !session.access_token || !session.refresh_token) throw Error();
    if(!await enrollAccount(session,'loginMessage'))return;
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + session.access_token } });
    if (!me.ok) return showMessage('loginMessage', me.status===403?'pending':'unavailable');
    const user = await me.json();
    // One-use same-origin handoff, consumed immediately by the existing workspace.
    sessionStorage.setItem('ayur-signin', JSON.stringify({ session, createdAt: Date.now() }));
    location.assign('/dashboard');
  } catch (error) { showMessage('loginMessage', error.uiKey || 'authError'); }
  finally { busy = false; $('loginButton').disabled = false; }
}
async function recover() {
  if (busy) return; if (!$('email').reportValidity()) return;
  busy = true; $('forgot').disabled = true;
  try { const response = await auth('recover?redirect_to=' + encodeURIComponent(location.origin + '/reset-password'), { email: $('email').value.trim() }); showMessage('loginMessage', response.ok ? 'recoverySent' : 'recoveryError'); }
  catch { showMessage('loginMessage', 'recoveryError'); }
  finally { busy = false; $('forgot').disabled = false; }
}
async function signup(event) {
  event.preventDefault(); if (busy || !$('signupForm').reportValidity()) return;
  if (step < 3) { step++; renderStep(); $(step === 2 ? 'organization' : 'signupPassword').focus(); return; }
  if ($('signupPassword').value !== $('confirmPassword').value) return showMessage('signupMessage', 'passwordHint');
  busy = true; $('signupNext').disabled = true;
  try {
    // Do not trigger an email signup while the connected project requires confirmation.
    await signupSettings();
    // Preference metadata never grants membership or an enrolled signing identity.
    const response = await auth('signup', { email: $('signupEmail').value.trim(), password: $('signupPassword').value, data: { full_name: $('fullName').value.trim(), requested_role: selected, contact_mobile: $('mobile').value.trim(), organization_name: $('organization').value.trim(), region: $('region').value.trim() } });
    const result = await response.json();
    if (!response.ok) throw Error();
    AyurSignupPolicy.registrationUser(result);
    let session = AyurSignupPolicy.registrationSession(result);
    if (!session) {
      const signedIn = await auth('token?grant_type=password', { email: $('signupEmail').value.trim(), password: $('signupPassword').value });
      const candidate = await signedIn.json();
      if (signedIn.ok) session = AyurSignupPolicy.registrationSession(candidate);
    }
    $('signupPassword').value = ''; $('confirmPassword').value = ''; step = 4; renderStep();
    const key = session ? 'createdNoEmail' : 'createdSignIn';
    $('signupResult').dataset.i18n = key; $('signupResult').textContent = Ayur.t(key); $('confirmationText').dataset.i18n = 'approval'; $('confirmationText').textContent = Ayur.t('approval');
    if (session) {
      if(!await enrollAccount(session,'signupMessage'))return;
      try {const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + session.access_token } });
        if (me.ok) { sessionStorage.setItem('ayur-signin', JSON.stringify({ session, createdAt: Date.now() })); location.assign('/dashboard'); }
      } catch { $('confirmationText').dataset.i18n='pending';$('confirmationText').textContent=Ayur.t('pending'); }
    }
  } catch (error) { showMessage('signupMessage', error.uiKey || 'signupError'); }
  finally { busy = false; $('signupNext').disabled = false; }
}
(async () => {
  await Ayur.init();
  document.querySelector('.menu-toggle').onclick = e => { const open = document.querySelector('.nav-links').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(open)); };
  const mode = location.pathname.replace(/\/$/, ''); $('loginView').hidden = mode !== '/login'; $('signupView').hidden = mode !== '/signup'; $('demoView').hidden = mode !== '/demo';
  drawCards('roleCards', selectRole);
  drawCards('demoCards', role => { selected = role; $('demoPreview').hidden = false; $('demoRole').textContent = Ayur.t(role); $('demoHint').textContent = Ayur.t(role + 'Hint'); $('demoPreview').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $('loginForm').onsubmit = login; $('forgot').onclick = recover; $('showPassword').onchange = e => { $('password').type = e.target.checked ? 'text' : 'password'; };
  $('signupForm').onsubmit = signup; $('signupBack').onclick = () => { if (busy) return; step = Math.max(0, step - 1); renderStep(); };
  window.addEventListener('ayur-language', () => { drawCards('roleCards', selectRole); drawCards('demoCards', role => { selected = role; $('demoPreview').hidden = false; $('demoRole').textContent = Ayur.t(role); $('demoHint').textContent = Ayur.t(role + 'Hint'); }); if (step) renderStep(); if (!$('demoPreview').hidden) { $('demoRole').textContent = Ayur.t(selected); $('demoHint').textContent = Ayur.t(selected + 'Hint'); } });
})().catch(() => showMessage('loginMessage', 'authError'));
