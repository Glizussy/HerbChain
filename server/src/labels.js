'use strict';
function traceAddress(batchId, env=process.env) {
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(batchId))throw Error('Invalid batch ID');
  const base=new URL(env.HERBCHAIN_PUBLIC_URL || `http://127.0.0.1:${env.PORT || 3001}`);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('HERBCHAIN_PUBLIC_URL must be an HTTP(S) base URL without credentials, query or fragment');
  const url=new URL('/trace',base);url.searchParams.set('batch',batchId);
  return {url:url.href,configured:!!env.HERBCHAIN_PUBLIC_URL};
}
module.exports={traceAddress};
