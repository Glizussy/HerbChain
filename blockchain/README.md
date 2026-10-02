# HerbChain: Fabric implementation and learning guide

## What exists now

The existing Expo application collects GPS, photos, quantity and ML predictions and writes to Supabase. There was no Fabric service in the inspected project. The new `chaincode` folder implements the batch lifecycle, `server` contains a Fabric Gateway API and consumer trace page, and `src/services/fabricService.js` provides an optional authenticated mobile client. The original Supabase submission flow is deliberately still a database-only submission, and the success message now says so.

This is a foundation, not a completed or deployed application. Contract unit tests use an in-memory Fabric stub. A real network, enrolled identities, Supabase login, evidence verification, integrated stakeholder forms and a physical QR label workflow remain to be completed. Docker was not reachable and WSL access was denied in the development session. Those facts do not establish whether WSL is installed for the desktop user.

## Fabric in plain language

Think of Fabric as a shared register maintained by participating organizations. Your database still stores normal application data. Fabric stores the agreed record of who handled a batch and which evidence they signed.

* An **organization** is a participating institution, such as a cooperative or laboratory. A farmer does not need to run a blockchain node.
* An **identity** is a certificate plus a signing key. Certificates identify participants and carry approved roles.
* An **MSP** tells the network which certificate authorities represent an organization.
* A **peer** runs contracts and holds a ledger copy.
* A **channel** is a ledger shared by a defined set of organizations.
* **Chaincode** is the program enforcing batch rules.
* An **endorsement policy** specifies which organizations must endorse a proposed update.
* The **ordering service** orders transactions into blocks. Peers validate them before applying valid state updates.
* The **Gateway** is the backend's connection to the network. Wait for a successful commit before showing blockchain registration as complete.

You do not need cryptocurrency, mining, gas fees, MetaMask or NFT minting for this design. A batch is a ledger asset with a history.

```text
Expo harvest form and stakeholder screens
        | Supabase login and HTTPS requests
        v
HerbChain backend -- private evidence storage / Supabase
        | Fabric Gateway, participant signing identity
        v
HerbChain chaincode -- organization peers -- ordering service
        |
        +-- redacted read API -- consumer trace page -- QR URL
```

