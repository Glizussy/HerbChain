(function(root){
  'use strict';
  const statuses={CONSUMED:'Used to create new lots',RECALLED_SOURCE:'Source recalled — stop use',PENDING_REVIEW:'Waiting for review',VERIFIED:'Review approved',PROCESSED:'Processing recorded',PACKAGED:'Packed',DELIVERED:'Delivered',REJECTED:'Review rejected',RECALLED:'Recalled — stop use'};
  const roles={collector:'Farmer',aggregator:'Aggregator',verifier:'Reviewer',lab:'Laboratory',processor:'Processor',manufacturer:'Manufacturer',distributor:'Distributor',regulator:'Regulator'};
  const events={SPLIT:'Lot divided',MERGED:'Lots combined',DERIVED:'New lot created',COLLECTED:'Harvest recorded',REVIEWED:'Review recorded',TRANSFER_PROPOSED:'Transfer requested',TRANSFER_ACCEPTED:'Batch received',TRANSFER_CANCELLED:'Transfer cancelled',LAB_TESTED:'Lab result recorded',PROCESSED:'Processing recorded',PACKAGED:'Batch packed',DELIVERED:'Delivery recorded',RECALLED:'Batch recalled'};
  const pretty=s=>String(s||'').replaceAll('_',' ');
  function next(batch){
    if(batch.status==='CONSUMED')return 'This source was used to create new lots. View related lots for their next steps.';
    if(['RECALLED','RECALLED_SOURCE'].includes(batch.status))return 'Stop movement and use of this batch. Follow the recall instructions.';
    if(batch.status==='REJECTED')return 'This batch cannot move forward. Read the review details.';
    if(batch.status==='DELIVERED')return 'Delivery is recorded. You can view the batch history.';
    if(batch.incoming)return 'Check the received herbs and quantity, then confirm receipt.';
    if(batch.outgoing)return 'Waiting for the receiving participant to confirm receipt.';
    if(batch.status==='PENDING_REVIEW')return 'An independent reviewer needs to check this harvest before it can move forward.';
    if(batch.actions?.some(a=>a.page==='operations'))return 'Open batch tasks to see the next permitted step.';
    if(batch.actions?.some(a=>a.page==='custody'))return 'Choose the next participant when this batch is ready to leave.';
    return 'No action is needed from you now. You can follow the batch history.';
  }
  function action(a,b){return a.page==='custody'?(b.incoming?'Receive batch':b.outgoing?'View pending transfer':'Send batch'):a.page==='review'?'Review harvest':'Open batch tasks';}
  const api={status:s=>statuses[s]||pretty(s),role:r=>roles[r]||pretty(r),event:e=>events[e]||pretty(e),mass:g=>Number(g)>=1000?(Number(g)/1000).toLocaleString(undefined,{maximumFractionDigits:3})+' kg':Number(g).toLocaleString()+' g',next,action};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.HerbLanguage=api;
})(typeof globalThis==='object'?globalThis:this);
