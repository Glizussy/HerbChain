/* Account-scoped drafts and immutable pending requests. Never stores auth tokens. */
window.WorkspaceStore = (() => {
  let database;
  function db() { return database ||= new Promise((resolve,reject)=>{const r=indexedDB.open('ayurraksha-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('storage'));}); }
  async function operate(uid,name,action,value) {
    if(!uid||!name)throw Error('storage');const d=await db();return new Promise((resolve,reject)=>{
      const tx=d.transaction('records',action==='get'?'readonly':'readwrite'),store=tx.objectStore('records'),key=uid+':'+name;
      const r=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put({key,uid,name,value,updatedAt:Date.now()});let result;
      r.onsuccess=()=>result=action==='get'?r.result?.value:null;r.onerror=()=>reject(Error('storage'));tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(Error('storage'));tx.onabort=()=>reject(Error('storage'));
    });
  }
  return {get:(u,n)=>operate(u,n,'get'),set:(u,n,v)=>operate(u,n,'set',v),remove:(u,n)=>operate(u,n,'delete')};
})();
