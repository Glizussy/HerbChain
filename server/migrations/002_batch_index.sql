-- Apply after 001_memberships.sql. Index tables are private to the backend.
begin;
create table public.hc_index_heads(channel text primary key,next_block bigint not null default 0,updated_at timestamptz);
create table public.hc_index_blocks(channel text not null,block_number bigint not null,digest text not null,primary key(channel,block_number));
create table public.hc_batch_index(
 channel text not null,batch_id text not null,state jsonb not null,published boolean not null default false,last_block bigint not null,
 search_document tsvector generated always as (to_tsvector('simple'::regconfig,batch_id||' '||coalesce(state->>'species','')||' '||coalesce(state->>'originRegion','')||' '||coalesce(state->>'productName',''))) stored,
 primary key(channel,batch_id)
);
create index hc_batch_search on public.hc_batch_index using gin(search_document);
create index hc_batch_owner on public.hc_batch_index(channel,(state->>'owner'),(state->>'ownerMsp'),batch_id);
create index hc_batch_recipient on public.hc_batch_index(channel,(state#>>'{pendingTransfer,identity}'),(state#>>'{pendingTransfer,msp}'),batch_id);
create table public.hc_index_events(
 channel text not null,batch_id text not null,sequence integer not null,transaction_id text not null,event jsonb not null,block_number bigint not null,
 primary key(channel,batch_id,sequence),unique(channel,transaction_id,batch_id)
);
create table public.hc_batch_actors(channel text not null,batch_id text not null,identity text not null,msp text not null,primary key(channel,batch_id,identity,msp));
create index hc_actor_batches on public.hc_batch_actors(channel,identity,msp,batch_id);
alter table public.hc_index_heads enable row level security;
alter table public.hc_index_blocks enable row level security;
alter table public.hc_batch_index enable row level security;
alter table public.hc_index_events enable row level security;
alter table public.hc_batch_actors enable row level security;
revoke all on public.hc_index_heads,public.hc_index_blocks,public.hc_batch_index,public.hc_index_events,public.hc_batch_actors from public,anon,authenticated;
grant select,insert,update,delete on public.hc_index_heads,public.hc_index_blocks,public.hc_batch_index,public.hc_index_events,public.hc_batch_actors to service_role;

create function public.hc_index_head(p_channel text) returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('nextBlock',coalesce((select next_block::text from hc_index_heads where channel=p_channel),'0'));
$$;
create function public.hc_apply_block(p_channel text,p_block bigint,p_digest text,p_updates jsonb) returns jsonb language plpgsql set search_path=public as $$
declare expected bigint; u jsonb; b jsonb; e jsonb; prior integer; was_published boolean;
begin
 if p_channel is null or p_channel='' or p_block is null or p_block<0 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_updates) is distinct from 'array' then raise exception 'Invalid block'; end if;
 insert into hc_index_heads(channel) values(p_channel) on conflict do nothing;
 select next_block into expected from hc_index_heads where channel=p_channel for update;
 if p_block<expected then
   if not exists(select 1 from hc_index_blocks where channel=p_channel and block_number=p_block and digest=p_digest) then raise exception 'Replayed block differs'; end if;
   return jsonb_build_object('replayed',true,'nextBlock',expected::text);
 end if;
 if p_block<>expected then raise exception 'Block gap'; end if;
 for u in select value from jsonb_array_elements(p_updates) loop
   b:=u->'state'; e:=u->'event';
   if (b->>'batchId') is null or (b->>'batchId') !~ '^[A-Za-z0-9_-]{1,80}$' or e->>'batchId' is distinct from b->>'batchId' or e->>'sequence' is distinct from b->>'sequence' or e->>'transactionId' is null or e#>>'{actor,identity}' is null or e#>>'{actor,msp}' is null then raise exception 'Invalid state/event pair'; end if;
   select (state->>'sequence')::integer,published into prior,was_published from hc_batch_index where channel=p_channel and batch_id=b->>'batchId';
   if (b->>'sequence')::integer is distinct from coalesce(prior,0)+1 then raise exception 'Batch sequence gap'; end if;
   insert into hc_index_events values(p_channel,b->>'batchId',(b->>'sequence')::integer,e->>'transactionId',e,p_block);
   insert into hc_batch_index(channel,batch_id,state,published,last_block) values(p_channel,b->>'batchId',b,coalesce(was_published,false) or e->>'type'='PACKAGED',p_block)
     on conflict(channel,batch_id) do update set state=excluded.state,published=excluded.published,last_block=excluded.last_block;
   insert into hc_batch_actors values(p_channel,b->>'batchId',e#>>'{actor,identity}',e#>>'{actor,msp}') on conflict do nothing;
 end loop;
 insert into hc_index_blocks values(p_channel,p_block,p_digest);
 update hc_index_heads set next_block=p_block+1,updated_at=now() where channel=p_channel;
 return jsonb_build_object('replayed',false,'nextBlock',(p_block+1)::text);
end $$;

create function public.hc_batch_has_task(b jsonb,r text,i text,m text) returns boolean language plpgsql immutable as $$
declare status text:=b->>'status'; owns boolean:=b->>'owner'=i and b->>'ownerMsp'=m; stationary boolean:=coalesce(b->'pendingTransfer','null'::jsonb)='null'::jsonb; incoming boolean:=b#>>'{pendingTransfer,identity}'=i and b#>>'{pendingTransfer,msp}'=m;
begin
 if r='verifier' then return status='PENDING_REVIEW'; end if;
 if r='regulator' then return status<>'RECALLED'; end if;
 if r in ('collector','aggregator','processor','manufacturer','distributor') and status not in ('PENDING_REVIEW','REJECTED','RECALLED','DELIVERED') and (owns or coalesce(incoming,false)) then return true; end if;
 if not stationary then return false; end if;
 if r='lab' then return status in ('VERIFIED','PROCESSED'); end if;
 return false;
end $$;

create function public.hc_list_batches(p_user uuid,p_channel text,p_after text default null,p_limit integer default 25,p_query text default '',p_filter text default 'all') returns jsonb language plpgsql stable set search_path=public as $$
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
    (p_filter='all' or p_filter='tasks' and has_task or p_filter='incoming' and incoming or p_filter='closed' and state->>'status' in ('DELIVERED','REJECTED','RECALLED'))
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
revoke all on function public.hc_index_head(text),public.hc_apply_block(text,bigint,text,jsonb),public.hc_batch_has_task(jsonb,text,text,text),public.hc_list_batches(uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.hc_index_head(text),public.hc_apply_block(text,bigint,text,jsonb),public.hc_batch_has_task(jsonb,text,text,text),public.hc_list_batches(uuid,text,text,integer,text,text) to service_role;
commit;
