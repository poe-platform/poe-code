import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const ELIGIBILITY_PROFILE='unified76-historical-file-authority-20260828-v1';
export const STRICT_PROFILE_SHA256='8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f';
export const HISTORICAL_BINDING=Object.freeze({
  attempt:'55db52a45e583017fba50c02ad64bddce2feb251',
  consumedAuthorization:'c222e17c4cbcc6bcb9da8a77414b90af3c465d88',
  source:'tests/integration/full-gate-20260827/unified76-driver/released-run-v2/raw-v1/native-fixture-authority.json.gz',
  compressedSha256:'bb9902f69536f9dfd1b8fe69247fbc3c146536cd40a15bf1af2950017bde8600',
  decodedSha256:'9f018b4e8bae9f4ce0df48d65c25ecd4693b3b0929687a02f40c3b441ee21cb9',
  decodedBytes:6659,
  observationDate:'2026-08-28',
  attemptStartedAt:'2026-08-28T11:01:53.330Z',
  attemptFinishedAt:'2026-08-28T11:02:47.868Z',
  candidate:'f5e9fc49b6abb38e180cc9de16c95fced102ff75',
  driverSource:'02a5060019bccdd2a64f9811812104ba09d2aaee',
  driverReseal:'96daebc077381fb63ab6447a26ab707ce790ff25',
  executable:'/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod',
  executableSha256:'3b7a9b5819dd93eff18b25dfbbac1c1d17e2ccd419368da90b366653b1b1cbd2',
  temporary:'/private/tmp/unified76-os-write-HzSPPY/tmp/unified76-execution-IO6zT7',
  os:'macOS 26.4.1 / 25E253',
  renderedFenceSha256:'9fa2711b789d1f8d7cbc83b78a182eb3f83b6644aa1f8bba2568055d24a53faf',
  denialOrigin:'UNKNOWN',
});

export function validateAuthorityRecord(record){
  assert.equal(record.uid,501);assert.equal(record.gid,20);
  assert.ok(record.groups.includes(record.gid));assert.equal(record.umask,'22');
  assert.deepEqual(record.probes.map(row=>row.mode),['2755','6755']);
  assert.deepEqual(record.issues.map(row=>[row.kind,row.mode]),[['native-fixture-authority','2755'],['native-fixture-authority','6755']]);
  for(const probe of record.probes){
    const path=`${HISTORICAL_BINDING.temporary}/native-tmp/authority-${probe.mode}`;
    const identity={path,uid:501,gid:20,mode:'644',directory:false,symlink:false};
    assert.deepEqual(probe.before,identity);assert.deepEqual(probe.after,identity);
    assert.deepEqual(probe.execution,{command:[HISTORICAL_BINDING.executable,probe.mode,path],cwd:HISTORICAL_BINDING.temporary+'/source',status:1,signal:null,stdout:'',stderr:`chmod: changing permissions of '${path}': Operation not permitted\n`});
    assert.deepEqual(record.issues.find(row=>row.mode===probe.mode),{kind:'native-fixture-authority',mode:probe.mode,before:probe.before,after:probe.after,execution:probe.execution});
  }
  return record;
}

export function decodeEligibility(policy){
  assert.deepEqual(Object.keys(policy).sort(),['binding','captureBase64','profile','schema']);
  assert.equal(policy.schema,1);assert.equal(policy.profile,ELIGIBILITY_PROFILE);
  assert.deepEqual(policy.binding,HISTORICAL_BINDING);
  assert.equal(typeof policy.captureBase64,'string');assert.ok(policy.captureBase64.length>0&&policy.captureBase64.length<=32768);
  const compressed=Buffer.from(policy.captureBase64,'base64');
  assert.equal(compressed.toString('base64'),policy.captureBase64,'canonical capture encoding');
  assert.equal(digest(compressed),HISTORICAL_BINDING.compressedSha256,'historical compressed bytes');
  const decoded=gunzipSync(compressed,{maxOutputLength:16384});
  assert.equal(decoded.length,HISTORICAL_BINDING.decodedBytes);assert.equal(digest(decoded),HISTORICAL_BINDING.decodedSha256,'historical decoded bytes');
  const record=validateAuthorityRecord(JSON.parse(decoded));
  return {profile:ELIGIBILITY_PROFILE,policySha256:digest(JSON.stringify(policy)),binding:{...HISTORICAL_BINDING},
    status:'HISTORICAL_UNQUALIFIED',freshCapabilityClaim:false,admissionProbesRepeated:false,
    nativeSemanticPassCount:null,automaticTestAttribution:false,canonicalSelectionChanged:false,
    obligations:record.probes.map(probe=>({id:`NA-${probe.mode}`,observation:'HISTORICAL',status:'UNSUPPORTED_HOST_OPERATION',nativeParity:'UNQUALIFIED',scope:'the recorded FILE operation only',original:probe})),
    original:record};
}

export function readHistoricalEligibility(){
  const path=new URL('./ELIGIBILITY.json',import.meta.url),stat=lstatSync(path);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=65536,'bounded regular historical policy');
  return decodeEligibility(JSON.parse(readFileSync(path)));
}

export function validateEligibilityProfile(profile){
  const {historicalEligibility,...strict}=profile;
  assert.equal(digest(JSON.stringify(strict)),STRICT_PROFILE_SHA256,'strict source/profile inputs unchanged');
  assert.deepEqual(historicalEligibility,readHistoricalEligibility(),'exact prospective historical profile');
  return profile;
}

export function requireEligibilityRelease(receipt,profile){
  validateEligibilityProfile(profile);
  assert.equal(receipt.eligibilityProfile,ELIGIBILITY_PROFILE);
  assert.equal(receipt.historicalEligibilitySha256,digest(JSON.stringify(profile.historicalEligibility)));
  assert.equal(receipt.acceptsUnqualifiedHistoricalNative,true);
}

export function historicalVerdict(report){
  try{
    const expected=readHistoricalEligibility();
    assert.deepEqual(report.historicalEligibility,expected,'missing or changed historical eligibility receipt');
    return {valid:true,obligations:expected.obligations.map(({id,status,nativeParity,observation})=>({id,status,nativeParity,observation})),problems:expected.obligations.map(row=>`${row.id}: HISTORICAL UNSUPPORTED_HOST_OPERATION; native parity UNQUALIFIED`)};
  }catch(error){return {valid:false,obligations:[],problems:[`historical eligibility invalid: ${error.message}`]};}
}
