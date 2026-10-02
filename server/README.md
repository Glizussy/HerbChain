# Android farmer integration — current status

The Expo app now requires Supabase sign-in. The farmer form sends JPEG evidence and harvest details to `/api/harvests`. The backend verifies the Supabase access token, selects the configured collector identity, stores evidence privately, hashes actual uploaded bytes and a manifest, and submits `CreateBatch` to Fabric. A confirmed transaction creates `PENDING_REVIEW`, never automatic approval based on ML.

The existing demo ledger and consumer page remain usable. The old anonymous Supabase photo/table insertion is no longer called by the farmer form. Existing Supabase records are not migrated or deleted. Supabase is used for authentication in this iteration. New evidence is held in the Linux backend's private `~/herbchain-fabric/harvest-data` directory, not in the previous public bucket. Back up this directory alongside the Fabric network. A managed private storage integration and reviewer screens remain future work.

## 1. Create the farmer account

Restart your existing Expo development server from `C:\Users\admin\HerbChain` using `npx expo start --dev-client`. Open the existing Android development build and reload. No new native dependencies were added. You should see a sign-in screen. Create a Supabase account and complete email confirmation if enabled. The account password is separate from the Fabric enrollment secret and Ubuntu password. Existing Supabase Auth accounts may simply sign in.

After sign-in, tap **Account ID**. This UUID is the only value needed to configure the collector mapping. Never paste passwords, access tokens or private keys into chat.

Creating an account does not grant a blockchain role. The administrator must map its UUID to an enrolled Fabric identity. This pilot maps exactly one farmer account to `farmer1`; do not give multiple real farmers the same Fabric identity.

## 2. Start the farmer backend in Ubuntu

Keep the existing Fabric peers, orderer and CAs running. Run the supplied launcher with the UUID from step 1:

```bash
node /mnt/c/Users/admin/Documents/Codex/2026-09-14/c-users-admin-herbchain/outputs/start-farmer-api.cjs YOUR_SUPABASE_USER_UUID
```

The launcher verifies certificate role attributes, loads the existing app's Supabase public configuration without printing keys, and starts a separate API on Ubuntu localhost port 3002. It configures the reader and collector identities, and uses an exclusive lock for the evidence directory. The consumer-only demo launcher on port 3001 cannot accept farmer submissions.

If the backend was killed without a graceful exit and reports a stale lock, inspect the PID in `.api.lock` and verify the old process is stopped before removing that single lock file. Never delete `harvest-data` as a recovery step.

## 3. Connect the phone

The phone needs a reachable HTTPS URL for the port-3002 backend, provided by an approved reverse proxy/tunnel or deployment. `localhost` on the phone refers to the phone, not Ubuntu or Windows. The launcher intentionally binds only to Ubuntu localhost. A tunnel running in Ubuntu can connect to it without exposing the peer/orderer ports.

Once that URL is established, set this public variable in the Expo project's `.env`:

```dotenv
EXPO_PUBLIC_HERBCHAIN_API_URL=https://YOUR_REACHABLE_BACKEND
```

Do not use the `/trace` URL as the API base. Restart Metro after changing the variable, then reload the phone app. Do not put Fabric keys or server secrets into any `EXPO_PUBLIC_` variable. Browser dashboard CORS and remote hosting are not implemented in this increment.

## 4. Test one actual submission

Sign in as the mapped farmer, select/take a photo, capture GPS, enter district/state, declared herb and positive mass in kg/g. Wait for classification to finish. Submit once.

The form becomes read-only while the original request is retained for retry. The backend derives a deterministic ledger batch ID from the authenticated user and client submission reference. It writes photos and a manifest before requesting a Fabric transaction. Retrying the same evidence reconciles against existing ledger history before creating another proposal.

* **Recorded on Fabric** means a validated commit was received or the matching existing ledger record was found. The returned batch is pending independent review.
* **Evidence saved — registration pending** means files were saved, but a Fabric commit is not confirmed. Tap **Retry original submission** while the screen is open. Do not create another harvest for the same lot merely because a request timed out.
* **Account not enrolled** means the user UUID has not been mapped by the backend launcher/configuration.

Keep the app open until the result is confirmed: a durable mobile offline queue is not yet implemented. Backend evidence survives a process restart, but unsent drafts and the phone's in-memory prepared request do not. A reviewer evidence API/dashboard and review actions are also not implemented yet, so do not claim the new submission is verified or ready for distribution.

## Evidence and ML

The server records hashes of compressed JPEG uploads. It checks size, JPEG signatures and request fields; this is not a botanical or safety test. The model prediction is labelled untrusted client evidence, associated with its uploaded photo derivative and the bundled model's SHA-256 version. Removing a photo clears the prediction, and obsolete inference results are discarded. Original capture-file bytes are not preserved in this upload flow.

Exact GPS and collector labels stay in private evidence files. The shared ledger contains declared species, coarse origin, mass, custodian and evidence digest. Protect the backend and local signing keys: this pilot's backend signs on behalf of users.

## Validation completed locally

Eight backend tests cover hash-based evidence storage, concurrent/restarted retries, commit-timeout reconciliation, offline pending results, changed-evidence rejection, user-separated IDs, photo tampering and input validation. The modified React Native sources were syntax-checked. Live authenticated phone-to-Supabase-to-Fabric testing is still required after account mapping and HTTPS connectivity are configured.
