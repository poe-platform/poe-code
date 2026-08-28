import base64
import gzip
import hashlib
import json
import pathlib
import subprocess

OWN=pathlib.Path(__file__).resolve().parent
ROOT=pathlib.Path('/Users/kjopek/Workspace/safe-bash')
sha=lambda data:hashlib.sha256(data).hexdigest()
cohort=json.loads((OWN/'cohort-01.json').read_bytes())
bindings=json.loads((OWN/'BINDINGS.json').read_bytes())
recipe=json.loads((OWN/'RECIPE.json').read_bytes())
for name,expected in recipe['ownedFiles'].items():assert sha((OWN/name).read_bytes())==expected
for name,expected in bindings['priorOwnedHashes'].items():assert sha((ROOT/name).read_bytes())==expected
contents={};captures={}
for name,record in cohort['artifacts'].items():
    data=gzip.decompress(base64.b64decode(record['gzipBase64'],validate=True))
    assert len(data)==record['bytes'] and sha(data)==record['sha256'];contents[name]=data
for name,record in cohort['captures'].items():
    data=gzip.decompress(base64.b64decode(record['gzipBase64'],validate=True))
    assert len(data)==record['bytes'] and sha(data)==record['sha256'];captures[name]=dict(bytes=len(data),sha256=sha(data))
report=json.loads(contents['RESULTS.json'])
roles=[json.loads(line) for line in contents['roles.jsonl'].splitlines()]
loads=[json.loads(line) for line in contents['loads.jsonl'].splitlines()]
assert cohort['exit']==0 and cohort['signal'] is None and cohort['streamsClosed'] and not cohort['faults'] and not cohort['rescues'] and not cohort['survivors']
assert len(report['companions'])==28 and all(row['verdict']=='PASS' for row in report['companions']) and report['accessorCalls']==0
assert len(report['records'])==3 and all(row['verdict']=='PASS' for row in report['records']) and report.get('fatal') is None
assert len(loads)==4 and all(row['wholeModule'] for row in loads)
assert len(cohort['registered'])==3 and all(row['absent'] for row in cohort['registered'].values())
assert cohort['temporaryRootsRemoved'] and all(not pathlib.Path(root).exists() for root in cohort['trees'])
assert len([row for row in roles if row.get('context')=='sourceSpawn' and row.get('verdict')=='dispatched'])==3
assert len([row for row in roles if row.get('context')=='sourceObserver' and row.get('verdict')=='dispatched'])==12
assert not any(row.get('context') in ['sourceSpawn','sourceObserver'] and row.get('verdict')=='rejected' for row in roles)
assert report['counters']['sourceObserver']=={'admitted':18,'dispatched':12}
cases=[]
for row in report['records']:
    name=row['id'];receipt=row['receipt'];identity=row['identity'];registered=cohort['registered'][name]
    assert identity==registered['identity'] and row['absent'] and row['closed'] and receipt['captureClosed'] and not row['infrastructureFailure']
    assert json.loads(contents[name+'.identity.json'])['registeredBeforeFaultInjection'] is True
    assert sha(contents[name+'.identity.json'])==registered['sourceFileSha256']
    assert base64.b64decode(row['stdout'])==contents[name+'.stdout']==b'owned-out\n'
    assert base64.b64decode(row['stderr'])==contents[name+'.stderr']==b'owned-err\n'
    if name=='A01':assert receipt['status']==0 and receipt['signal'] is None and receipt['clean'] and not receipt['faults']
    if name=='A02':assert receipt['status'] is None and receipt['signal']=='SIGTERM' and row['faultIdentities']==['null','undefined','secondary','secondary'] and not receipt['clean']
    if name=='A03':assert receipt['status']==0 and receipt['signal'] is None and receipt['observability']=='UNKNOWN' and not receipt['clean'] and not receipt['signals']
    cases.append(dict(id=name,verdict=row['verdict'],identity=identity,status=receipt['status'],signal=receipt['signal'],closed=receipt['closed'],captureClosed=receipt['captureClosed'],observability=receipt['observability'],clean=receipt['clean'],faultIdentities=row['faultIdentities'],signals=receipt['signals'],stdoutBytes=10,stderrBytes=10,externallyAbsent=True))
