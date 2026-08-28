import pathlib,json,hashlib,base64,gzip,stat,subprocess,datetime,time,shutil,collections
ROOT=pathlib.Path(__file__).resolve().parent
REPO=ROOT.parents[3]
START=time.monotonic_ns()
sha=lambda data:hashlib.sha256(data).hexdigest()
def add(name,value):
 text=value if isinstance(value,str) else json.dumps(value,indent=2)+'\n'
 patch='*** Begin Patch\n*** Add File: '+str((ROOT/name).relative_to(REPO))+'\n'+''.join('+'+line+'\n' for line in text.splitlines())+'*** End Patch\n'
 subprocess.run(['apply_patch'],input=patch,text=True,check=True,cwd=REPO)
def census(root):
 rows=[]
 for path in pathlib.Path(root).rglob('*'):
  assert 'AGENTS.md' not in path.parts
  info=path.lstat();mode=stat.S_IMODE(info.st_mode)
  if path.is_symlink():rows.append({'path':str(path),'type':'link','mode':mode,'link':str(path.readlink()),'realpath':str(path.resolve())})
  elif path.is_dir():rows.append({'path':str(path),'type':'directory','mode':mode})
  else:assert path.is_file();rows.append({'path':str(path),'type':'file','mode':mode,'bytes':info.st_size,'sha256':sha(path.read_bytes())})
 return rows
def canonical(rows):
 tuples=[]
 for row in sorted(rows,key=lambda row:row['path'].encode('utf8')):
  values=[row['path'].encode('utf8').hex(),row['type'],row['mode']]
  if row['type']=='file':values.extend([row['bytes'],row['sha256']])
  if row['type']=='link':values.extend([row['link'].encode('utf8').hex(),row['realpath'].encode('utf8').hex()])
  tuples.append(values)
 return b'M1A-CENSUS-v12\0'+json.dumps(tuples,separators=(',',':')).encode()+b'\n'
seal=json.loads((ROOT/'PRESEAL.json').read_text()); result=json.loads((ROOT/'RUN-01/capture/RESULT.json').read_text()); outer=json.loads((ROOT/'TARGET-01/receipt.json').read_text())
report={'role':'POST_TARGET_DATA_AUDIT_NO_EXECUTION_RETRY','status':result['status'],'outerStatus':outer['status'],'atWall':datetime.datetime.now(datetime.timezone.utc).isoformat(),'layouts':[],'mutants':[],'restores':[],'types':result['types'],'bindings':result['bindings'],'guards':result['guards'],'layoutEquality':result['layoutEquality'],'unrunRoles':result['unrunRoles'],'sourceGuards':[],'sealedFilesUnchanged':True,'children':[],'toolReceipts':[]}
for row in seal['files']:assert sha((ROOT/row['path']).read_bytes())==row['sha256']
for binding in seal['censuses']:
 actual=census(binding['root']);digest=sha(canonical(actual));assert digest==binding['canonicalSha256']
 report['sourceGuards'].append({'root':binding['root'],'entries':len(actual),'canonicalSha256':digest,'unchanged':True})
for child in result['children']:
 assert child['cleanupSettled'] and not child['unknownClosure'] and child['exit']['signal'] is None and not child['signals']
 for name in ['stdout','stderr']:
  entry=child[name];data=pathlib.Path(entry['path']).read_bytes();assert len(data)==entry['bytes'] and sha(data)==entry['sha256']
 report['children'].append({key:child.get(key) for key in ['number','id','kind','pid','exit','close','signals','cleanupSettled','stdoutClosed','stderrClosed','enrollment']})
 if child['kind'] in ['tool','type']:
  receipt=json.loads((ROOT/'RUN-01/capture'/f"{child['id']}-tool.json").read_text());assert receipt['nestedProcessAttempts']==0 and receipt['networkAttempts']==0;report['toolReceipts'].append(receipt)
