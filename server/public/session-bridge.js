// Same-origin, memory-only session handoff to embedded existing forms.
(() => {
  if(window.parent===window)return;
  const style=document.createElement('style');style.textContent='h1,h2,h3{overflow-wrap:anywhere} main{margin:12px auto}';document.head.append(style);
  const resize=()=>window.parent.postMessage({type:'herbchain-height',height:document.body.getBoundingClientRect().height+40},location.origin);
  new ResizeObserver(resize).observe(document.body);
  let account=null;
  window.addEventListener('message',async event=>{
    if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='herbchain-session')return;
    const s=event.data.session;if(!s?.access_token||!s.user?.id)return;
    if(account===s.user.id){window.refreshDashboardToken?.(s.access_token);return;}
    account=s.user.id;
    try{await window.acceptDashboardSession(s);}catch(error){const m=document.getElementById('message');if(m)m.textContent=error.message;}
  });
  window.parent.postMessage({type:'herbchain-ready'},location.origin);
})();
