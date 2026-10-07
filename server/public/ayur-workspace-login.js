// One-use same-origin handoff. The existing workspace then holds tokens in memory.
(async () => {
  let raw; try { raw = sessionStorage.getItem('ayur-signin'); sessionStorage.removeItem('ayur-signin'); } catch { return; }
  if (!raw) return;
  try {
    const incoming = JSON.parse(raw);
    if (!incoming.session?.access_token || !incoming.session?.refresh_token || !incoming.session?.user?.id || Date.now() - incoming.createdAt > 60000 || incoming.createdAt > Date.now()) return;
    config = await fetch('/review-config').then(r => r.json()); session = incoming.session; viewEpoch++; scheduleRefresh();
    $('loginSection').hidden = true; $('workspace').hidden = false;
    await refresh(); if (['collector','aggregator','processor','manufacturer','distributor'].includes(data.role)) { await restoreBulk(); render(); }
  } catch { logout('Your workspace could not open. Please sign in again or contact your organization.'); }
})();
