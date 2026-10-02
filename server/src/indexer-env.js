'use strict';
const fs=require('node:fs');const all=JSON.parse(fs.readFileSync(process.env.FABRIC_IDENTITIES_FILE,'utf8'));const identity=all[process.env.PUBLIC_IDENTITY];
if(!identity||identity.role!=='reader')throw Error('Enrolled reader required');
require('./indexer-runner').start({identity,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,channel:process.env.FABRIC_CHANNEL||'herbchain',chaincode:process.env.FABRIC_CHAINCODE||'herbchain'}).catch(()=>{console.error('Indexer stopped. Check storage, certificates and block validation.');process.exitCode=1});
