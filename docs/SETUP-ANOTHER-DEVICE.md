# Run HerbChain on another device

Updated 2 October 2026. Written against the current repository. The commands below are setup instructions, not a record that a second-machine installation or Docker deployment has been tested.

## Choose what you need

| Goal | What to install |
| --- | --- |
| A teammate uses the reviewer, aggregator or other portal | A browser and access to the existing backend; no Fabric installation |
| A farmer uses another Android phone | The HerbChain native app, account and reachable backend; no Fabric installation |
| A teammate develops the whole project independently | Git, Node, Docker, Fabric tools; Android Studio/JDK for Android development |
| Move the existing system and keep old batches | A coordinated backup/restore of the ledger, identities, evidence and configuration in addition to Git |

**Recommended first step:** get the existing local pilot running on the new development machine before enabling the optional indexed/queued/cloud modes. A fresh network is an independent demo and has no old batches.

## Can we use Docker?

Yes. There are two separate Docker parts:

1. **Fabric network:** peers, orderer, certificate authorities and chaincode containers already run in Docker through `fabric-samples/test-network`.
2. **HerbChain services:** `server/Dockerfile` packages the API. `server/deploy/compose.yaml` provides a staging template with API, transaction worker, block indexer and Caddy HTTPS proxy.

That Compose file does **not** create the Fabric network, enroll participants, restore ledger history, create Supabase accounts, apply SQL migrations or build the Android app. Supabase remains a separately configured service. Android builds are simplest outside Docker using Android Studio and a physical USB phone.

The current Compose defaults enable database memberships, indexed lists, archived evidence and queued writes. Those modes need setup first; do not run the full template against an unprepared project and expect the old pilot configuration to work.

## A. Use another device with the existing backend

### Web participants

The backend computer must stay on. Publish the backend through a configured HTTPS endpoint, then give the teammate a URL such as `https://YOUR_HOST/dashboard`. Sign in using their own mapped participant account.

`http://127.0.0.1:3002` refers to the device opening it. A teammate cannot use that address to reach your laptop. The local launcher binds to loopback, so replacing localhost with your Wi-Fi IP alone will not expose it. Use the HTTPS deployment described below or an explicitly configured development proxy. Keep Fabric signing keys on the backend.

### Another Android phone

For normal shared access, install a build configured with `EXPO_PUBLIC_HERBCHAIN_API_URL=https://YOUR_HOST`. A development build also needs its Metro development server; a standalone release build does not. The current repository includes local development setup, not a completed release-distribution workflow.

For USB development on the computer already running the API, use the Android steps in section C. A phone does not need Docker, Ubuntu or peer certificates.

## B. Set up a fresh Windows development computer

These steps create a **new demo ledger**. To keep old batches, read section F first and do not initialize a replacement network.

### 1. Install tools

- Git for Windows.
- Node.js 22 LTS, both on Windows (Expo) and inside Ubuntu (backend/tools).
- WSL 2 with Ubuntu.
- Docker Desktop using Linux containers and WSL integration for Ubuntu. Use one Docker engine consistently; do not accidentally switch between Docker Desktop and a separately installed Ubuntu engine.
- Android Studio with Android SDK/platform-tools, and JDK 17 if building Android locally.

In **Windows PowerShell**, check WSL:

```powershell
wsl --list --verbose
```

Enable Ubuntu in Docker Desktop's **Settings → Resources → WSL Integration**. In **Ubuntu**, verify:

```bash
docker version
docker compose version
node --version
git --version
curl --version
jq --version
```

`docker version` must show a responding server. The Windows `wsl` command is not an Ubuntu package you need to install.

### 2. Clone the project

Ensure the current changes, including `scripts/` and this guide, have actually been pushed first. In **PowerShell**:

```powershell
git clone https://github.com/Glizussy/HerbChain.git "$HOME\HerbChain"
cd "$HOME\HerbChain"
npm ci
Copy-Item .env.example .env
```

Edit `.env` locally with the intended Supabase project's URL and public/anon key. Use a separate test Supabase project for an independent demo where possible. Never put a service-role key in an `EXPO_PUBLIC_` variable.

Do not share `node_modules` between Windows and Linux. For WSL backend installation, enter **Ubuntu** and set the correct path for your Windows username:

```bash
export HERBCHAIN_ROOT=/mnt/c/Users/YOUR_WINDOWS_USERNAME/HerbChain
cd "$HERBCHAIN_ROOT/server"
npm ci
cd "$HERBCHAIN_ROOT/blockchain/chaincode"
npm ci
```

