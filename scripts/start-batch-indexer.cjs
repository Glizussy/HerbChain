'use strict';
// Run in Ubuntu; read-only Fabric identity, writes only the database projection.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const {parseEnv}=require('node:util');
const root=process.env.HERBCHAIN_ROOT||path.resolve(__dirname, '..');
const samples=process.env.FABRIC_SAMPLES||path.join(os.homedir(),'herbchain-fabric/fabric-samples');
const msp=path.join(root,'blockchain/identities/reader1/msp');
const keys=fs.readdirSync(path.join(msp,'keystore')).filter(n=>fs.statSync(path.join(msp,'keystore',n)).isFile());
if(keys.length!==1)throw Error('Expected one reader signing key');
const identity={mspId:'Org2MSP',certificate:path.join(msp,'signcerts/cert.pem'),privateKey:path.join(msp,'keystore',keys[0]),tlsCertificate:path.join(samples,'test-network/organizations/peerOrganizations/org2.example.com/tlsca/tlsca.org2.example.com-cert.pem'),endpoint:'localhost:9051',hostOverride:'peer0.org2.example.com'};
const env=parseEnv(fs.readFileSync(path.join(root,'.env'),'utf8'));
require(path.join(root,'server/src/indexer-runner')).start({identity,url:env.EXPO_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY}).catch(error=>{console.error(error.message);process.exitCode=1;});
