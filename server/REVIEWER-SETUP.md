# Reviewer workflow

The farmer phone flow has now produced a confirmed Fabric receipt for batch `HC-f3875bf100d6a0fab893947751398e31347b293d`. This reviewer increment does not approve that batch automatically.

## Start and create a separate account

Stop the existing farmer API with Ctrl+C in its Ubuntu terminal, then restart with the same command. Keep Fabric and Metro running. The updated launcher still maps the farmer and adds the `/review` portal.

```bash
node /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/start-farmer-api.cjs d5b47247-b01e-4de5-b645-cf7c60114f4a
```

Open `http://127.0.0.1:3002/review` on the laptop. Create a separate reviewer account, confirm its email if required and sign in. The page displays its Account ID even when the account is not mapped yet. Do not use the farmer account for this role. Account creation itself grants no review permission.

Restart the API with both UUIDs, farmer first and reviewer second:

```bash
node /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/start-farmer-api.cjs d5b47247-b01e-4de5-b645-cf7c60114f4a YOUR_REVIEWER_UUID
```

The second account maps to the existing `reviewer1` certificate. The launcher verifies its verifier certificate attribute. Refresh the queue after restart. No chaincode deployment or Android rebuild is needed. This portal also works on the USB-connected phone if port 3002 is forwarded, but a laptop is convenient for reviewing photos.

## Review and submit

The queue lists locally stored harvests that the ledger currently marks PENDING_REVIEW. Select one, inspect its uploaded photos and collection details, and examine ML output as untrusted supporting evidence. The backend checks every photo hash and the manifest digest against the ledger before returning evidence. Enter at least 10 characters of review reasoning, choose APPROVE or REJECT and confirm that the evidence was examined. The page asks for confirmation before submission.

Approval sets VERIFIED, not lab-tested or ready for use. Rejection sets REJECTED. The decision and notes cannot be edited after commitment. Do not approve a software-test photo as a real verified harvest.

`review.json` in the batch evidence directory stores the decision document, its SHA-256 and submission state. A timeout may mean the transaction committed. Retry the original decision; the service reconciles the ledger before resubmission. Reloading the same batch restores the same reviewer's saved decision and notes. Sign-in sessions are kept in memory; expired sessions require sign-in again. Logging out clears evidence from the page. There is no background refresh token storage in this pilot portal.

## Routes and limits

- GET `/review`: responsive reviewer portal.
- GET `/review-config`: Supabase URL and public anon key only, never Fabric signing keys.
- GET `/api/reviews`: verifier-only queue, scoped to this backend's evidence directories.
- GET `/api/reviews/:id`: verifier-only ledger history and verified private evidence, returned with no-store headers.
- POST `/api/reviews/:id`: verifier-only durable review submission.
- Generic `/api/transactions` rejects ReviewBatch; use the evidence workflow instead.

The service rejects self-review by the manifest submitter even if its account was mistakenly configured as a verifier. Existing chaincode additionally enforces Org2MSP verifier certificates. The single-process evidence-directory lock remains required; this is not a distributed review system. A competing review or recall may prevent a pending decision from committing; inspect ledger history instead of changing the stored decision.

Local validation: 22 unit tests pass, including seven reviewer tests for authorization, evidence tampering, stale hashes, concurrency, process-restarted retry, commit-timeout reconciliation, rejection and self-review. Portal JavaScript and HTTP route smoke checks also pass. Live reviewer authentication and a real Fabric review commit still require the new reviewer account mapping and the user's actual review.
