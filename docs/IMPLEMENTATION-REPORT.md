# HerbChain — consolidated implementation report

Updated 29 September 2026. Implemented and tested locally; live activation and production acceptance remain pending.

## What is implemented

| Area | Implementation | Activation |
| --- | --- | --- |
| Participant UI | Farmer flow, role dashboard, batch search, activity status, lot-management form and bulk handoff | New screens are feature-gated |
| Memberships | Multiple participants, organizations, suspension and assignment checks | Verify migrations/seeds in Supabase |
| Batch index | Replayable blocks, atomic checkpoints, scoped pagination/search | Run and validate indexer |
| Evidence | Private archive, exact-byte hashes, authorized cloud reads | Private bucket and backfill required |
| Transactions | Producers for harvest, review, custody and lifecycle operations; worker; exact-ID reconciliation; explicit rejected-job retry | Disabled by default |
| Lots | Split/merge, integer mass balance, consumed sources, lineage, ancestor-recall checks | Chaincode upgrade required; disabled by default |
| Operations | Staging containers, HTTPS proxy template, separate API/worker/indexer, queue and certificate checks | Templates only; not deployed |

Delivery phase numbering differs from the original plan: delivery Phase 2 was indexing and Phase 3 was evidence storage.

## Queue behavior

Queue records contain normalized fields and evidence references rather than base64 files. Membership and batch permissions are checked before enqueue and again by the worker. Each account/request key identifies an immutable payload. Workers record the exact proposal transaction ID before transmission and verify the committed event before reporting success.

Jobs are queued, running, completed, rejected or awaiting reconciliation. Expired leases do not authorize blind resubmission. The activity page shows the latest 50 requests and allows explicit retry of rejected requests, retaining previous attempts in the database. Waiting/uncertain jobs cannot be reset that way.

A crash after saving a transaction ID but before sending it may require operator investigation: a missing transaction is not proof that an old worker cannot still send it. Suspended membership can also prevent reconciliation using that identity. These requests remain blocked rather than guessed successful or retried unsafely. This is not unattended recovery from every possible failure.

## Lot rules

Aggregators, processors and manufacturers can divide or combine lots they hold. Sources must be reviewed, unpackaged and stationary. Merges require exactly matching species and processing stage. Inputs are consumed atomically, their available quantity becomes zero, and consumed mass remains recorded. Outputs plus measured loss equal inputs. Children receive LOT- IDs and do not inherit a passing lab result.

Split/merge operations allow at most 20 outputs/inputs. Lineage queries and ancestor checks are bounded to 500 lots. Reading ancestors during mutations puts them into Fabric's MVCC read set. A recalled ancestor blocks further movement or processing. Merge queue coordination uses the primary source; conflicts on additional sources rely on chaincode/MVCC validation.

Ancestor recall does not rewrite every descendant's stored status. GetLineage reports the hold. With lot support enabled, public tracing reports RECALLED_SOURCE for an affected product. Indexed cards can still show a descendant's own recorded status, so inspect lineage for the effective hold.

New lots need explicit trusted lab/regulator assignments. Permissions are not automatically copied from all parents. Harvest photos remain with their original batches; downstream ownership does not grant all source evidence access.

## Validation performed

Final run: **74 backend tests and 10 chaincode tests passed**, together with membership/index, queue/recovery and storage SQL checks. The indexed SQL regression used 201 batches over 9 pages. Mobile browser flows, including bulk handoff, passed and the Compose template parsed successfully; Docker emitted a warning that its local credential configuration was inaccessible. No registry access or container execution was involved.

- Backend regression tests cover authorization, indexing, evidence, queues and session/UI helpers.
- Actual chaincode functions ran through the queued 15-step collection-to-delivery flow without local request journals.
- Additional queued tests split and merge lots, retain request identity and verify source consumption.
- Fault tests cover commit timeout, lost lease, unknown commit status and absence of duplicate submission.
- Chaincode tests cover mass balance, stale sequences, duplicate lots and recalled ancestors.
- In-memory PostgreSQL tests cover memberships, pagination, queue/recovery, private RPCs and storage policies.
- Browser checks at 390px width cover dashboard pagination, activity and saved split-lot requests.
- Docker Compose configuration validation passed with example values. Images were not built; containers were not started.

These are not live multi-worker/Fabric MVCC, Android, TLS, backup-restore or production-load acceptance tests. Earlier 10,000-batch pagination checks are not a concurrent throughput benchmark.

## Activation order

