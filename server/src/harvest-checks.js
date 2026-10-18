'use strict';
const herbs=['Azadirachta_indica','Hibiscus_rosa_sinensis','Murraya_koenigii','Ocimum_tenuiflorum','Piper_betle'];
const model='sha256:328589201306d7e70ba5e288f5b78fac7aef248de5fcbf43ad24297c588ac322';
const canonical=s=>String(s||'').trim().replace(/[_\s]+/g,' ').toLowerCase();
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{statusCode:400,code:'CAPTURE_VALIDATION'});};
function validateCapture(r,now=Date.now()){
 check(r.capture?.version===1&&r.capture.locationConsent===true,'Camera capture and location consent are required. Retake the photos in the app.');
 check(r.photos.length>0&&r.photos.every(p=>p.source==='camera'&&Number.isFinite(Date.parse(p.capturedAt))),'Only camera photos taken in this app can be submitted.');
 const loc=r.location;check(loc.mocked!==true,'Mock locations cannot be used for harvests.');
 check(Number.isFinite(loc.accuracy)&&loc.accuracy>=0&&loc.accuracy<=100,'Enable precise location and recapture GPS (accuracy must be within 100 metres).');
 const stamp=Date.parse(loc.capturedAt);check(Number.isFinite(stamp)&&stamp<=now+60000&&stamp>=now-15*60000,'Recapture your current location before submitting.');
 check(r.photos.every(p=>Date.parse(p.capturedAt)<=now+60000&&Math.abs(Date.parse(p.capturedAt)-stamp)<=15*60000),'Retake photos at the collection location.');
 const p=r.prediction;check(p&&herbs.some(h=>canonical(h)===canonical(p.plant))&&p.modelVersion===model,'Run the supported herb identification model on a camera photo before submitting.');
 check(r.photos.some(photo=>photo.sha256===p.photoSha256),'Identification must be linked to a submitted camera photo.');
 check(['Cultivated','Wild-collected'].includes(r.sourceType),'Select cultivated or wild-collected.');
}
function approvalCheck(manifest,input){
 if(input.decision!=='APPROVE'||!manifest.captureAssessment)return;
 if(manifest.captureAssessment.needsResolution)check(typeof input.regionalEvidence==='string'&&input.regionalEvidence.trim().length>=30&&input.regionalEvidence.length<=4000,'Explain the evidence resolving the location/model concerns (at least 30 characters) before approval.');
}
function createHarvestChecks({fetchImpl=fetch,now=()=>Date.now()}={}){
 const cache=new Map();let inFlight=0;
 async function get(path){const response=await fetchImpl('https://api.gbif.org/v1/'+path,{signal:AbortSignal.timeout(7000),redirect:'error',headers:{Accept:'application/json'}});if(!response.ok)throw Error();return response.json();}
 async function regional(species,loc){
  const key=canonical(species)+':'+loc.latitude.toFixed(2)+':'+loc.longitude.toFixed(2);const saved=cache.get(key);if(saved&&saved.until>now())return saved.promise;
  if(inFlight>=4)return {state:'UNAVAILABLE',occurrences:[]};
  const promise=(async()=>{inFlight++;try{
   const taxon=await get('species/match?name='+encodeURIComponent(species.replaceAll('_',' '))+'&strict=true');
   if(taxon.matchType!=='EXACT'||taxon.rank!=='SPECIES'||!Number.isSafeInteger(taxon.usageKey))return {state:'UNKNOWN_TAXON',occurrences:[]};
   // Nearby records corroborate reported occurrence; they are not a suitability verdict.
   const y=Number(loc.latitude.toFixed(2)),x=Number(loc.longitude.toFixed(2)),dy=.45,dx=Math.min(5,.45/Math.max(.1,Math.cos(y*Math.PI/180)));
   if(y-dy<-90||y+dy>90||x-dx<-180||x+dx>180)return {state:'UNKNOWN',occurrences:[]};
   const geometry=`POLYGON((${x-dx} ${y-dy},${x+dx} ${y-dy},${x+dx} ${y+dy},${x-dx} ${y+dy},${x-dx} ${y-dy}))`;
   const data=await get('occurrence/search?taxonKey='+taxon.usageKey+'&hasCoordinate=true&hasGeospatialIssue=false&occurrenceStatus=PRESENT&limit=20&geometry='+encodeURIComponent(geometry));
   const occurrences=(data.results||[]).slice(0,20).filter(p=>Number.isSafeInteger(p.key)&&Number.isFinite(p.decimalLatitude)&&Number.isFinite(p.decimalLongitude)&&Math.abs(p.decimalLatitude-y)<=dy&&Math.abs(p.decimalLongitude-x)<=dx&&(!p.coordinateUncertaintyInMeters||p.coordinateUncertaintyInMeters<=10000)).map(p=>({key:p.key,datasetKey:p.datasetKey,stateProvince:p.stateProvince||null,country:p.country||null,reference:'https://www.gbif.org/occurrence/'+p.key}));
   return {state:occurrences.length?'NEARBY_RECORDS':'NO_NEARBY_RECORDS',taxonKey:taxon.usageKey,occurrences};
  }catch{return {state:'UNAVAILABLE',occurrences:[]};}finally{inFlight--;}})();
  if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(key,{promise,until:now()+3600000});return promise;
 }
 return {async assess(r){validateCapture(r,now());const range=await regional(r.prediction.plant,r.location),concerns=[];
  if(r.prediction.confidence<.8)concerns.push('LOW_MODEL_CONFIDENCE');
  if(canonical(r.declaredSpecies)!==canonical(r.prediction.plant))concerns.push('DECLARATION_MODEL_MISMATCH');
  if(range.state!=='NEARBY_RECORDS')concerns.push('REGION_UNCONFIRMED');
  const states=range.occurrences.map(p=>p.stateProvince).filter(Boolean);if(states.length&&!states.some(s=>canonical(r.originRegion).includes(canonical(s))))concerns.push('REGION_LABEL_UNCONFIRMED');
  return {version:1,checkedAt:new Date(now()).toISOString(),provider:'GBIF',source:'https://techdocs.gbif.org/en/openapi/v1/occurrence',region:range,concerns,needsResolution:concerns.length>0,mlTrust:'UNTRUSTED_CLIENT_PREDICTION',note:'Nearby records corroborate reported occurrence, not identity, safety or permission to harvest. Missing records do not prove absence. All batches require independent review.'};
 }};
}
module.exports={createHarvestChecks,validateCapture,approvalCheck,herbs,model};
