'use strict';
const crypto=require('node:crypto');
const {common,peer,ledger}=require('@hyperledger/fabric-protos');
function check(value,message){if(!value)throw Error('Invalid index block: '+message);}
function decodeBlock(block,{channel,chaincode}){
  const header=block.getHeader();check(header&&block.getData(),'missing header/data');
  check(Number.isSafeInteger(header.getNumber())&&header.getNumber()>=0,'block number exceeds SDK precision');
  const number=String(header.getNumber());
  const updates=[],transactions=block.getData()?.getDataList_asU8()||[];
  const flags=block.getMetadata()?.getMetadataList_asU8()[common.BlockMetadataIndex.TRANSACTIONS_FILTER];
  for(let index=0;index<transactions.length;index++){
    const envelope=common.Envelope.deserializeBinary(transactions[index]);
    const payload=common.Payload.deserializeBinary(envelope.getPayload_asU8());
    const ch=common.ChannelHeader.deserializeBinary(payload.getHeader().getChannelHeader_asU8());
    check(ch.getChannelId()===channel,'wrong channel');
    if(ch.getType()!==common.HeaderType.ENDORSER_TRANSACTION)continue;
    check(flags && flags.length===transactions.length,'missing transaction validation flags');
    if(flags[index]!==peer.TxValidationCode.VALID)continue;
    const tx=peer.Transaction.deserializeBinary(payload.getData_asU8());
    for(const action of tx.getActionsList()){
      const cap=peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8());
      const proposal=peer.ProposalResponsePayload.deserializeBinary(cap.getAction().getProposalResponsePayload_asU8());
      const result=peer.ChaincodeAction.deserializeBinary(proposal.getExtension_asU8());
      const rw=ledger.rwset.TxReadWriteSet.deserializeBinary(result.getResults_asU8());
      for(const ns of rw.getNsRwsetList()){
        if(ns.getNamespace()!==chaincode)continue;
        const states=new Map(),events=new Map();
        for(const write of ledger.rwset.kvrwset.KVRWSet.deserializeBinary(ns.getRwset_asU8()).getWritesList()){
          const key=write.getKey();if(!key.startsWith('batch:')&&!key.startsWith('event:'))continue;
          check(!write.getIsDelete(),'batch/event deletion needs an index migration');
          const value=JSON.parse(Buffer.from(write.getValue_asU8()).toString());
          check(/^[A-Za-z0-9_-]{1,80}$/.test(value.batchId),'batch ID');
          check(Number.isSafeInteger(value.sequence)&&value.sequence>0,'event sequence');
          if(key.startsWith('batch:')){check(key==='batch:'+value.batchId&&!states.has(value.batchId),'batch key');states.set(value.batchId,value);}
          else{check(key==='event:'+value.batchId+':'+String(value.sequence).padStart(6,'0')&&!events.has(value.batchId),'event key');events.set(value.batchId,value);}
        }
        check(states.size===events.size,'unpaired state/event writes');
        for(const [id,state] of states){
          const event=events.get(id);check(event&&event.sequence===state.sequence&&event.transactionId===ch.getTxId(),'event does not match transaction');
          check(event.actor?.identity&&event.actor?.msp&&typeof state.species==='string'&&typeof state.originRegion==='string','required fields');
          check(Number.isSafeInteger(state.quantityGrams)&&(state.quantityGrams>0||state.quantityGrams===0&&['CONSUMED','RECALLED'].includes(state.status)),'quantity');
          updates.push({state,event});
        }
      }
    }
  }
  // Hash immutable header/data, not peer-specific block metadata/signatures.
  const digest=crypto.createHash('sha256').update(header.serializeBinary()).update(block.getData().serializeBinary()).update(flags||new Uint8Array()).digest('hex');
  return {p_channel:channel,p_block:number,p_digest:digest,p_updates:updates};
}
module.exports={decodeBlock};
