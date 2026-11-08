import base64
import datetime
import gzip
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess

ROOT=pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN=ROOT/'tests/integration/full-gate-20260827/unified76-driver-independent/release-packet-v18'
PACKET_COMMIT='69f5cc1b05484c9d0836edf77bfbbbfb46145383'
PACKET_DIR='tests/integration/full-gate-20260827/unified76-driver/release-packet-v4-qualified-h11/'
SOURCE='f03c260269dfd8ee10666f7fd2560655f8e14a38'
SHIPPING='tests/integration/full-gate-20260827/unified76-driver/launcher-v3/'
REVIEW='652b76f4af9a03ba1fe0d8f90ca5128463f9e34b'

def git(*args):
    return subprocess.check_output(['git','--no-replace-objects',*args],cwd=ROOT,timeout=20)

def blob(revision,path):
    assert all(part.lower()!='agents.md' for part in path.split('/'))
    return git('show',revision+':'+path)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def normalized(value):
    return sha(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode())

def record(revision,path):
    data=blob(revision,path)
    mode,kind,object_id=git('ls-tree',revision,'--',path).decode().split('\t')[0].split()
    assert kind=='blob' and mode in ['100644','100755']
    return dict(path=path,revision=revision,blob=object_id,mode=mode,bytes=len(data),sha256=sha(data))

packet_bytes=blob(PACKET_COMMIT,PACKET_DIR+'PACKET.json')
packet=json.loads(packet_bytes)
assert normalized(packet)=='d236cc7723dfaf860e3e70cda1d04bff2f46950c54c845d8ac0184e969296b00'
seal=json.loads(blob(PACKET_COMMIT,PACKET_DIR+'SEAL.json'))
assert seal['packetNormalizedSha256']==normalized(packet)
packet_files=[]
for expected in seal['files']:
    actual=record(PACKET_COMMIT,expected['path'])
    assert actual['bytes']==expected['bytes'] and actual['sha256']==expected['sha256'] and int(actual['mode'],8)&0o777==int(expected['mode'],8)
    packet_files.append(actual)
shipping=[];proofs=[]
for expected in packet['driver']['files']:
    assert expected['revision']==SOURCE
    actual=record(expected['revision'],expected['path']);assert actual==expected;shipping.append(actual)
for expected in packet['independent']['proofFiles']:
    actual=record(expected['revision'],expected['path']);assert actual==expected;proofs.append(actual)
assert len(shipping)==41 and len(proofs)==35
assert len({row['path'] for row in shipping})==41 and len({(row['revision'],row['path']) for row in proofs})==35
driver=json.loads(blob(SOURCE,SHIPPING+'DRIVER.json'))
assert normalized(driver)==packet['driver']['normalizedSha256']=='aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424'
assert set(row['path'][len(SHIPPING):] for row in shipping)=={'DRIVER.json',*driver['files']}
for row in shipping:
    name=row['path'][len(SHIPPING):]
    if name!='DRIVER.json':assert driver['files'][name]==row['sha256']
changed=[row['path'][len(SHIPPING):] for row in shipping if sha(blob('e35d83ca97f6aa4f32b2cb8542f5e711458f6aeb',row['path']))!=row['sha256']]
assert sorted(changed)==['DRIVER.json','supervise.mjs']
accepted=json.loads(blob(REVIEW,'tests/integration/full-gate-20260827/unified76-driver-independent/supervisor-repair-v17/continuation-v2/BINDINGS.json'))
assert {row['path']:row['sha256'] for row in shipping}=={row['path']:row['sha256'] for row in accepted['files']}

