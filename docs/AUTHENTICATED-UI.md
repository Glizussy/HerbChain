# AyurRaksha authenticated interfaces

This redesign uses the existing account approvals, participant identities, batch model and supply-chain APIs. It changes how people interact with the project; it does not replace the working Fabric network or weaken its permissions.

## What changed

- A shared responsive workspace replaces the separate dashboard, review, custody and operations interfaces. Existing links to those pages still work.
- Every approved participant has relevant actions, search, paginated batch cards, incoming batches where applicable, an in-app action feed, profile and language selector.
- The Batch Passport presents current stage, holder role, quantity, origin, available herb names, evidence and an expandable journey. Known species have translated common names; unknown names remain exactly as supplied.
- Forms show previous information as read-only, then stage-specific fields, remarks/evidence, final review and an explicit confirmation. Users can go back and edit before submission.
- Web drafts and pending requests use account-scoped IndexedDB. A pending request keeps its original payload and identifier across reloads. Re-login is required after reloading the web page; tokens are not placed in draft storage.
- The farmer app has My Batches, Add Batch, Updates and Profile navigation. Its four-step harvest form includes photos and suggested identification, source/GPS/date, quantity/handling, and final review.
- Native drafts copy photos into private app storage, retaining their association with model suggestions. Drafts and the existing immutable upload outbox have different purposes: drafts are editable; submitted uploads are retried unchanged.
- Farmer batch journeys remain available after forwarding. Authorized harvest photos can be viewed, and permitted PDF reports can be saved through Android's folder chooser.
- English, Hindi, Marathi and Telugu labels, status messages and form instructions share translation dictionaries. User-entered remarks, organization names and report contents are preserved, not machine-translated.

## Role responsibilities

| Role | Interface and supported actions |
| --- | --- |
| Farmer / collector | Create batches in the Android app; track batches on app/web; review journey and propose a transfer on web. Desktop Add Batch explains how to use the app. |
| Aggregator | Inspect incoming journey, confirm physical receipt, manage held batches and forward to a processor. Optional split/combine controls appear only when enabled. |
| Independent verifier | Inspect authorized source photos and location; record approval/rejection and reasons. A previously submitted uncertain decision is recovered unchanged. |
| Laboratory | Record PASS/FAIL, test remarks and PDF. A real result requires a report; simulated tests are explicitly identified. Test measurements, methods and limits belong in remarks/report. |
| Processor | Record method, output weight and handling/storage remarks. Output cannot exceed input; explain drying or other losses. |
| Manufacturer | Record product/packaging name and supporting remarks/PDF, including packing date, pack details and shelf-life evidence where applicable. |
| Distributor | Accept custody and record delivery destination, recipient, date and transport conditions in remarks, with optional evidence. |
| Regulator | Inspect assigned journeys and evidence; place a batch on hold with reasons and instructions. |

The backend remains authoritative for eligibility and assignments. A proposed transfer leaves the batch with the sender until the recipient accepts it. Acceptance means confirming the physical batch and quantity; inspect the journey first.

## Optional scale features

The workspace reuses the existing bounded indexed search, queued operations and background request history. It does not load an entire production database into the browser. Counts and some filters describe the batches currently loaded; Load More retrieves older batches.

Bulk forwarding is available with queued writes, with a maximum of 20 batches and separate results for each batch. Uncertain results retain the original selection for retry. Results can be closed only when every outcome is known or accepted by the queue.

Split/combine controls require the existing lot feature and queued backend, plus the corresponding deployed chaincode. A split creates two uniquely identified child batches; their quantities plus declared loss must equal the source quantity. Combining requires compatible, owned, stationary batches. The server enforces the full compatibility rules, consumes inputs and preserves lineage. These controls remain hidden when the feature is disabled.

## Privacy and actual capability boundaries

