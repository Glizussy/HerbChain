-- Phase 4A foundation. No existing API route uses this queue yet.
BEGIN;
CREATE TABLE public.hc_transaction_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 160),
 batch_id text NOT NULL CHECK(batch_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 operation text NOT NULL CHECK(operation IN ('HARVEST','REVIEW','TRANSFER','LAB','PROCESS','PACKAGE','DELIVER','RECALL')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','reconcile','completed','rejected')),
 lease_token uuid,
 lease_until timestamptz,
 transaction_id text CHECK(transaction_id ~ '^[a-f0-9]{64}$'),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,request_key)
);
CREATE INDEX hc_jobs_pick ON public.hc_transaction_jobs(state,created_at,id);
CREATE INDEX hc_jobs_batch ON public.hc_transaction_jobs(batch_id,state);
ALTER TABLE public.hc_transaction_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hc_transaction_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.hc_transaction_jobs TO service_role;

CREATE FUNCTION public.hc_enqueue_job(p_user uuid,p_key text,p_batch text,p_operation text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.hc_transaction_jobs;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.hc_memberships m JOIN public.hc_organizations o ON o.id=m.organization_id WHERE m.user_id=p_user AND m.state='active' AND o.active) THEN RAISE EXCEPTION 'Active membership required'; END IF;
 INSERT INTO public.hc_transaction_jobs(user_id,request_key,batch_id,operation,payload)
 VALUES(p_user,p_key,p_batch,p_operation,p_payload) ON CONFLICT(user_id,request_key) DO NOTHING;
 SELECT * INTO STRICT j FROM public.hc_transaction_jobs WHERE user_id=p_user AND request_key=p_key;
 IF j.batch_id<>p_batch OR j.operation<>p_operation OR j.payload<>p_payload THEN RAISE EXCEPTION 'Request key already has different content'; END IF;
 RETURN to_jsonb(j);
END $$;

CREATE FUNCTION public.hc_claim_job(p_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.hc_transaction_jobs;
BEGIN
 IF p_seconds IS NULL OR p_seconds NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'Invalid lease duration'; END IF;
 -- Serialize claim decisions so two queued jobs for one batch cannot both start.
 PERFORM pg_advisory_xact_lock(81402741);
 -- An expired worker may already have sent its transaction. Never automatically requeue it.
 UPDATE public.hc_transaction_jobs SET state='reconcile',updated_at=clock_timestamp()
 WHERE state='running' AND lease_until<=clock_timestamp();
 SELECT * INTO j FROM public.hc_transaction_jobs q WHERE q.state='queued'
 AND NOT EXISTS(SELECT 1 FROM public.hc_transaction_jobs a WHERE a.batch_id=q.batch_id AND a.state IN ('running','reconcile'))
 ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.hc_transaction_jobs SET state='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>p_seconds),updated_at=clock_timestamp()
 WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

CREATE FUNCTION public.hc_heartbeat_job(p_id uuid,p_token uuid,p_seconds integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_seconds IS NULL OR p_seconds NOT BETWEEN 10 AND 300 THEN RAISE EXCEPTION 'Invalid lease duration'; END IF;
 UPDATE public.hc_transaction_jobs SET lease_until=clock_timestamp()+make_interval(secs=>p_seconds),updated_at=clock_timestamp()
 WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_until>clock_timestamp();
 RETURN FOUND;
END $$;

-- Persist the exact Fabric proposal ID BEFORE submitting the endorsed transaction.
CREATE FUNCTION public.hc_record_job_transaction(p_id uuid,p_token uuid,p_transaction text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_transaction IS NULL OR p_transaction !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid transaction ID'; END IF;
 UPDATE public.hc_transaction_jobs SET transaction_id=p_transaction,updated_at=clock_timestamp()
 WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_until>clock_timestamp()
 AND (transaction_id IS NULL OR transaction_id=p_transaction);
 RETURN FOUND;
END $$;

CREATE FUNCTION public.hc_finish_job(p_id uuid,p_token uuid,p_state text,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_state NOT IN ('completed','rejected','reconcile') OR p_state IS NULL OR p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR octet_length(p_result::text)>16384 THEN RAISE EXCEPTION 'Invalid job result'; END IF;
 UPDATE public.hc_transaction_jobs SET state=p_state,result=p_result,lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_until>clock_timestamp()
 AND (p_state<>'completed' OR transaction_id IS NOT NULL)
 -- Once a transaction is prepared, a failure must be reconciled, not marked rejected.
 AND (p_state<>'rejected' OR transaction_id IS NULL);
 RETURN FOUND;
END $$;

-- Deliberately no retry/requeue RPC for uncertain work. Reconciliation adapter is Phase 4B.
REVOKE ALL ON FUNCTION public.hc_enqueue_job(uuid,text,text,text,jsonb), public.hc_claim_job(integer), public.hc_heartbeat_job(uuid,uuid,integer), public.hc_record_job_transaction(uuid,uuid,text), public.hc_finish_job(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_enqueue_job(uuid,text,text,text,jsonb), public.hc_claim_job(integer), public.hc_heartbeat_job(uuid,uuid,integer), public.hc_record_job_transaction(uuid,uuid,text), public.hc_finish_job(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