The root dependencies above belong to the Windows Android build; these two nested packages are installed from Ubuntu. Do not run root `npm ci` again from Ubuntu in that same checkout.

### 3. Install Fabric tools and start the new demo network

Use the official Fabric installer. The previous pilot used Fabric **2.5.16** and Fabric CA **1.5.17**; the following requests those versions, rather than silently choosing newer defaults. Keep the downloaded installer and samples revision recorded for reproducibility. In **Ubuntu**:

```bash
mkdir -p ~/herbchain-fabric
cd ~/herbchain-fabric
curl -fsSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
# Inspect the downloaded installer before running it.
bash install-fabric.sh --fabric-version 2.5.16 --ca-version 1.5.17 docker samples binary
export FABRIC_SAMPLES="$HOME/herbchain-fabric/fabric-samples"
export PATH="$FABRIC_SAMPLES/bin:$PATH"
cd "$FABRIC_SAMPLES/test-network"
./network.sh up createChannel -c herbchain -ca
./network.sh deployCC -c herbchain -ccn herbchain \
  -ccp "$HERBCHAIN_ROOT/blockchain/chaincode" -ccl javascript \
  -ccep "AND('Org1MSP.peer','Org2MSP.peer')"
```

Use these commands only for a fresh dedicated network. An existing deployment needs its own lifecycle upgrade plan. Do not run `network.sh down` on a network whose ledger must be retained.

### 4. Enroll participant identities

Keep `HERBCHAIN_ROOT` and `FABRIC_SAMPLES` exported in the Ubuntu terminal. Run each command separately and choose its own enrollment secret when prompted. The script requires at least 16 letters/digits.

```bash
FABRIC_CA_CLIENT_URL=https://localhost:7054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" collector farmer1
FABRIC_CA_CLIENT_URL=https://localhost:7054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" aggregator aggregator1
FABRIC_CA_CLIENT_URL=https://localhost:7054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" processor processor1
FABRIC_CA_CLIENT_URL=https://localhost:7054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" manufacturer manufacturer1
FABRIC_CA_CLIENT_URL=https://localhost:7054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" distributor distributor1
FABRIC_CA_CLIENT_URL=https://localhost:8054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" verifier reviewer1
FABRIC_CA_CLIENT_URL=https://localhost:8054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" lab lab1
FABRIC_CA_CLIENT_URL=https://localhost:8054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" regulator regulator1
FABRIC_CA_CLIENT_URL=https://localhost:8054 bash "$HERBCHAIN_ROOT/blockchain/enroll-pilot.sh" reader reader1
```

The launcher expects `reader1`, not `publicreader1`. The script refuses to overwrite an existing enrollment directory. Enrollment keys remain private and are not supplied by `git clone`.

### 5. Configure Supabase accounts

Create separate Auth accounts for collector, verifier, aggregator, lab, processor, manufacturer, distributor and regulator. Record each account's **Auth user UUID**, not its email or password.

```bash
cd "$HERBCHAIN_ROOT"
cp scripts/participant-accounts.example.json scripts/participant-accounts.local.json
```

Replace every placeholder in the local JSON with its corresponding UUID. The simple mapping uses the enrolled names from step 4. For multiple users of one role, `participant-accounts.cjs` also accepts a `participants` array with `userId`, `role`, `identityName` and optional organization/display fields. Each user needs a distinct enrolled identity.

For this first run use file membership mode. The optional database migration/worker setup is a later step, not a prerequisite for the local pilot.

### 6. Start the backend

In **Ubuntu**, from the repository root:

```bash
export HERBCHAIN_MEMBERSHIP_MODE=file
export HERBCHAIN_BATCH_LIST_MODE=local
export HERBCHAIN_EVIDENCE_MODE=local
export HERBCHAIN_EVIDENCE_READ_MODE=local
export HERBCHAIN_WRITE_MODE=local
export HERBCHAIN_LOTS_ENABLED=false
node scripts/start-farmer-api.cjs --accounts scripts/participant-accounts.local.json
```

Leave it running. Open `http://127.0.0.1:3002/dashboard` on that computer. `/health` shows API availability only; it does not prove a live Fabric read/write succeeded. Test a new harvest and an independent review to verify the actual network.

## C. Build/open the Android app

Enable Developer options and USB debugging on the phone, attach a data-capable cable and accept the computer's authorization prompt. In **PowerShell**:

```powershell
cd "$HOME\HerbChain"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"
adb devices
adb reverse tcp:3002 tcp:3002
adb reverse tcp:8081 tcp:8081
$env:EXPO_PUBLIC_HERBCHAIN_API_URL = "http://127.0.0.1:3002"
npx expo run:android --device
```