1. Back up Fabric persistent data, CA material, local evidence, account mappings and Supabase data privately. Preserve the existing network and volumes.
2. Resolve pending local requests before switching writers. Old JSON retry journals are not automatically imported. Retain them for audit/recovery.
3. Follow existing Phase 1B–3B guides for memberships, indexing, private storage and exact-byte backfill. Verify old evidence against Fabric.
4. Apply unapplied SQL migrations 004–009 in numeric order. They are mostly one-time migrations. Do not rerun earlier table-creation migrations blindly.
5. Start the indexer and one worker, then enable queue writes. Do not run legacy and queued writers concurrently against the same pilot.
6. Complete a labelled demo and worker-interruption recovery on the real network before adding workers/API instances.
7. Test the chaincode upgrade in an isolated network first. Query the current sequence, approve the next definition in both organizations and retain the endorsement policy. Enable lots only after that upgrade and index compatibility verification.

### Queue environment

Use the private server credential setup from Phase 3A. Never put that credential in an EXPO_PUBLIC variable or send it in chat.

```bash
export HERBCHAIN_MEMBERSHIP_MODE=supabase
export HERBCHAIN_BATCH_LIST_MODE=indexed
export HERBCHAIN_EVIDENCE_MODE=archive
export HERBCHAIN_EVIDENCE_READ_MODE=cloud
export HERBCHAIN_WRITE_MODE=queued
export HERBCHAIN_LOTS_ENABLED=false
```

Start the worker in a separate Ubuntu terminal with the same private environment:

```bash
node /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/start-transaction-worker.cjs --accounts /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/participant-accounts.json
```

Use the existing start-farmer-api.cjs launcher for the API. Its pilot lock remains. Do not remove an active lock to start another process. The new container deployment uses directly configured services; introduce concurrency only after live validation.

Your activity appears when queued mode is enabled. Manage lots appears only for eligible roles with lots enabled. The phone can retry its original harvest packet to retrieve its final queue outcome.

## Staging and operations

Deployment files are in `C:\Users\admin\HerbChain\server\deploy`. Privately populate runtime.env from its example. Configure a real staging hostname/DNS and a read-only identity directory. Every certificate/key path in identities.json must refer to its mounted container path under /run/herbchain. Peer endpoints must be reachable from containers: their localhost is not WSL/host localhost. Preserve TLS hostname overrides and keep peer/CA administration private.

The Docker context is server-only with a restrictive .dockerignore. It excludes keys, datasets and environment files. Node runs as an unprivileged user. Ensure mounted key permissions permit that user, without public read access. The proxy publishes HTTP/HTTPS only. Pin reviewed image digests for a controlled production release.

Inside the configured container, run:

```bash
node src/operations-check.js
```

It reports queue age/counts, expired leases, index checkpoint and certificate-expiry counts without printing keys. Nonzero exit codes indicate dependency errors or attention conditions. `/health` remains liveness, not Fabric readiness. Add operational alerts and backup scheduling before production.

## Remaining live gates and product work

- Restore Fabric/CA data into an isolated environment and compare ledger height/history. Evidence-file backups alone are insufficient.
- Restore evidence bytes with original hashes and database memberships/assignments/jobs coherently. Reconcile restored uncertain jobs by exact transaction ID. Rebuild projections from committed blocks.
- Test simultaneous workers and conflicts, especially a merge with another operation on its second source.
- Verify real Android uploads and HTTPS behavior on weak connections.
- Agree organization governance, key custody, CA policies and availability requirements. The sample Fabric network was not converted into a production topology.
- Approve stable participant-ID/certificate-rotation design. Certificate-owned batches do not follow a changed account mapping automatically.
- Agree capacity/SLOs and run representative concurrent workloads. No production p95/capacity guarantee is claimed.

Bulk handoff supports up to 20 selected batches. Each uses its own authorization, sequence check, stable request ID and queue result. The exact selection is saved before transmission; partial or unknown outcomes can be checked using that same payload. It does not bulk-approve harvest reviews or lab outcomes. Clearing a saved selection does not cancel transactions.

Not implemented in this pass: resumable direct uploads, external notifications, separate packaging-unit/shipment entities, regional translations, abandoned-object cleanup and automated certificate-ownership migration. These are explicit remaining product work, not completed phases. Gateway connections have a configurable hard cap (default 128) but no idle eviction pool; the cap refuses excess connections rather than allowing unbounded growth.

## Main files

- `server/src/queued-actions.js`, `transaction-worker.js`, `transaction-queue.js`, `worker-runner.js`
- `server/src/lot-actions.js`, `blockchain/chaincode/lib/lineage.js`
- `server/public/activity.html`, `server/public/lots.html`
- `server/migrations/004_transaction_queue.sql` through `009_explicit_job_retry.sql`
- `server/deploy/compose.yaml`, `server/Dockerfile`, `server/src/operations-check.js`

References: [Fabric Gateway API](https://hyperledger.github.io/fabric-gateway/main/api/node/interfaces/Gateway.html), [commit status](https://hyperledger.github.io/fabric-gateway/main/api/node/interfaces/Commit.html), [Compose services](https://docs.docker.com/reference/compose-file/services/), [Caddy body limits](https://caddyserver.com/docs/caddyfile/directives/request_body).
