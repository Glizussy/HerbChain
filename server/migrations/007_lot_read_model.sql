BEGIN;
create or replace function public.hc_batch_has_task(b jsonb,r text,i text,m text) returns boolean language plpgsql immutable as $$
declare status text:=b->>'status'; owns boolean:=b->>'owner'=i and b->>'ownerMsp'=m; stationary boolean:=coalesce(b->'pendingTransfer','null'::jsonb)='null'::jsonb; incoming boolean:=b#>>'{pendingTransfer,identity}'=i and b#>>'{pendingTransfer,msp}'=m;
begin
 if r='verifier' then return status='PENDING_REVIEW'; end if;
 if r='regulator' then return status<>'RECALLED'; end if;
 if r in ('collector','aggregator','processor','manufacturer','distributor') and status not in ('PENDING_REVIEW','REJECTED','RECALLED','DELIVERED','CONSUMED') and (owns or coalesce(incoming,false)) then return true; end if;
 if not stationary then return false; end if;
 if r='lab' then return status in ('VERIFIED','PROCESSED'); end if;
 return false;
end $$;

create or replace function public.hc_list_batches(p_user uuid,p_channel text,p_after text default null,p_limit integer default 25,p_query text default '',p_filter text default 'all') returns jsonb language plpgsql stable set search_path=public as $$
declare member hc_memberships; org hc_organizations; result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>50 or p_query is null or length(p_query)>160 or p_filter is null or p_filter not in ('all','tasks','incoming','closed') or (p_after is not null and p_after !~ '^[A-Za-z0-9_-]{1,80}$') then raise exception 'Invalid page request'; end if;
 select * into member from hc_memberships where user_id=p_user and state='active';
 if not found then raise exception 'Active membership required'; end if;
 select * into org from hc_organizations where id=member.organization_id and active;
 if not found then raise exception 'Active organization required'; end if;
 with accessible as not materialized (
   select b.*,hc_batch_has_task(b.state,member.role,member.fabric_identity,org.msp_id) as has_task,
     coalesce(b.state#>>'{pendingTransfer,identity}'=member.fabric_identity and b.state#>>'{pendingTransfer,msp}'=org.msp_id,false) as incoming
   from hc_batch_index b where b.channel=p_channel and
    (case when member.role in ('verifier','lab','regulator') then
       exists(select 1 from hc_batch_assignments a where a.user_id=p_user and a.batch_id=b.batch_id and a.role=member.role)
     else
       (b.state->>'owner'=member.fabric_identity and b.state->>'ownerMsp'=org.msp_id)
       or (b.state#>>'{pendingTransfer,identity}'=member.fabric_identity and b.state#>>'{pendingTransfer,msp}'=org.msp_id)
       or exists(select 1 from hc_batch_actors a where a.channel=b.channel and a.batch_id=b.batch_id and a.identity=member.fabric_identity and a.msp=org.msp_id)
     end)
 ), filtered as materialized (
   select * from accessible where (p_query='' or search_document @@ plainto_tsquery('simple',p_query)) and
    (p_filter='all' or p_filter='tasks' and has_task or p_filter='incoming' and incoming or p_filter='closed' and state->>'status' in ('DELIVERED','REJECTED','RECALLED','CONSUMED'))
 ), page as materialized (select * from filtered where p_after is null or batch_id>p_after order by batch_id limit p_limit+1),
 visible as (select * from page order by batch_id limit p_limit)
 select jsonb_build_object(
   'rows',coalesce((select jsonb_agg(jsonb_build_object('state',state,'published',published) order by batch_id) from visible),'[]'::jsonb),
   'nextCursor',case when (select count(*) from page)>p_limit then (select max(batch_id) from visible) else null end,
   'filteredCount',(select count(*) from filtered),
   'stats',(select jsonb_build_object('total',count(*),'tasks',count(*) filter(where has_task),'incoming',count(*) filter(where incoming)) from accessible),
   'indexedThroughBlock',(select (next_block-1)::text from hc_index_heads where channel=p_channel),
   'indexedAt',(select updated_at from hc_index_heads where channel=p_channel)
 ) into result;
 return result;
end $$;
COMMIT;
