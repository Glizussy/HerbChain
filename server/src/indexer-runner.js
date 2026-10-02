'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const grpc=require('@grpc/grpc-js');const {connect,signers,hash}=require('@hyperledger/fabric-gateway');
const {decodeBlock}=require('./block-index');const {createIndexRepository}=require('./batch-index');
async function start({identity:c,url,key,channel='herbchain',chaincode='herbchain'}){
  const repository=createIndexRepository({url,key});
  const client=new grpc.Client(c.endpoint,grpc.credentials.createSsl(fs.readFileSync(c.tlsCertificate)),{'grpc.ssl_target_name_override':c.hostOverride});
  const gateway=connect({client,identity:{mspId:c.mspId,credentials:fs.readFileSync(c.certificate)},signer:signers.newPrivateKeySigner(crypto.createPrivateKey(fs.readFileSync(c.privateKey))),hash:hash.sha256});
  const network=gateway.getNetwork(channel);let stopped=false,stream;
  const stop=()=>{stopped=true;stream?.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    while(!stopped){
      try{
        const head=await repository.head(channel);
        console.log('Indexing '+channel+' from block '+head.nextBlock);
        stream=await network.getBlockEvents({startBlock:BigInt(head.nextBlock)});
        for await(const block of stream){
          if(stopped)break;
          const update=decodeBlock(block,{channel,chaincode});
          await repository.apply(update);
          if(update.p_updates.length)console.log('Indexed block '+update.p_block+' ('+update.p_updates.length+' batch updates)');
        }
      }catch(error){
        if(stopped)break;
        if(error.message.startsWith('Invalid index block:')||error instanceof SyntaxError)throw error;
        console.error('Indexer connection or database request failed; retrying from the saved checkpoint.');
        await new Promise(resolve=>setTimeout(resolve,3000));
      }finally{stream?.close();stream=null;}
    }
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);gateway.close();client.close();}
}
module.exports={start};
