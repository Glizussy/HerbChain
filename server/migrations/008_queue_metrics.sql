BEGIN;
CREATE FUNCTION public.hc_queue_metrics() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('queued',count(*) FILTER(WHERE state='queued'),'running',count(*) FILTER(WHERE state='running'),'uncertain',count(*) FILTER(WHERE state='reconcile'),'rejected',count(*) FILTER(WHERE state='rejected'),'oldestQueuedSeconds',coalesce(extract(epoch FROM clock_timestamp()-min(created_at) FILTER(WHERE state='queued')),0),'expiredLeases',count(*) FILTER(WHERE state='running' AND lease_until<=clock_timestamp())) FROM public.hc_transaction_jobs
$$;
REVOKE ALL ON FUNCTION public.hc_queue_metrics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_queue_metrics() TO service_role;
COMMIT;
