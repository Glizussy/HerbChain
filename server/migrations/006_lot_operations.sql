BEGIN;
ALTER TABLE public.hc_transaction_jobs DROP CONSTRAINT hc_transaction_jobs_operation_check;
ALTER TABLE public.hc_transaction_jobs ADD CONSTRAINT hc_transaction_jobs_operation_check CHECK(operation IN ('HARVEST','REVIEW','TRANSFER','LAB','PROCESS','PACKAGE','DELIVER','RECALL','SPLIT','MERGE'));
COMMIT;