for kind,items in [('layouts',result['layouts']),('mutants',[row['report'] for row in result['mutants']]),('restores',[row['report'] for row in result['restores']])]:
 for layout in items:
  rows=[json.loads(line) for line in pathlib.Path(layout['outputPath']).read_text().splitlines()];cases=[row for row in rows if row.get('kind')=='case'];snaps=[row['lifecycle']['afterNotification'] for row in cases]
  resources=[resource for snap in snaps for resource in snap['resources']];contexts=[context for snap in snaps for context in snap['contexts']];registrations=[reg for context in contexts for reg in context['registrations']]
  assert all(snap['verdict']=='PASS' and snap['valid'] and not snap['overflow'] for snap in snaps)
  loads=[json.loads(line) for line in pathlib.Path(layout['loadsPath']).read_text().splitlines()];modules=[row for row in loads if row['kind']=='module']
  observations=[observation for row in cases for observation in row['observations']]
  calls=[call for observation in observations for call in observation.get('calls',[])]
  report[kind].append({'layout':layout['layout'],'cases':len(cases),'passed':layout['passed'],'failed':layout['failed'],'caseMembership':layout['cases'],'observations':len(observations),'contexts':len(contexts),'directSessionsJoined':sum(len(snap['directSessions']) for snap in snaps),'streams':len(resources),'closed':sum(resource['closed'] for resource in resources),'destroyed':sum(resource['destroyed'] for resource in resources),'closeDelivered':sum(resource['closeDelivered'] for resource in resources),'writeRequests':sum(resource['writes'] for resource in resources),'rawWriteCallbacks':sum(resource['callbacks'] for resource in resources),'rawCallbacksPendingDiagnostic':sum(resource['rawCallbacksPendingDiagnostic'] for resource in resources),'registeredCallbacks':len(registrations),'fulfilledRegistrations':sum(reg['settled'] and not reg['rejected'] for reg in registrations),'noHookOrNoRegistrationContexts':sum(not context['registrations'] for context in contexts),'ownedIteratorReturns':sum(resource['returnCalls'] for resource in resources),'ownedErrorEvents':sum(error['owned'] for resource in resources for error in resource['errors']),'sourceQualifiedErrorEvents':sum(error['sourceQualified'] for resource in resources for error in resource['errors']),'unknownErrors':sum(not error['owned'] and not error['sourceQualified'] for resource in resources for error in resource['errors']),'afterExecuteOwnedErrors':sum(error['owned'] and error['afterExecute'] for resource in resources for error in resource['errors']),'maximumUnobservedCloseNotificationsAtOutcome':max(sum(not resource['closeDelivered'] for resource in row['lifecycle']['beforeNotification']['resources']) for row in cases),'maximumNotClosedAtOutcome':max(sum(not resource['closed'] for resource in row['lifecycle']['beforeNotification']['resources']) for row in cases),'maximumTraceEvents':max(row['lifecycle']['trace']['count'] for row in cases),'maximumIdentityCount':max(row['lifecycle']['trace']['identityCount'] for row in cases),'filesystemCallEntries':len(calls),'filesystemCallKinds':dict(collections.Counter(call['op'] if isinstance(call,dict) and 'op' in call else type(call).__name__ for call in calls)),'actualLoadedModules':len(modules),'loadedModuleRoles':dict(collections.Counter(row['role'] for row in modules)),'loadsSha256':sha(pathlib.Path(layout['loadsPath']).read_bytes()),'mutant':layout['mutant'],'privateWriterProof':'SOURCE_LINKED_CONDITIONAL_JOIN_ONLY'})
report['mutantDetections']=[{'id':row['id'],'detected':row['detected']} for row in result['mutants']]
report['restoreResults']=[{'id':row['id'],'passed':row['passed'],'restoredSha256':row['restoredSha256']} for row in result['restores']]
report['outerRaw']={'stdoutBytes':(ROOT/'TARGET-01/stdout.raw').stat().st_size,'stderrBytes':(ROOT/'TARGET-01/stderr.raw').stat().st_size,'receiptSha256':sha((ROOT/'TARGET-01/receipt.json').read_bytes()),'coordinatorExit':outer['children'][0]['exit'],'cleanupSettled':outer['children'][0]['cleanupSettled'],'completeSeparateStreams':True}
assert report['outerRaw']['stdoutBytes']==outer['children'][0]['stdoutBytes'];assert report['outerRaw']['stderrBytes']==outer['children'][0]['stderrBytes']
report['timing']={'coordinatorBeforePublicationMs':result['inclusiveBeforePublicationMs'],'outerBeforeFinalPublicationMs':outer['elapsedBeforeFinalPublicationMs'],'outerToolReportedFinalSampleMs':29768.753167,'finalWriteTailMeasured':False}
work=ROOT/'RUN-01/work';workrows=census(work)
report['workFiles']=sum(row['type']=='file' for row in workrows);report['workDirectories']=sum(row['type']=='directory' for row in workrows);report['workBytes']=sum(row.get('bytes',0) for row in workrows)
archive=[]
for row in workrows:
 entry={**row,'path':str(pathlib.Path(row['path']).relative_to(work))}
 if row['type']=='file':entry['base64']=base64.b64encode(pathlib.Path(row['path']).read_bytes()).decode()
 archive.append(entry)
body=json.dumps({'classification':'DATA_ONLY_WORKING_CAPTURE_NO_TEST_DISCOVERY','root':str(work),'rows':archive},separators=(',',':')).encode();compressed=gzip.compress(body,mtime=0);assert gzip.decompress(compressed)==body
add('WORKING.json.gz.base64',base64.b64encode(compressed).decode()+'\n')
report['workingArchive']={'entries':len(archive),'gzipBytes':len(compressed),'gzipSha256':sha(compressed),'jsonBytes':len(body),'jsonSha256':sha(body),'artifactSha256':sha((ROOT/'WORKING.json.gz.base64').read_bytes()),'verifiedRoundTrip':True}
report['rawCaptureBytes']=sum(path.stat().st_size for path in (ROOT/'RUN-01/capture').rglob('*') if path.is_file())+sum(path.stat().st_size for path in (ROOT/'TARGET-01').iterdir() if path.is_file())
assert report['rawCaptureBytes']+(ROOT/'WORKING.json.gz.base64').stat().st_size<128*1024*1024
assert report['workBytes']+report['rawCaptureBytes']+(ROOT/'WORKING.json.gz.base64').stat().st_size<512*1024*1024
assert work.parent==ROOT/'RUN-01' and all(row['cleanupSettled'] for row in result['children'])
shutil.rmtree(work)
report['ownedScratchRemovedAfterVerifiedArchive']=not work.exists()
report['auditMs']=(time.monotonic_ns()-START)/1e6
add('AUDIT.json',report)
print(json.dumps({'layouts':[{key:row[key] for key in ['layout','passed','streams','registeredCallbacks','maximumUnobservedCloseNotificationsAtOutcome','maximumNotClosedAtOutcome']} for row in report['layouts']],'workBytes':report['workBytes'],'archiveGzipBytes':len(compressed),'rawCaptureBytes':report['rawCaptureBytes'],'scratchRemoved':report['ownedScratchRemovedAfterVerifiedArchive'],'auditMs':report['auditMs']}))
