BEGIN;
ALTER TABLE public.hc_transaction_jobs ADD COLUMN attempts jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE FUNCTION public.hc_retry_rejected_job(p_user uuid,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.hc_transaction_jobs SET attempts=attempts||jsonb_build_array(jsonb_build_object('transactionId',transaction_id,'result',result,'finishedAt',updated_at)),state='queued',transaction_id=NULL,lease_token=NULL,lease_until=NULL,result=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND user_id=p_user AND EXISTS(SELECT 1 FROM public.hc_memberships m JOIN public.hc_organizations o ON o.id=m.organization_id WHERE m.user_id=p_user AND m.state='active' AND o.active) AND state='rejected' AND jsonb_array_length(attempts)<10;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.hc_retry_rejected_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hc_retry_rejected_job(uuid,uuid) TO service_role;
COMMIT;