- A new authenticated `GET /api/passports/:id` returns the journey from one authorized snapshot, with allowlisted event details and holder role. It reuses existing evidence integrity checks.
- Farmer photos and precise location remain limited to the original farmer and authorized source reviewers/regulators. Downstream participants see only evidence they are permitted to inspect. Public tracing retains its separate publication/privacy rules.
- Another participant's signing identifier is not displayed as their name. Where a verified display name is unavailable, the holder's role is shown.
- Receiving refusal and clarification messages are not implemented in the existing custody API. Do not accept a mismatched physical batch; contact its sender. Reviewer rejection is supported.
- Notifications are a refreshable in-app action feed. Email, push and SMS delivery are not configured.
- App download/open links and their QR require real HTTPS URLs configured by the operator. No placeholder installation link is presented as working.
- Quality outcomes remain PASS/FAIL. There is no fabricated “passed with remarks” backend state. Manufacturing recipes, retail sales and expiry validation are not added by this UI.
- Native drafts survive app restarts, but removing the app or its data removes local drafts. Draft photo storage should be included in any future retention/cleanup policy.

## Run on your current laptop

1. In Ubuntu/WSL, start the existing network containers:

   ```bash
   docker start ca_org1 ca_org2 ca_orderer
   docker start orderer.example.com peer0.org1.example.com peer0.org2.example.com
   ```

2. Stop the currently running API with Ctrl+C in its terminal, then restart it so the new routes load:

   ```bash
   node /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/start-farmer-api.cjs --accounts /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/participant-accounts.json
   ```

   If a lock error appears, check its recorded PID, matching API processes and port 3002 before removing any stale lock. Never remove the lock of a running API.

3. Open `http://127.0.0.1:3002/login`. Use an approved participant account, then open its dashboard and a batch journey. Old review/custody/operations URLs now enter the shared workspace.

4. For your already installed Android development build, use Windows PowerShell:

   ```powershell
   cd C:\Users\admin\HerbChain
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   $env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"
   adb devices
   adb reverse tcp:3002 tcp:3002
   adb reverse tcp:8081 tcp:8081
   $env:EXPO_PUBLIC_HERBCHAIN_API_URL = 'http://127.0.0.1:3002'
   npx expo start --dev-client --localhost --port 8081
   ```

   Keep the API and Metro terminals open. If Metro uses another port, reverse that port instead and open the corresponding development-client URL. This USB setup assumes Windows can reach the WSL API; test its health endpoint first. Use the project's reachable HTTPS API configuration for devices without USB forwarding.

   No new native dependency was introduced. These JavaScript changes can reload in the development build already installed on your phone.

5. Other devices still require their own account access and reachable API configuration. Follow the existing deployment/device setup documentation; localhost on a different device refers to that device.

Optional operator settings, added to the API environment before starting it:

```text
HERBCHAIN_APP_DOWNLOAD_URL=https://your-real-host/path-to-app
HERBCHAIN_APP_OPEN_URL=https://your-real-host/mobile-install-or-open-page
```

## Validation and remaining live checks

Automated backend tests cover authorization, evidence integrity, custody/lifecycle rules, queue recovery, draft photo restoration/account separation, and passport snapshot consistency. Browser fixture checks cover all eight roles, four languages, desktop/tablet/mobile layouts, final review, durable retries, split quantity balance, combining, bulk partial results and recovered reviewer decisions. Public signup, login, recovery and QR tracing were regression checked. The Android JavaScript bundle was exported with the existing model asset.

These checks use test fixtures; they do not constitute a new live Fabric transaction or physical-device test. On your phone, verify camera/gallery permissions, GPS/date selection, Save Draft followed by app restart, final confirmation, a recorded batch and its journey. On the running network, complete one review and custody acceptance using separate approved accounts. Check recipient visibility and holder changes after acceptance. Verify PDF saving through Android's folder chooser. Test optional queued/lot workflows only on a network where those features are deployed and enabled.

The current backend suite passes 80 tests (`cd server && npm test`). Browser checks are retained in `server/test-ui/`; they require Playwright and a running test API serving the static assets. `UI_TEST_URL` selects that server; API calls are intercepted with fixtures. `PLAYWRIGHT_MODULE` can select an existing Playwright installation, and `UI_TEST_OUTPUT` selects screenshot output. These scripts do not submit live batch operations.
