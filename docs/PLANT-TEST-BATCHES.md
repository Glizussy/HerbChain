# Plant batch test setup and real capture evidence

## What is ready

Six attributed web-photo fixtures exercise the real harvest storage, review, custody, laboratory, processing, packaging, distribution and recall services. A local harness executes the actual chaincode methods and verifies exact retries do not create duplicate transactions. This harness is not the live Fabric network.

| Case | Species | Target state | Purpose |
| --- | --- | --- | --- |
| Pending independent review | Tulsi / Ocimum tenuiflorum | PENDING_REVIEW | Reviewer queue and blocked transfer |
| Rejected evidence | Neem / Azadirachta indica | REJECTED | Independent rejection |
| Incoming handoff | Curry leaf / Murraya koenigii | VERIFIED, transfer pending | Aggregator receipt queue and stale sequence rejection |
| Regulator recall | Hibiscus rosa-sinensis | RECALLED | Oversight recall |
| Laboratory failure | Betel / Piper betle | REJECTED | Failed lab result blocks processing |
| Complete supply chain | Tulsi / Ocimum tenuiflorum | DELIVERED | 10 kg input, 8 kg processed output, raw and final lab checks, packaging and delivery |

The farmer, reviewer, lab and regulator see all six within the current pilot account scopes. The aggregator sees three it handled or was offered. Processor sees two, manufacturer and distributor see the delivered batch. Existing access rules remain in force.

## Enable the live fixture importer

The new `POST /api/admin/demo-harvests` route is disabled unless `HERBCHAIN_DEMO_IMPORT_ENABLED=true`. It requires the existing allowlisted administrator's bearer session and an enrolled collector UID. It only supports local evidence storage, not the distributed queued write mode.

The route uses the farmer's distinct Fabric identity to sign the collection record. It accepts only `DEMO-` submission IDs and origins prefixed `DEMO: `. It stores image attribution and explicit `genuineGPS:false` and `genuineModelInference:false` flags in the hashed manifest. Camera/consent and prediction claims on web fixtures are rejected. No photo is labeled as a camera photo. Ordinary farmers cannot opt into fixture mode through request fields. Normal harvests cannot use reserved DEMO submission IDs.

Stop the current API with Ctrl+C in its Ubuntu terminal, then run:

```bash
HERBCHAIN_DEMO_IMPORT_ENABLED=true node /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/start-farmer-api.cjs --accounts /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/participant-accounts.json
```

The local runner is `work/run-six-plant-tests.cjs` in the Codex workspace. Its PowerShell wrapper is `outputs/run-plant-demo-tests.ps1`; it requests the original regulator password in a hidden prompt. The agent can run it using the already authorized regulator login after the API restarts. It saves immutable inputs and request IDs to `work/six-plant-test-state.json`. Never delete that state after an uncertain transaction: rerunning the same runner reconciles the original request. Partial success is preserved.

When live execution completes, `work/SIX-PLANT-TEST-RESULTS.md` contains the actual Fabric batch IDs and final statuses. `SIX-PLANT-HARNESS-RESULTS.md` is explicitly a separate harness report and does not establish live creation.

After fixture creation, restart the API without `HERBCHAIN_DEMO_IMPORT_ENABLED` to disable further test imports. Existing test batches remain visible and retain their simulated labels.

## Real farmer capture

At least one real capture must be performed on the Android phone. Web-image metadata cannot establish the farmer's collection location. The farmer must allow precise foreground location, take a new in-app camera photo, run the bundled identification model and submit the record.

The backend still checks location consent, camera source, GPS precision, timestamp freshness, mock-location flag, supported model hash and prediction/photo hash association. Model confidence below 80%, species disagreement and unresolved regional evidence are held for independent resolution. The verifier must provide a written resolution before approving flagged real captures.

The verifier evidence panel displays:

- Selected plant prediction and reported model confidence to one decimal place.
- Model version and whether the prediction links to a submitted photo hash.
- GPS coordinates, accuracy in metres, capture time and recorded location consent.
- Server-side GBIF regional lookup state, nearby occurrence count, concern labels and source links.
- The original photo and, for fixtures, photographer/license attribution.

There is no invented GPS percentage or botanical safety score. Nearby GBIF records corroborate reported occurrence; absent records do not prove the herb cannot grow there. The existing phone model output and capture metadata remain client-reported evidence, not independent device attestation or server-recomputed inference. Independent botanical review remains necessary; this change does not make the five-class model an open-set non-herb detector.

## Connect the phone

Use the local private login list for the farmer email and password. Email syntax needs `@`.

Keep the Ubuntu API running. Connect one unlocked Android phone with authorized USB debugging. Stop the old Metro process, then in Windows PowerShell run:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\admin\HerbChain\scripts\start-android-usb.ps1"
```

This connects API port 3002 and Metro port 8082 through ADB reverse, supplies the API address to Expo, and starts Metro. Press `a` when Metro is ready. No new Android native build is required for these JavaScript changes. The phone account gate now distinguishes missing server configuration, server connectivity failure, expired login and pending enrollment instead of showing an unrelated batch lookup message.

## Validation performed

- 112 backend tests passed, including administrator authorization, test/real capture separation, attribution integrity, immutable retries, camera/GPS/model validation and role permission checks.
- All eight role browser checks passed at mobile/tablet/desktop widths and in four languages.
- Dedicated verifier evidence browser checks passed for GPS accuracy/time/consent, confidence, model version, photo linkage, regional references and explicit absence of genuine fixture scores.
- Six complete scenario flows and seven negative/idempotency checks passed against the actual chaincode and services in a local harness. A second full run submitted no additional proposals.
- Android export succeeded with the existing 27.9 MB TFLite asset.

The live network restart and creation are separate from these checks. Windows returned `Wsl/E_ACCESSDENIED`, so the user must restart the Ubuntu API before the agent can submit the fixtures. Actual phone connectivity and a fresh real camera/GPS batch must be checked on the device.

## Image credits

Image bytes and full attribution are retained in the local workspace's `work/plant-test-assets/sources.json`. The source pages are:

- Tulsi: [Holy Basil edit2](https://commons.wikimedia.org/wiki/File:Holy_Basil_edit2.jpg), Muhammad Mahdi Karim, CC BY-SA 2.5.
- Neem: [Neem in Hyderabad](https://commons.wikimedia.org/wiki/File:Neem_(Azadirachta_indica)_in_Hyderabad_W_IMG_6976.jpg), J.M.Garg, CC BY 3.0.
- Curry tree: [Curry Tree flower](https://commons.wikimedia.org/wiki/File:Curry_Tree_flower.JPG), Muhammad Mahdi Karim, CC BY-SA 2.5.
- Hibiscus: [Hibiscus petal](https://commons.wikimedia.org/wiki/File:Hibiscus_petal.jpg), Nvineeth, CC BY-SA 3.0.
- Betel: [Piper betle plant](https://commons.wikimedia.org/wiki/File:Piper_betle_plant.jpg), Pamri (as attributed by the source), public domain.

These are illustrative source images rather than photographs of the invented Indian collection sites. Downloaded bytes are used unchanged; Wikimedia may provide a resized preview.
