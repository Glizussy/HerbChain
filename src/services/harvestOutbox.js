// Storage adapter is injected so restart and interruption behavior can be tested
// without native code. This directory stays inside the app's private documents.
function createHarvestOutbox(storage, documentDirectory) {
  function folder(uid) { if(!documentDirectory)throw Error('Persistent harvest storage is unavailable on this device');if(!/^[A-Za-z0-9_-]{1,80}$/.test(uid))throw Error('Invalid account ID');return documentDirectory+'herbchain-outbox/'+uid+'/'; }
  function file(uid,id) { if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw Error('Invalid submission ID');return folder(uid)+id+'.json'; }
  async function read(uid,id) {const target=file(uid,id);if(!(await storage.getInfoAsync(target)).exists)return null;const saved=JSON.parse(await storage.readAsStringAsync(target));if(saved.uid!==uid||saved.payload?.batchId!==id)throw Error('Saved harvest belongs to another account or submission');return saved;}
  async function save(uid,payload) {const target=file(uid,payload.batchId),existing=await read(uid,payload.batchId);if(existing)return existing;await storage.makeDirectoryAsync(folder(uid),{intermediates:true});const saved={uid,createdAt:new Date().toISOString(),payload};await storage.writeAsStringAsync(target+'.tmp',JSON.stringify(saved));await storage.moveAsync({from:target+'.tmp',to:target});return saved;}
  async function list(uid) {const dir=folder(uid);if(!(await storage.getInfoAsync(dir)).exists)return {entries:[],warnings:[]};const entries=[],warnings=[];for(const name of await storage.readDirectoryAsync(dir)){if(!/^[A-Za-z0-9_-]{1,80}\.json$/.test(name))continue;try{const saved=await read(uid,name.slice(0,-5));if(saved)entries.push({clientId:saved.payload.batchId,species:saved.payload.herbName,createdAt:saved.createdAt});}catch{warnings.push('A saved upload could not be read. Keep app data intact for recovery.');}}return {entries,warnings};}
  async function remove(uid,id) {await storage.deleteAsync(file(uid,id),{idempotent:true});}
  return {read,save,list,remove};
}
module.exports={createHarvestOutbox};