Source: [Fabric application tutorial](https://hyperledger-fabric.readthedocs.io/en/latest/write_first_app.html).

## Pilot organizations and identities

Use the standard two-organization test network initially. Org1MSP represents supply operations: collector, aggregator, processor, manufacturer and distributor. Org2MSP represents oversight: verifier, lab and regulator. The separate reader identity only reads. These role-to-MSP assignments are enforced in `chaincode/lib/batches.js`. This deliberately simplifies the real governance structure; a real laboratory and regulator should not necessarily share an organization.

Give each participant a separate certificate. Set the `herbchain.role` attribute through the CA, never through a request body's `role` field. The stock test-network User1 certificates do not have this attribute and are rejected by these contracts. A Supabase user UUID maps to an enrolled Fabric identity in the private server configuration. This backend holds user signing keys for the pilot, which makes it a trusted service; it is not independent user-side signing.

Source: [Fabric CA attributes](https://hyperledger-fabric-ca.readthedocs.io/en/latest/users-guide.html).

## Collection to distribution

1. Collector submits a harvest evidence bundle: photos, declared species, timestamp, GPS accuracy, quantity, source type and model metadata. Save files privately; calculate SHA-256 from the actual bytes. Convert kg/g to positive integer grams. Bundles need a measured mass before ledger registration.
2. `CreateBatch` records a PENDING_REVIEW candidate. This is an audit entry, not a verified herb. A candidate-first design preserves rejected attempts as well as accepted lots.
3. An independent verifier checks the image evidence, species declaration, collection location and relevant supporting permissions. `ReviewBatch` approves or rejects it. Habitat and permit rules still need real datasets and explicit policies.
4. The current custodian calls `ProposeTransfer`. The intended recipient calls `AcceptTransfer`. Until acceptance the current owner stays responsible. The sender may cancel a pending handoff.
5. A lab records PASS or FAIL with the report hash. These are recorded lab assertions, not automated medical or regulatory certifications. FAIL closes the lot.
6. The processor records an operation and output mass. Output cannot exceed input in this single-herb pilot. Processing removes the existing lab clearance.
7. A lab tests the processed material. The manufacturer can package only after that test passes.
8. The distributor accepts custody and records delivery. A regulator can recall a batch even after delivery.
9. A label links to `/trace?batch=HC-001`. The consumer API publishes only packaged lots and retains recall visibility. It excludes exact GPS, personal identities and document links.

The contract currently handles an intact lot. Real blending, multiple ingredients, splitting and individual packages require child IDs, parent links and quantity conservation; do not reuse this whole-lot API to pretend that those cases are tracked.

## ML boundary

The inspected classifier lists neem, hibiscus, curry leaf, Tulsi and betel. Ashwagandha is not among those labels. Start with Tulsi or neem unless the model is retrained. This code alone does not establish a reliable unknown/non-herb detector. Confidence thresholds need validation against held-out images and out-of-distribution examples.

The previous browser/native-unavailable fallback returned a fabricated 94% Tulsi prediction. It now throws an explicit unavailable error. The form can still save a harvest for manual review. Mobile predictions are not trusted attestations: store the model version, input-photo hash, output and review decision; do not automatically grant approval from a client prediction. A reviewer should validate evidence independently, or the backend should run a validated model on the stored image.

## Ledger and storage boundaries

| Ledger | Private storage/database |
|---|---|
| Batch ID, species, coarse region, grams | Exact GPS, collector contact details |
| Current custodian and signed events | Photos and actual lab report bytes |
| Evidence/report SHA-256 digests | Model output, version and review materials |
| Processing, packaging, delivery, recall | Drafts, login profiles and dashboard indexes |

Everyone operating a channel peer can see ordinary channel data; role checks on read functions do not hide ledger contents from peer operators. Keep sensitive fields off this shared ledger, or design private data collections. Low-entropy sensitive facts should not be published as unsalted hashes. The current prototype hashes evidence bundles/documents, but the backend must verify these hashes against stored bytes before trusting them. The API currently accepts digest strings; automatic file verification is not yet implemented.

Source: [Fabric private data](https://hyperledger-fabric.readthedocs.io/en/latest/private-data/private-data.html).

## Bring up the development network on Windows

Run Fabric within Ubuntu on WSL2 with Docker Desktop's WSL integration enabled. Check from your own Ubuntu terminal:

```bash
docker version
docker compose version
node --version
git --version
```

Install Fabric samples, binaries and images using the [official installation instructions](https://hyperledger-fabric.readthedocs.io/en/latest/install.html). Keep sample scripts, binaries and container images on compatible releases, and record the chosen versions. This implementation uses the Fabric 2.5 Node contract API and the modern Gateway client. Follow the installed Gateway package's supported runtime requirements. Prefer the Linux filesystem for Fabric's working data.

The Windows project is accessible in WSL at `/mnt/c/Users/admin/HerbChain`. From a fresh, dedicated test network:

```bash
export FABRIC_SAMPLES=/absolute/path/to/fabric-samples
export HERBCHAIN_ROOT=/mnt/c/Users/admin/HerbChain
cd "$FABRIC_SAMPLES/test-network"
./network.sh up createChannel -c herbchain -ca
./network.sh deployCC -c herbchain -ccn herbchain \
  -ccp "$HERBCHAIN_ROOT/blockchain/chaincode" -ccl javascript \
  -ccep "AND('Org1MSP.peer','Org2MSP.peer')"
```

This requires both organizations to endorse writes. It does not mean a human at each organization approves every transaction. The test network is for development; do not present it as a resilient production deployment. Do not run `network.sh down` on a network whose ledger you need to retain.

Source: [Windows prerequisites](https://hyperledger-fabric.readthedocs.io/en/latest/prereqs.html).

Enroll pilot users using the script, which prompts for a secret. Use a unique name for each identity. The test network must have been created with `-ca`.

```bash
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" collector farmer1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" verifier reviewer1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" aggregator aggregator1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" lab lab1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" processor processor1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" manufacturer manufacturer1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" distributor distributor1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" regulator regulator1
bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" reader publicreader1
```

The enrollment script is supplied but has not been exercised against a live CA in this session. Keep its generated private keys out of Git. The script is only intended for a local development CA; enrollment secrets are passed to the CA CLI process.

## Start the backend

1. Create Supabase Auth accounts for participants. Copy `server/.env.example` to `server/.env` and configure the project URL/key.
2. Copy `server/identities.example.json` to `server/identities.local.json`. Replace the sample user UUID with each participant's actual Supabase Auth UUID. Add one entry per participant. Set exact absolute certificate, private key and peer TLS CA paths. Org1 uses port 7051; Org2 uses 9051. The `consumer-reader` entry uses a reader-role certificate.
3. Run these commands in the same Linux environment as the network:

```bash
cd "$HERBCHAIN_ROOT/server"
npm ci
npm start
```

Open `http://localhost:3001/trace`. `/health` verifies API process availability only, not Fabric readiness. Calls to the ledger fail explicitly if Fabric is unavailable; there is no simulated blockchain fallback. Leave the backend bound to localhost during setup. A real device connection needs a reachable development host or an HTTPS deployment plus appropriate network configuration.

## API examples

Authenticated writes use `POST /api/transactions`, `Authorization: Bearer <Supabase access token>`, and JSON bodies. The server validates the token with Supabase and chooses the signing identity; the caller cannot choose another identity in the payload.

```json
{
  "operation": "CreateBatch",
  "args": ["{\"batchId\":\"HC-001\",\"species\":\"Ocimum_tenuiflorum\",\"originRegion\":\"Pilot region\",\"quantityGrams\":10000,\"harvestEvidenceHash\":\"REPLACE_WITH_ACTUAL_64_CHARACTER_SHA256_HEX\"}"]
}
```

Other argument lists, in order:

| Operation | Arguments |
|---|---|
| ReviewBatch | batchId, APPROVE or REJECT, review evidence hash |
| ProposeTransfer | batchId, recipient's Fabric getID() string, recipient MSP |
| AcceptTransfer / CancelTransfer | batchId |
| RecordLabResult | batchId, PASS or FAIL, report hash |
| RecordProcessing | batchId, method, output grams as a string, evidence hash |
| PackageBatch | batchId, product name, packaging evidence hash |
| RecordDelivery / RecallBatch | batchId, evidence hash |

The recipient is the exact Fabric certificate identity string, not a Supabase UUID or a human display name. A participant-directory endpoint/UI is still needed to translate an approved recipient selection into this value. Read the private history through `GET /api/batches/:id`. Public readers use `GET /public/batches/:id`.

An HTTP success response includes `committed: true` and a transaction ID after commit validation. If an error includes a transaction ID and unknown commit status, query history before retrying: network timeouts do not prove the transaction failed. The next integration layer should persist submission IDs and reconcile them, rather than blindly resending events.

## Remaining work to finish the college pilot

1. **Network milestone:** get Docker/WSL accessible, deploy the contract, enroll all roles, and run the full lifecycle against actual peers. Unit tests cannot validate CA attributes, endorsements or Gateway networking.
2. **Login and evidence milestone:** add Supabase login to Expo, design and migrate ownership/RLS policies, switch evidence to private storage, compute hashes on the server, and store evidence manifests. Do not infer row ownership from the currently editable collector ID. Inspect existing database schema/policies before changing them.
3. **Harvest registration milestone:** wire a durable submission/outbox flow: save draft/evidence, create candidate on Fabric, persist transaction ID, and reconcile uncertain results. Keep explicit database-saved vs ledger-committed status. Use UUID-quality batch IDs and retry-safe requests. The optional mobile client is present but is not called automatically yet.
4. **Stakeholder milestone:** build review queue, lab upload, transfer inbox, processing, packaging and delivery screens around the implemented operations. Add a trusted participant directory. Handle ML image removal/races so evidence cannot be associated with a different photo.
5. **Consumer milestone:** generate and print QR labels pointing at the reachable trace URL; verify the page on a real phone. Distinguish the Expo development QR from the product QR. Add unique package IDs if individual-pack traceability is claimed.
6. **Demo milestone:** show one successful Tulsi lot, an unauthorized update, a rejected lab result, a tampered evidence file, and a recall visible from a printed QR. Test Supabase privacy rules and public redaction with real identities.

Keep habitat validation and sustainability permissions explicitly manual until authoritative rule data is available. A claimed GPS coordinate alone is not proof of legal or sustainable collection. Physical lot labels, receiving inspection and trusted laboratories remain necessary.

## Local checks

```bash
cd "$HERBCHAIN_ROOT/blockchain/chaincode"
npm test
```

The tests cover the complete whole-lot lifecycle, authorization, custody acceptance, duplicate IDs, mass validation, post-processing retesting, failed tests and recall. They do not establish production readiness or replace live Fabric integration tests.
