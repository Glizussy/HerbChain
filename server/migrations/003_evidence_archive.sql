-- Run as project database administrator. This does not copy any evidence.
BEGIN;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('herbchain-evidence', 'herbchain-evidence', false, 5242880,
 ARRAY['application/json','image/jpeg','application/pdf'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='herbchain-evidence' AND public IS DISTINCT FROM false)
 THEN RAISE EXCEPTION 'Existing evidence bucket is public; investigate before proceeding'; END IF;
END $$;
-- Restrictive policies also block access granted by existing broad permissive policies.
-- Service-role access bypasses RLS; that key must remain on the backend only.
DROP POLICY IF EXISTS hc_evidence_server_only ON storage.objects;
CREATE POLICY hc_evidence_server_only ON storage.objects AS RESTRICTIVE
 FOR ALL TO anon, authenticated
 USING (bucket_id <> 'herbchain-evidence')
 WITH CHECK (bucket_id <> 'herbchain-evidence');
DROP POLICY IF EXISTS hc_evidence_bucket_server_only ON storage.buckets;
CREATE POLICY hc_evidence_bucket_server_only ON storage.buckets AS RESTRICTIVE
 FOR ALL TO anon, authenticated
 USING (id <> 'herbchain-evidence')
 WITH CHECK (id <> 'herbchain-evidence');
COMMIT;
