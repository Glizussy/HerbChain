-- Additive phase 1B schema. Apply once to the intended Supabase project.
-- No existing Auth users, Fabric identities or ledger records are replaced.
begin;
create table public.hc_organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 160),
 msp_id text not null check(msp_id in ('Org1MSP','Org2MSP')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.hc_memberships (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete restrict,
 organization_id uuid not null references public.hc_organizations(id) on delete restrict,
 role text not null check(role in ('collector','aggregator','processor','manufacturer','distributor','verifier','lab','regulator')),
 state text not null default 'active' check(state in ('active','suspended')),
 display_name text not null check(length(trim(display_name)) between 1 and 160),
 fabric_identity text not null unique check(length(fabric_identity)>0),
 created_at timestamptz not null default now(),
 unique(user_id,role), unique(user_id,organization_id,role)
);
create index hc_memberships_directory on public.hc_memberships(role,state,user_id);
create index hc_memberships_organization on public.hc_memberships(organization_id);
create table public.hc_farms (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null,
 organization_id uuid not null,
 owner_role text not null default 'collector' check(owner_role='collector'),
 name text not null check(length(trim(name)) between 1 and 160),
 district text not null check(length(trim(district)) between 1 and 160),
 state text not null check(length(trim(state)) between 1 and 160),
 latitude numeric check(latitude between -90 and 90),
 longitude numeric check(longitude between -180 and 180),
 check((latitude is null)=(longitude is null)),
 foreign key(owner_user_id,organization_id,owner_role) references public.hc_memberships(user_id,organization_id,role) on delete restrict
);
create index hc_farms_owner on public.hc_farms(owner_user_id);
create table public.hc_batch_assignments (
 batch_id text not null check(batch_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 user_id uuid not null,
 role text not null check(role in ('verifier','lab','regulator')),
 created_at timestamptz not null default now(),
 primary key(user_id,batch_id),
 foreign key(user_id,role) references public.hc_memberships(user_id,role) on delete restrict
);
create index hc_assignments_batch on public.hc_batch_assignments(batch_id);

alter table public.hc_organizations enable row level security;
alter table public.hc_memberships enable row level security;
alter table public.hc_farms enable row level security;
alter table public.hc_batch_assignments enable row level security;
revoke all on public.hc_organizations,public.hc_memberships,public.hc_farms,public.hc_batch_assignments from public,anon,authenticated;
grant select on public.hc_organizations,public.hc_memberships,public.hc_farms,public.hc_batch_assignments to authenticated;
-- Administrative provisioning stays server-side. Clients cannot grant roles or assignments.
grant select,insert,update,delete on public.hc_organizations,public.hc_memberships,public.hc_farms,public.hc_batch_assignments to service_role;
create policy membership_self_read on public.hc_memberships for select to authenticated using(user_id=(select auth.uid()));
create policy organization_member_read on public.hc_organizations for select to authenticated using(
 active and exists(select 1 from public.hc_memberships m where m.user_id=(select auth.uid()) and m.organization_id=hc_organizations.id and m.state='active')
);
create policy farm_owner_read on public.hc_farms for select to authenticated using(
 owner_user_id=(select auth.uid()) and exists(select 1 from public.hc_memberships m join public.hc_organizations o on o.id=m.organization_id where m.user_id=owner_user_id and m.state='active' and o.active)
);
create policy assignment_self_read on public.hc_batch_assignments for select to authenticated using(
 user_id=(select auth.uid()) and exists(select 1 from public.hc_memberships m join public.hc_organizations o on o.id=m.organization_id where m.user_id=hc_batch_assignments.user_id and m.state='active' and o.active)
);
commit;