encoded=blob(SOURCE,SHIPPING+'PROFILE.json.gz.base64')
profile_receipt=json.loads(blob(SOURCE,SHIPPING+'PROFILE-RECEIPT.json'))
assert sha(encoded)==profile_receipt['encodedSha256']
decoded=gzip.decompress(base64.b64decode(encoded));assert len(decoded)<32*1024*1024
strict=json.loads(decoded);assert sha(decoded)==normalized(strict)==profile_receipt['profileSha256']==packet['profile']['strictNormalizedSha256']
eligibility_policy=json.loads(blob(SOURCE,SHIPPING+'ELIGIBILITY.json'))
captured=gzip.decompress(base64.b64decode(eligibility_policy['captureBase64']))
binding=eligibility_policy['binding'];original=json.loads(captured)
assert len(captured)==binding['decodedBytes'] and sha(captured)==binding['decodedSha256']
assert sha(base64.b64decode(eligibility_policy['captureBase64']))==binding['compressedSha256']
assert [row['mode'] for row in original['probes']]==['2755','6755'] and len(original['issues'])==2
for probe in original['probes']:
    target=binding['temporary']+'/native-tmp/authority-'+probe['mode']
    expected_identity=dict(path=target,uid=501,gid=20,mode='644',directory=False,symlink=False)
    assert probe['before']==probe['after']==expected_identity
    assert probe['execution']==dict(command=[binding['executable'],probe['mode'],target],cwd=binding['temporary']+'/source',status=1,signal=None,stdout='',stderr="chmod: changing permissions of '"+target+"': Operation not permitted\n")
historical=dict(profile=eligibility_policy['profile'],policySha256=normalized(eligibility_policy),binding=binding,status='HISTORICAL_UNQUALIFIED',freshCapabilityClaim=False,admissionProbesRepeated=False,nativeSemanticPassCount=None,automaticTestAttribution=False,canonicalSelectionChanged=False,
    obligations=[dict(id='NA-'+probe['mode'],observation='HISTORICAL',status='UNSUPPORTED_HOST_OPERATION',nativeParity='UNQUALIFIED',scope='the recorded FILE operation only',original=probe) for probe in original['probes']],original=original)
assert historical==packet['profile']['historicalEligibility']
assert normalized(historical)=='519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6'
effective={**strict,'historicalEligibility':historical}
assert normalized(effective)==packet['profile']['normalizedSha256']==driver['profileSha256']=='fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510'
candidate=packet['product']['candidate'];assert candidate==strict['candidate']=='f5e9fc49b6abb38e180cc9de16c95fced102ff75'
assert packet['product']['expectedPackageSha256']==strict['expectedPackageSha256']=='c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd'
assert git('rev-parse',candidate+'^{tree}').decode().strip()==packet['product']['tree']==strict['tree']
assert git('rev-parse',candidate+':src').decode().strip()==packet['product']['sourceTree']==strict['sourceTree']
assert sha(blob(candidate,'package.json'))==packet['product']['packageManifestSha256']==strict['packageManifestSha256']
tree=[]
for item in git('ls-tree','-r','-z','-l',candidate).split(b'\0'):
    if not item:continue
    metadata,name=item.split(b'\t',1);mode,kind,object_id,length=metadata.decode().split()
    assert kind=='blob'
    tree.append(dict(path=name.decode(),mode=mode,blob=object_id,bytes=int(length)))
assert tree==strict['scopeInputs']
canonical=sorted(row['path'] for row in tree if re.fullmatch(r'tests/.*\.test\.ts',row['path']) and not row['path'].startswith('tests/commands/regex-execution/continuation/artifacts/native/'))
assert canonical==strict['canonicalFiles'] and len(canonical)==632
tree_map={row['path']:row for row in tree};canonical_records=[]
for path in canonical:
    data=blob(candidate,path);entry=tree_map[path]
    assert len(data)==entry['bytes'] and hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==entry['blob']
    canonical_records.append({**entry,'sha256':sha(data)})
