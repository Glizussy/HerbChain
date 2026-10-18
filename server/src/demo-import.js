'use strict';
// Deliberately separate from /api/harvests: fixtures must never assert camera/GPS/AI evidence.
function createDemoImporter({enabled,onboarding,participantFor,withParticipant,service}){
 return {async submit(adminId,input){
  const fail=(message,statusCode)=>{throw Object.assign(Error(message),{statusCode});};
  if(!enabled)fail('Demo imports are disabled',403);
  if(!onboarding?.isAdmin(adminId))fail('Only a configured administrator may import demo fixtures',403);
  if(!input||typeof input.collectorUid!=='string'||!/^[a-f0-9-]{36}$/i.test(input.collectorUid))fail('Choose an enrolled test collector',400);
  return withParticipant(input.collectorUid,async()=>{
   if(participantFor(input.collectorUid).role!=='collector')fail('Demo owner must be an enrolled collector',400);
   return service.submit(input.collectorUid,input.harvest);
  });
 }};
}
module.exports={createDemoImporter};