First verify that Windows can open `http://127.0.0.1:3002/health`; USB reversal forwards to Windows, so the WSL API must be reachable there. The first native build downloads dependencies and can take time. Use a physical phone instead of an emulator to reduce laptop load.

If the build specifically fails because `android/app/debug.keystore` is missing, generate a **local debug-only** keystore in PowerShell, then rerun the build:

```powershell
keytool -genkeypair -v -storetype JKS -keystore android/app/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```

Only do this when the file is absent. Debug keystores are excluded from Git. This is not release signing; installing a build with a different signing certificate over an existing installation may require uninstalling the old app, which removes its local data/outbox.

On later runs, with the development app already installed:

```powershell
$env:EXPO_PUBLIC_HERBCHAIN_API_URL = "http://127.0.0.1:3002"
npx expo start --dev-client --localhost
```

If Metro chooses 8082, run `adb reverse tcp:8082 tcp:8082` in a second PowerShell window and open that Metro session. Keep the API and Metro terminals open. Use the native development build, not Expo Go, because this project uses native TFLite modules.

## D. Run the API itself in Docker (optional local pilot)

Start Fabric first. To avoid enabling the unfinished staging configuration, build and run just the API with local modes.

1. In Ubuntu, make a private directory outside Git, for example `~/herbchain-private`.
2. Create `identities.json` there using `server/identities.example.json` as the schema. Configure all intended account UUIDs and `consumer-reader`. Copy the necessary certificate/key/TLS files into that private directory and change every file path in JSON to its **container** path under `/run/herbchain/...`.
3. Set each peer endpoint to `host.docker.internal:7051` or `host.docker.internal:9051` when using Docker Desktop with those peer ports published. Keep the matching TLS `hostOverride` (`peer0.org1.example.com` or `peer0.org2.example.com`) and correct CA certificate. Container `localhost` cannot reach a different peer container. For other Docker installations, use an explicitly configured shared network and reachable peer DNS names instead.
4. Make the mounted files readable by the image's non-root `node` user without making signing keys publicly readable. Resolve host/container ownership or ACLs if necessary.
5. Create a private `api.env` in that directory:

```dotenv
HOST=0.0.0.0
PORT=3002
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_OR_ANON_KEY
FABRIC_IDENTITIES_FILE=/run/herbchain/identities.json
PUBLIC_IDENTITY=consumer-reader
FABRIC_CHANNEL=herbchain
FABRIC_CHAINCODE=herbchain
HERBCHAIN_DATA_DIR=/app/runtime
HERBCHAIN_MEMBERSHIP_MODE=file
HERBCHAIN_BATCH_LIST_MODE=local
HERBCHAIN_EVIDENCE_MODE=local
HERBCHAIN_EVIDENCE_READ_MODE=local
HERBCHAIN_WRITE_MODE=local
HERBCHAIN_LOTS_ENABLED=false
```

Stop any existing API using port 3002. Then, in Ubuntu:

```bash
cd "$HERBCHAIN_ROOT"
docker build -t herbchain-api:local ./server
docker volume create herbchain-api-runtime
docker run -d --name herbchain-api --restart unless-stopped \
  --env-file "$HOME/herbchain-private/api.env" \
  --add-host host.docker.internal:host-gateway \
  -p 127.0.0.1:3002:3002 \
  --mount type=bind,src="$HOME/herbchain-private",dst=/run/herbchain,readonly \
  --mount type=volume,src=herbchain-api-runtime,dst=/app/runtime \
  herbchain-api:local
docker logs --tail 50 herbchain-api
```

This volume starts empty. Existing off-chain evidence is **not** copied automatically; a move of the existing pilot requires restoring its complete evidence directory into the volume with correct ownership before use. Do not run the old and new local APIs concurrently against independent evidence copies for the same pilot.

This command publishes only to the host's loopback interface. It is suitable for local testing, not direct access from a teammate's laptop. Docker preserves the named volume across container restarts; deleting it deletes the stored evidence. This API container starts directly from `server.js` rather than the local launcher, so operate one local-mode API instance per evidence store.

## E. Docker Compose staging deployment

Use `server/deploy/compose.yaml` only after all prerequisites are complete:

- Fabric is reachable from API/worker/indexer containers with matching TLS hostnames and role-bearing identities.
- Supabase migrations `001` through `009` are applied and private server credentials configured.
- Memberships and batch assignments are seeded and tested.
- Existing private evidence is archived and verified before switching to cloud reads.
- Indexer backfill is complete before indexed lists are relied on.
- Queue/worker/reconciliation behavior is validated on a staging network.
- A domain resolves to the host, ports 80/443 reach Caddy, and signing/evidence backups exist.