candidate_receipt=json.loads(blob(SOURCE,SHIPPING+'CANDIDATE.json'))
fixture_paths=git('diff','--name-only',packet['product']['base'],candidate).decode().splitlines()
assert len(fixture_paths)==4
assert len(strict['native'])==51 and len(strict['classifiedMts'])==192 and len(strict['cleanup']['files'])==256
assert len(packet['tools']['nativeAssets'])==51
assert normalized(json.loads(blob(SOURCE,SHIPPING+'TOOL-ROUTES.json')))==packet['tools']['routesNormalizedSha256']=='b440b32475d24642d0fbe5dc222356ac1f209a11597baa07d63d286b06b68ca9'
assert normalized(json.loads(blob(SOURCE,SHIPPING+'INSTRUCTION-PROJECTION.json')))==packet['projection']['normalizedSha256']=='b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb'
assert sha(blob(SOURCE,SHIPPING+'os-instruction-fence.mjs'))=='1955d2225312f57dfd4f7cb4a122e4d940caf997aea9ba4aa4c85f85558bac69'
helper=packet['helper'];assert record(helper['revision'],helper['path'])==helper
assert helper['sha256']=='60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db'

policy=blob(SOURCE,SHIPPING+'policy.mjs').decode()
phase_text=policy.split('export const PHASES = Object.freeze([')[1].split('].map')[0]
phases=[dict(name=name,expectedStatus=int(status)) for name,status in re.findall(r"\['([^']+)',\s*(\d+)\]",phase_text)]
assert phases==packet['phases'] and len(phases)==14
constant_text=policy.split('export const BOUNDS = Object.freeze({')[1].split('});')[0]
bounds={}
for key,expression in re.findall(r'(\w+):\s*([\d *]+),',constant_text):
    value=1
    for factor in expression.split('*'):value*=int(factor.strip())
    bounds[key]=value
assert all(packet['bounds'][key]==value for key,value in bounds.items())
assert packet['bounds']['totalSupervisorMs']==bounds['setupTimeoutMs']+len(phases)*bounds['phaseTimeoutMs']+bounds['cleanupTimeoutMs']==25805000
assert packet['bounds']['maintainedConsumerTimeoutMs']==900000
assert 'exitCode:1' in policy and "for (const name of ['fail', 'skipped', 'todo', 'cancelled'])" in policy
run=blob(SOURCE,SHIPPING+'run.mjs').decode()
assert run.index('await verifyExternal()')<run.index('requireRelease(JSON.parse')<run.index('const outer=mkdtempSync')<run.index('await superviseFencedWorker')
assert 'return result.status===78?78:1' in run and "if(import.meta.main)" in run
launch_text=blob(PACKET_COMMIT,PACKET_DIR+'LAUNCH.md').decode()
command=launch_text.split('```sh\n')[1].split('```')[0].replace('\\\n','')
tokens=shlex.split(command);launch=packet['launch']
assert tokens[3:]==[launch['executable']['origin'],launch['script'],*launch['args']]
assert tokens[0]=='GIT_PAGER=' and tokens[1].startswith('RG_NATIVE_BIN=') and tokens[2].startswith('TREE_NATIVE_BIN=')
assert launch['args']==['--candidate',candidate,'--run',launch['output'],'--release',launch['authorizationFile'],'--committed-archive']
assert tokens.count('--run')==1 and not any(value in tokens for value in [';','&&','||','for','while'])
assert re.fullmatch(r'/tmp/full-gate-unified76-[A-Za-z0-9_-]+',launch['output'])
paths=[]
for name in [launch['output'],launch['physicalOutput'],launch['authorizationFile'],'/private/tmp/'+pathlib.Path(launch['authorizationFile']).name]:
    try:os.lstat(name)
    except FileNotFoundError:paths.append(dict(path=name,absent=True))
    else:raise AssertionError('future path already exists: '+name)
