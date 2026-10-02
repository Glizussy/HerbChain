#!/usr/bin/env bash
set -euo pipefail
# Run in WSL after test-network/network.sh up createChannel -c herbchain -ca.
# Does not recreate a network or overwrite an enrolled identity.
: "${FABRIC_SAMPLES:?Set absolute path to fabric-samples}"
: "${HERBCHAIN_ROOT:?Set absolute path to HerbChain}"
role="${1:?Usage: bash enroll-pilot.sh ROLE NAME}"
name="${2:?Provide a unique enrollment name}"
[[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid name'; exit 1; }
case "$role" in
  collector|aggregator|processor|manufacturer|distributor) org=org1; port=7054 ;;
  verifier|lab|regulator|reader) org=org2; port=8054 ;;
  *) echo 'Unknown role'; exit 1 ;;
esac
export PATH="$FABRIC_SAMPLES/bin:$PATH"
network="$FABRIC_SAMPLES/test-network"
export FABRIC_CA_CLIENT_HOME="$network/organizations/peerOrganizations/$org.example.com"
tls="$network/organizations/fabric-ca/$org/tls-cert.pem"
destination="$HERBCHAIN_ROOT/blockchain/identities/$name/msp"
[[ ! -e "$destination" ]] || { echo 'Identity directory exists; refusing overwrite'; exit 1; }
read -r -s -p 'Choose enrollment secret (letters and digits only): ' secret
echo
[[ "$secret" =~ ^[a-zA-Z0-9]{16,}$ ]] || { echo 'Use at least 16 letters/digits'; exit 1; }
fabric-ca-client register --caname "ca-$org" --id.name "$name" --id.secret "$secret" \
  --id.type client --id.attrs "herbchain.role=$role:ecert" --tls.certfiles "$tls"
fabric-ca-client enroll -u "https://$name:$secret@localhost:$port" --caname "ca-$org" \
  -M "$destination" --tls.certfiles "$tls"
cp "$FABRIC_CA_CLIENT_HOME/msp/config.yaml" "$destination/config.yaml"
unset secret
echo "Enrolled $name with role $role. Configure its certificate and key paths on the backend only."
