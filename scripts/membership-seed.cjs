'use strict';
const {organizationIds}=require('./participant-accounts.cjs');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
function membershipSeed(entries,identities){
  const lines=['-- Generated from enrolled certificates. Contains no signing keys or passwords.','begin;'];
  for(const [org,id] of Object.entries(organizationIds))lines.push(`insert into public.hc_organizations(id,name,msp_id) values (${quote(id)},${quote(org==='org1'?'Pilot supply participants':'Pilot independent oversight')},${quote(org==='org1'?'Org1MSP':'Org2MSP')}) on conflict(id) do nothing;`);
  for(const p of entries){
    const c=identities[p.userId];if(!c?.fabricIdentity)throw Error('Missing certificate identity for '+p.identityName);
    lines.push(`insert into public.hc_memberships(user_id,organization_id,role,display_name,fabric_identity) values (${[p.userId,p.organizationId,p.role,p.displayName,c.fabricIdentity].map(quote).join(',')}) on conflict(user_id) do nothing;`);
    const assertion=`begin if not exists(select 1 from public.hc_memberships m join public.hc_organizations o on o.id=m.organization_id where m.user_id=${quote(p.userId)} and m.organization_id=${quote(p.organizationId)} and m.role=${quote(p.role)} and m.fabric_identity=${quote(c.fabricIdentity)} and o.msp_id=${quote(c.mspId)}) then raise exception 'Existing membership does not match the seed; inspect before changing it'; end if; end`;
    lines.push('do '+quote(assertion)+';');
  }
  lines.push('commit;');return lines.join('\n')+'\n';
}
module.exports={membershipSeed};