assert str(pathlib.Path(launch['output']).parent.resolve()/pathlib.Path(launch['output']).name)==launch['physicalOutput']
template=json.loads(blob(PACKET_COMMIT,PACKET_DIR+'ROOT-RECEIPT.template.json'))
assert template['action']=='AWAITING_FRESH_ROOT_RELEASE' and template['authorization']==''
assert template['candidate']==candidate and template['driverSha256']==normalized(driver) and template['profileSha256']==normalized(effective) and template['packageSha256']==strict['expectedPackageSha256']
for key in ['public74','public75','public76','independentDriverAccepted','acceptsUnqualifiedHistoricalNative']:assert template[key] is True
assert template['historicalEligibilitySha256']==normalized(historical) and template['eligibilityProfile']==historical['profile']
assert template['packetSha256']==normalized(packet) and template['evidenceBindings']==proofs
assert REVIEW in template['independentEvidence'] and template['independentEvidence'].strip()
assert packet['independent']['acceptedCommit']==REVIEW
assert 'UNEXECUTED' in packet['policies']['H06'] and 'IF terminal persistence succeeds' in packet['policies']['H06']
assert packet['executionAuthorized'] is False and packet['fullGateLaunched'] is False
assert [row['originalPhases'] for row in packet['supersedes']['consumedAttempts']]==[0,0]
live=[]
for row in shipping:
    file=ROOT/row['path'];stat=file.lstat()
    live.append(dict(path=row['path'],regular=file.is_file() and not file.is_symlink(),matches=sha(file.read_bytes())==row['sha256'],mode=oct(stat.st_mode&0o777)))
assert all(row['regular'] and row['matches'] for row in live)
prior_paths=git('ls-tree','-r','--name-only',REVIEW,'--','tests/integration/full-gate-20260827/unified76-driver-independent/').decode().splitlines()
for path in prior_paths:assert sha((ROOT/path).read_bytes())==sha(blob(REVIEW,path))
result=dict(schema=1,verdict='ACCEPT_READY_FOR_FRESH_ROOT_AUTHORIZATION_NOT_RELEASE',observedAt=datetime.datetime.now().astimezone().isoformat(),packetCommit=PACKET_COMMIT,packetNormalizedSha256=normalized(packet),packetRawSha256=sha(packet_bytes),source=SOURCE,acceptedH11Review=REVIEW,criteriaCommit='1a524e25c2cff12dc0f3a444e1d22c1a6b65e7f8',packetFiles=packet_files,shipping=shipping,proofFiles=proofs,shippingCount=41,proofCount=35,unchangedFromE35=39,changedFromE35=changed,
    driverNormalizedSha256=normalized(driver),strictProfileSha256=normalized(strict),effectiveProfileSha256=normalized(effective),historicalEligibilitySha256=normalized(historical),eligibilityProfile=historical['profile'],profileComposition='strict parsed object followed by historicalEligibility decoded from authenticated ELIGIBILITY.json; no module import',historicalRows=[{key:row[key] for key in ['id','observation','status','nativeParity','scope']} for row in historical['obligations']],
    candidate=candidate,packageSha256=strict['expectedPackageSha256'],fixturePaths=fixture_paths,canonicalCount=632,canonicalMembershipBodySha256=normalized(canonical_records),canonicalRecords=canonical_records,scopeMetadataCount=len(tree),helper=helper,phases=phases,bounds=packet['bounds'],commandTokens=tokens,launchPath=PACKET_DIR+'LAUNCH.md',commandLines=[118,126],futurePaths=paths,templateInvalid=True,authorizationPrecedence=['external preflight','requireRelease','outer root creation','fenced worker dispatch/materialization'],H06=packet['policies']['H06'],originalCohorts=packet['independent']['cohorts'],consumedAttempts=packet['supersedes']['consumedAttempts'],livePointInTimeOnly=live,priorArtifactCountUnchanged=len(prior_paths),noExecutableImports=True,noControlsOrGate=True,noToolsProbed=True,objections=[])
text=json.dumps(result,indent=2)+'\n'
patch='*** Begin Patch\n*** Add File: '+str((OWN/'VERIFICATION.json').relative_to(ROOT))+'\n'+''.join('+'+line+'\n' for line in text.splitlines())+'*** End Patch\n'
subprocess.run(['apply_patch'],input=patch.encode(),cwd=ROOT,check=True)
print(json.dumps({key:result[key] for key in ['verdict','packetNormalizedSha256','packetRawSha256','shippingCount','proofCount','canonicalCount','canonicalMembershipBodySha256','priorArtifactCountUnchanged']}))
