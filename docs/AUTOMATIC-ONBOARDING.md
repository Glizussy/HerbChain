# Accounts without copying user IDs

New accounts no longer need an entry in `participant-accounts.json`. Sign up, choose a role, then sign in. The API obtains the account ID from Supabase's verified login token. The browser and Android app initiate setup automatically.

## Run the updated pilot

1. Start the existing Fabric peers, orderer and certificate authorities in Ubuntu.
2. Stop the running API with Ctrl+C in its terminal, then restart it with your usual `start-farmer-api.cjs --accounts .../participant-accounts.json` command. Do not remove a lock belonging to a running API.
3. Sign in using the new account. For account `881ca81b-334b-4a50-8c39-5d5a32cd3cd5`, use its email and password; do not add its ID to the mapping file. Its signup metadata must contain `requested_role: collector`, which the signup form supplies.
4. Farmers receive their own Fabric identity and access automatically. If setup fails, retry the same account after restoring the CA connection.
5. Aggregators, laboratories, processors, manufacturers, distributors, reviewers and regulators submit an access request. The pilot administrator signs in, opens their profile, selects **Manage participant accounts**, and approves or rejects the request. Approval enrolls a separate identity with the requested role. No manual UUID copying or account-file edits are needed.

The pilot launcher explicitly selects the regulator UID already present in its trusted account configuration as the bootstrap administrator. This does not give every regulator administrative access. Set `HERBCHAIN_ONBOARDING_ADMIN_IDS` to a comma-separated list of authorized operator IDs to override it. An administrator also needs an existing active participant membership.

For Android, restart Metro with the existing API URL and reload the app to receive the updated access screen. No new native dependency was added.

## What happens behind the scenes

- `/api/onboarding` authenticates the Supabase token before reading its user ID and requested role. It does not accept a caller-supplied account ID or signing identity.
- Farmers can be automatically approved; other roles require operator approval. Changing signup metadata later does not change an existing request's role.
- The API registers `account-<user ID>` with the appropriate Fabric CA, enrolls it, validates the certificate role and its matching private key, and activates membership.
- Signing keys, interrupted enrollment secrets and identity configuration live in the private evidence directory under `.onboarding/`. Secrets are removed from completed request records. CA credentials are passed through subprocess environment variables, never shell command arguments.
- Existing configured accounts and ledger history remain intact. Each new account has a separate identity. Persisted identities reload when the API restarts; workers load them from the same private data directory.
- Registration/enrollment failures preserve the original account name and secret for retry. Membership failures also remain retryable. A rejected request cannot approve itself by signing in again.
- The default limit is 100 new requests per hour and two concurrent enrollments per API process.

The CA client supports environment configuration and verifies the selected CA's TLS certificate; see the [official Fabric CA configuration documentation](https://hyperledger-fabric-ca.readthedocs.io/en/latest/clientconfig.html).

## Prerequisites and limits

The pilot needs `fabric-samples/bin/fabric-ca-client`, the existing enrolled CA registrar MSPs, their TLS certificates, and running Org1/Org2 CAs. `FABRIC_SAMPLES` points at that installation. The launcher's bootstrap registrar must be authorized to register the configured role attribute.

Email confirmation is a separate Supabase setting. Automatic Fabric onboarding does not bypass email confirmation. For the desired no-email signup, disable and save **Confirm email** in the project's Email provider settings. Existing accounts without requested-role metadata need administrator assistance once; an unknown role is never silently granted.

Default direct server configuration leaves onboarding disabled. The pilot launcher enables it and farmer auto-approval, unless overridden. Production deployments should explicitly select their enrollment and approval policy, use dedicated restricted registrars, and set administrator IDs.

In `HERBCHAIN_MEMBERSHIP_MODE=supabase`, migrated organization and membership tables and a **server-only** `SUPABASE_SERVICE_ROLE_KEY` are required. Existing memberships, especially suspended ones, are never overwritten by enrollment. Never expose this key through `EXPO_PUBLIC_` or browser configuration.

This filesystem enrollment coordinator supports the current single API pilot. It is not a distributed enrollment service. Multiple API replicas need shared durable coordination, database-backed requests/locks and controlled certificate provisioning before this feature can be called horizontally scalable. Workers must see the same private identity files at compatible paths. Back up the evidence directory securely, including `.onboarding/`, and restrict access to the API operator. Losing those signing keys affects access to existing custody records.

## Code map

| File | Responsibility |
| --- | --- |
| `server/src/onboarding.js` | Persistent requests, approval, limits and retries |
| `server/src/ca-onboarding.js` | TLS CA enrollment and optional database membership activation |
| `server/src/identity-registry.js` | Validate and reload unique signing identities |
| `server/src/onboarding-runtime.js` | Server configuration and persistence wiring |
| `server/src/server.js` | Authenticated onboarding and administrator routes |
| `server/public/ayur-auth.js` | Automatic onboarding after website signup/login |
| `server/public/participants.*` | Administrator approval screen |
| `src/components/FarmerAccessGate.js` | Automatic setup and retry on Android |

Automated tests exercise provisioning with mocked CA responses. Actual enrollment requires the running Ubuntu Fabric network and a real sign-in; a passing fixture test does not establish live CA connectivity.