files={row['path'].split('/')[-1]:row['sha256'] for row in bindings['files']}
result=dict(schema=2,verdict='H11_SCOPED_QUALIFIED_ACCEPTANCE',source=bindings['source'],authorHarness=bindings['harness'],authorEvidence=bindings['evidence'],recipeCommit=cohort['recipeCommit'],priorSeal=bindings['priorSeal'],driverSha256=bindings['driverSha256'],effectiveProfileSha256=bindings['effectiveProfileSha256'],historicalEligibilitySha256='519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6',candidate=bindings['candidate'],packageSha256=bindings['packageSha256'],
    bindings=dict(count=41,unchangedFromE35=39,allowedChanges=bindings['changedShipping'],supervisor=files['supervise.mjs'],osFenceSource=files['os-instruction-fence.mjs'],osFenceIdentityRaw=files['OS-INSTRUCTION-FENCE.json'],toolRoutesRaw=files['TOOL-ROUTES.json'],projectionRaw=files['INSTRUCTION-PROJECTION.json'],externalEncoded=files['EXTERNAL.json.gz.base64'],renderedOwnedRootsProfile=report['profileSha256']),
    newCounts=dict(actualChildPass=3,actualChildFail=0,actualChildUnexecuted=0,comparatorDataPass=22,collectorDataPass=6,dataFail=0,getterInvocations=0,retainedProofReruns=0),
    originalCountsUnchanged=dict(passCount=15,harnessFail=1,unexecuted=2,coordinatorExit=1,targetChildren=0),actualCases=cases,roleCounters=report['counters'],parentObserverCalls=cohort['parentObserverCalls'],roleJournalRows=len(roles),
    coordinator=dict(identity=cohort['coordinatorIdentity'],exit=cohort['exit'],signal=cohort['signal'],elapsedSeconds=cohort['elapsedSeconds'],streamsClosed=cohort['streamsClosed'],captures=captures),
    closure=dict(controllerIdentity=cohort['controllerIdentity'],registeredOwnedChildren=3,rescues=0,survivors=[],temporaryRootsRemoved=True,priorArtifactsUnchanged=505,indexDuringCohortUnchanged=cohort['indexBeforeSha256']==cohort['indexAfterSha256']),
    rawIntegrity=dict(artifactsVerified=len(contents),coordinatorStreamsVerified=2,cohortSha256=sha((OWN/'cohort-01.json').read_bytes()),loads=loads,roleJournalSha256=sha(contents['roles.jsonl']),accessorSentinel=0),
    metadataValidationHistory=['First inline post-run JSON validator stopped with KeyError: fatal; JSON.stringify omitted the undefined field. No evidence files or runtime were changed.', 'This data-only validator uses optional-field lookup AND requires actual exit0/all case outcomes/closure. No runtime retry.'],
    composedObligations=[dict(obligation='H11 synthetic/source',status='15_SCOPED_PROOFS_RETAINED_NOT_RERUN',evidence=bindings['priorSeal']),dict(obligation='H11 actual A01/A02/A03',status='3_PASS_NEW_COHORT'),dict(obligation='Original A01 failure/A02-A03 unexecuted',status='HISTORICAL_UNRESCORED'),dict(obligation='H06 dual private error',status='SOURCEQUALIFIED_ACTUAL_UNEXECUTED',condition='terminal persistence succeeds')],
    qualifications=['Whole unchanged shipping supervisor linked through role-checked spawn and shipping-rendered OS profile; not complete phase IPC integration.', 'Bounded owned PID/birth/PGID observations, not universal background closure or kernel-hard deadline.', 'A02 signal receipt born=null reflects injected observer unavailability; actual external birth and owned handle separately bound.', 'Existing library/OS metadata exceptions carried only; no fresh full tool/native semantic/OS attestation.', 'No private/setup/build/A10/pack/chmod/fullgate execution or original40/consumed0of14 rescore.'],rootReleaseIssued=False)
text=json.dumps(result,indent=2)+'\n'
patch='*** Begin Patch\n*** Add File: '+str((OWN/'RESULTS.json').relative_to(ROOT))+'\n'+''.join('+'+line+'\n' for line in text.splitlines())+'*** End Patch\n'
subprocess.run(['apply_patch'],input=patch.encode(),cwd=ROOT,check=True)
print(json.dumps(dict(actual=3,comparator=22,collector=6,roleRows=len(roles),artifactsVerified=len(contents),exit=cohort['exit'],rescue=0,priorUnchanged=505)))
