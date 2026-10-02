BEGIN;
CREATE FUNCTION public.hc_get_job(p_user uuid,p_key text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT to_jsonb(j) FROM public.hc_transaction_jobs j WHERE user_id=p_user AND request_key=p_key $$;
CREATE FUNCTION public.hc_user_jobs(p_user uuid,p_before timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT id,request_key,batch_id,operation,state,transaction_id,result,created_at FROM public.hc_transaction_jobs WHERE user_id=p_user AND (p_before IS NULL OR created_at<p_before) ORDER BY created_at DESC,id DESC LIMIT 50) x $$;
CREATE FUNCTION public.hc_uncertain_jobs() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT * FROM public.hc_transaction_jobs WHERE state='reconcile' ORDER BY updated_at,id LIMIT 20) x $$;
CREATE FUNCTION public.hc_resolve_job(p_id uuid,p_transaction text,p_state text,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('completed','rejected','reconcile') OR p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR octet_length(p_result::text)>16384 THEN RAISE EXCEPTION 'Invalid resolution'; END IF;
 UPDATE public.hc_transaction_jobs SET state=p_state,result=p_result,updated_at=clock_timestamp() WHERE id=p_id AND state='reconcile' AND transaction_id IS NOT DISTINCT FROM p_transaction AND (p_state<>'completed' OR transaction_id IS NOT NULL);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.hc_get_job(uuid,text),public.hc_user_jobs(uuid,timestamptz),public.hc_uncertain_jobs(),public.hc_resolve_job(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_get_job(uuid,text),public.hc_user_jobs(uuid,timestamptz),public.hc_uncertain_jobs(),public.hc_resolve_job(uuid,text,text,jsonb) TO service_role;
COMMIT;