In Ubuntu:

```bash
cd "$HERBCHAIN_ROOT/server/deploy"
cp runtime.env.example runtime.env
```

Edit `runtime.env` privately. Its `FABRIC_IDENTITIES_FILE=/run/herbchain/identities.json` must refer to the identity configuration inside the mounted directory. All certificate/key paths in that JSON must also exist inside the containers. Keep `HERBCHAIN_LOTS_ENABLED=false` until the deployed contract and lot workflow are verified.

The following two values are Compose interpolation variables and must be set in the shell; the service's `env_file: runtime.env` does not supply them automatically:

```bash
export HERBCHAIN_IDENTITY_DIR="$HOME/herbchain-private"
export HERBCHAIN_DOMAIN=YOUR_REAL_STAGING_DOMAIN
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail 50 api worker indexer proxy
```

Open `https://YOUR_REAL_STAGING_DOMAIN/dashboard`. Do not paste rendered configuration containing secrets into chat. This template was prepared for staging; a successful configuration parse is not proof of a working live deployment. Keep `api-runtime`, Caddy volumes and external Fabric volumes backed up. Do not use `docker compose down -v` when data must be retained.

## F. Preserve old batches when moving computers

Git transfers code. Docker images transfer software. Neither automatically transfers the complete running system.

| Preserve privately | Why |
| --- | --- |
| Fabric peer/orderer volumes and network/channel configuration | Existing ledger and world state |
| CA data and organization MSP/TLS material | Trust roots and enrollment continuity |
| `blockchain/identities/` or equivalent private key store | Existing participant signing identities |
| Entire private `harvest-data` directory or corresponding Docker volume | Original evidence bytes, manifests and operation records |
| Supabase project configuration/database/storage and Auth continuity | Accounts, assignments, indexes, jobs and archived evidence |
| Private account mapping and environment configuration | Bind Auth users to the right signing identities |

Take a consistent backup during a controlled stop of writes, and follow Fabric/Docker backup and restore procedures for the specific network. Do not copy live ledger databases casually. Preserve certificate identities: re-enrolling a similarly named user does not automatically transfer ownership of old batches. When changing Supabase projects, Auth UUID changes also require a planned mapping migration.

An easier first option is to leave the existing network/backend on its current host and let the new devices connect to it. A full network migration is a separate operation from these fresh-demo instructions.

## G. Verify and troubleshoot

Check in this order:

1. `docker ps` shows the expected Fabric containers; `docker version` reaches the intended engine.
2. API `/health` responds, then an authenticated ledger operation succeeds.
3. Farmer can record a new harvest; another verifier can review it.
4. Custody transfer requires the recipient's acceptance.
5. Lab/processing/packaging/delivery work for the correct roles and wrong roles are denied.
6. Public tracing exposes only the intended packaged-batch information.

Local code tests (in their respective directories): `npm test` in `server` and `blockchain/chaincode`; `npm run test:db`, `npm run test:db:evidence`, and `npm run test:db:queue` in `server`. These database tests use in-memory PostgreSQL, not your live Supabase instance.

| Symptom | What to check |
| --- | --- |
| `.api.lock` exists | Read its PID and inspect `ps`, API processes and port 3002. Remove only the lock after confirming no live owner; preserve evidence. |
| Sign-in succeeds but access is denied | Auth UUID mapping, enrolled role, active membership and required assignment |
| Container cannot connect to Fabric | Peer endpoint, Docker network, TLS hostname, mounted certificates and key permissions |
| Old batch missing on a new computer | Fresh ledger versus restored ledger; off-chain evidence and index may also need restoration |
| Phone cannot connect | Windows can reach WSL API; USB authorization; `adb reverse` for API and actual Metro port |
| Email recovery rate limit | Supabase Auth/email configuration; repeated requests do not resolve the limit |

## References

- [Docker Desktop WSL setup](https://docs.docker.com/desktop/features/wsl/)
- [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/networking-how-tos/)
- [Official Fabric installer](https://hyperledger-fabric.readthedocs.io/en/latest/install.html)
- [Expo local native builds](https://docs.expo.dev/guides/local-app-development/)
- [Using Expo development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/)
- [HerbChain change summary](CHANGES-2026-10-02.md)
- [Implementation status and limitations](IMPLEMENTATION-REPORT.md)
