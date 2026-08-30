import base64
import datetime
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile
import time

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OLD = ROOT.parent / 'm1a-review-v5'
START = time.monotonic_ns()
METADATA = []

def sha(data): return hashlib.sha256(data).hexdigest()

def add(name, value):
    text = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    patch = '*** Begin Patch\n*** Add File: ' + str((ROOT/name).relative_to(REPO)) + '\n'
    patch += ''.join('+'+line+'\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch, text=True, cwd=REPO, check=True)

def census(root, links=False):
    rows=[]
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            assert links
            rows.append({'path':str(path),'link':str(path.readlink()),'realpath':str(path.resolve())})
        elif path.is_dir(): rows.append({'path':str(path),'directory':True,'bytes':0})
        else: rows.append({'path':str(path),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())})
    return rows

for name in ['BINDING.json','PRESEAL.json','INPUTS.json','cases.mjs','fixtures.mjs','WORKING.json.gz.base64','RAW.json.gz.base64']:
    args=['git','show','655cb37b97521558c4c90581b5b23fc6c3ad9bf2:'+str((OLD/name).relative_to(REPO))]
    METADATA.append(args); assert subprocess.check_output(args,cwd=REPO)==(OLD/name).read_bytes()
binding=json.loads((OLD/'BINDING.json').read_text()); old_seal=json.loads((OLD/'PRESEAL.json').read_text())
inputs=json.loads((OLD/'INPUTS.json').read_text())
for row in inputs:
    assert 'AGENTS.md' not in pathlib.PurePosixPath(row['path']).parts
    assert not pathlib.PurePosixPath(row['path']).is_absolute() and '..' not in pathlib.PurePosixPath(row['path']).parts
    assert sha(base64.b64decode(row['base64']))==row['sha256']
add('INPUTS.json',inputs)
package=base64.b64decode(pathlib.Path(old_seal['packagePath']).read_bytes()); assert sha(package)==old_seal['packageSha256']
add('PACKAGE.tgz.base64',base64.b64encode(package).decode()+'\n')
members=[]; builtin_text=''
with tarfile.open(fileobj=io.BytesIO(package),mode='r:gz') as archive:
    for member in archive.getmembers():
        assert member.isfile() and member.name.startswith('package/')
        path=member.name.removeprefix('package/'); assert 'AGENTS.md' not in pathlib.PurePosixPath(path).parts and '..' not in pathlib.PurePosixPath(path).parts
        data=archive.extractfile(member).read(); expected=next(row for row in binding['members'] if row['path']==path)
        assert sha(data)==expected['sha256'] and len(data)==expected['bytes']
        members.append({'path':path,'sha256':sha(data),'bytes':len(data),'mode':member.mode & 0o777})
        if path.endswith('.js'): builtin_text += data.decode()+'\n'
assert len(members)==898
add('PACKAGE-MEMBERS.json',members)
records=pathlib.Path(binding['records']['path']).read_bytes(); assert sha(records)==binding['records']['sha256'];add('records.json',records.decode())
add('fixtures.mjs',(OLD/'fixtures.mjs').read_text())
original=(OLD/'cases.mjs').read_text(); altered=original
changes=[
 ('registerCleanup(callback) { fixture.register(); cleanups.push(callback); }','registerCleanup(callback) { fixture.register(); cleanups.push(callback); lifecycle().registered(context, callback); }',1),
 ('    let result, failure, thrown = false;',"    lifecycle().begin(context, 'direct-helper');\n    let result, failure, thrown = false;",1),
 ('    catch (error) { thrown = true; failure = error; }','    catch (error) { thrown = true; failure = error; }\n    lifecycle().executeJoined(context, result, thrown, failure);',1),
 ('    const cleaned = await Promise.allSettled(cleanups.map(callback => callback()));',"    const cleaned = await Promise.allSettled(cleanups.map(callback => { lifecycle().cleanupCall(context, callback); return callback(); }));\n    lifecycle().hostJoined(context, cleanups, cleaned, undefined, Buffer.concat(stderr).toString());",1),
 ('shell.use(api.gitCommands());','shell.use(lifecycle().plugin(api.gitCommands()));',1),
 ("const result = await shell.exec('git show HEAD:src/app.txt | cat');", "const result = await shell.exec('git show HEAD:src/app.txt | cat'); lifecycle().shellJoined(result);",1),
 ('await session.operation.close();','await lifecycle().sessionClose(session); lifecycle().sessionJoined(session);',2),
 ("new Session(context, '/')", "lifecycle().admitSession(new Session(context, '/'))",2),
]
for before,after,count in changes:
    assert altered.count(before)==count,(before,altered.count(before)); altered=altered.replace(before,after)
reverse=altered
for before,after,count in reversed(changes): reverse=reverse.replace(after,before)
assert reverse==original
prefix='const lifecycle = () => globalThis.__m1aObserver;\n'
add('cases.mjs',prefix+altered)
add('HARNESS-DELTA.json',{'originalSha256':sha(original.encode()),'newSha256':sha((prefix+altered).encode()),'prefix':prefix,
 'changes':[{'before':before,'after':after,'count':count} for before,after,count in changes],'reverseRestoresExactAssertions':True,
 'productModuleChanges':0,'privateWriterEvidence':'SOURCE_LINKED_CONDITIONAL_JOIN, no dynamic private timestamp'})
raw=json.loads(gzip.decompress(base64.b64decode((OLD/'RAW.json.gz.base64').read_bytes())))['entries']
historical={};previous=0
for item in raw:
    if re.fullmatch(r'source/(A\d\d|H\d\d)\.json',item['path']):
        row=json.loads(base64.b64decode(item['base64'])); created=row['nativeZlib']['created']; row['createdDelta']=created-previous;previous=created;historical[row['id']]=row
review=json.loads((ROOT.parent/'observer-v8-independent/adapter-v10-review/evidence/ROUTES.json').read_text())
routes=[]
for number in range(71):
    key=f'A{number+1:02}' if number<60 else f'H{number-59:02}'
    old=historical.get(key); observation_rows=old['observations'] if old else []
    contexts=len(observation_rows) if old else 1
    sessions=10 if key=='A52' else 0
    stream_cap=0 if key in ['A52','H08','H10','A55'] else max(16,(old['createdDelta'] if old else 6)*4+8)
    context_cap=max(1,contexts)
    event_cap=stream_cap*32+context_cap*80+sessions*4+64
    identity_cap=stream_cap*32+context_cap*160+sessions*8+128
    semantic_bytes=len(json.dumps(observation_rows,separators=(',',':')).encode()) if old else 65536
    semantic_reserve=((semantic_bytes*2+32768+4095)//4096)*4096
    report_reserve=semantic_reserve+event_cap*24+stream_cap*2048+context_cap*4096+32768
    inventory=[]
    for index,observation in enumerate(observation_rows):
        files=observation.get('before',[])
        objects=[row for row in files if re.fullmatch(r'/repo/\.git/objects/[0-9a-f]{2}/[0-9a-f]{38}',row.get('path',''))]
        inventory.append({'invocation':index,'args':observation.get('args'),'objects':objects,
          'compressedInventoryBytes':sum(row.get('bytes',0) for row in objects),
          'writerIterationsInventoryCeiling':sum((row.get('bytes',0)+4095)//4096 for row in objects),
          'sourceObservationSha256':sha(json.dumps(observation,separators=(',',':')).encode())})
    routes.append({'id':key,'route':next(row['route'] for row in review['rows'] if row['id']==key),'contexts':contexts,'sessions':sessions,
      'contextCap':context_cap,'streamCap':stream_cap,'eventCap':event_cap,'identityCap':identity_cap,'reportReserve':report_reserve,
      'semanticReserve':semantic_reserve,'historicalCreated':old['createdDelta'] if old else None,'inputInventory':inventory,
      'H10Planning': 'ONE direct helper call; oversized config metadata before inflation' if key=='H10' else None,
      'newInputBasis':'unchanged neutral records through one owned Real root' if key=='H11' else 'unchanged fixture code and prior DATA inventory',
      'rawCallbackCounters':'bounded scalar multiplicities, no per-write/next event allocation; maxWrites1048576 maxNext134217729 per stream',
      'eventEnvelope':'create1+destroy<=16+return<=1+cause<=1+error<=8+close1 <=28 per stream; contexts callback<=64 bounded separately; overflow HOLD'})
assert sum(row['reportReserve'] for row in routes)<16*1024*1024
add('ROUTES-CAPACITY.json',{'rows':routes,'semanticLayoutReserve':sum(row['reportReserve'] for row in routes),
 'fourLayoutReserve':4*sum(row['reportReserve'] for row in routes),'eventEncoding':'one Uint32 vector for cohort row; two small state summaries, no event duplication per context',
 'maxObjectBodyBytes':8388608,'maxInflatedBytesPerInvocation':134217728,'compressedReadBudgetPerInvocation':67108864,
 'objectCountsAreFiniteAdmissionsNotNativeLifetime':'stream caps reserve up to4x historical creations plus8, minimum16, not product limits; any excess HOLD',
 'readerScheduleEnvelope':'next/write counts are scalar, independent of chunk partition; no event/identity allocation per next or successful callback',
 'H09':'header-only blob8388609, not an8MiB body','A53':'provider32769-empty-chunk loop, not32769 inflater resources',
 'wholeCaptureReservation':{'toolOutputMiB':9,'fourLayoutsMiB':64,'mutantsAndRestoresMiB':12,'bindingMiB':3,'loadedTraceMiB':6.5,'manifestsAuditReceiptMiB':16,'totalMiB':110.5,'capMiB':128},
 'wholeWorkReservationMiB':{'sourceBuildTypes':32,'installCacheAndMove':64,'mutants':32,'captures':128,'authoredDataAndToolData':32,'reserve':224,'total':512}})
add('MUTANTS.json',old_seal['mutants'])
work=ROOT/'RUN-01/work'; moved=work/'physically moved app/node_modules/virtual-bash';type_root=ROOT/'types'
spec=str(moved/'dist/commands/git/index.js');contracts=str(moved/'dist/contracts/index.js');public=str(moved/'dist/index.js')
types=[('positive',f'import {{createGitCommand,createGitCommands,gitCommands}} from {json.dumps(spec)};\nimport type {{CommandDefinition,VirtualShellPlugin}} from {json.dumps(contracts)};\nconst command:CommandDefinition=createGitCommand({{replace:false,discoveryBoundary:"/repo"}});\nconst family:readonly CommandDefinition[]=createGitCommands();\nconst plugin:VirtualShellPlugin=gitCommands();void [command,family,plugin];\n',0,None),
 ('negative-limits',f'import {{createGitCommand}} from {json.dumps(spec)};createGitCommand({{limits:{{maxObjects:1}}}});\n',2,'TS2353'),
 ('negative-native',f'import {{gitCommands}} from {json.dumps(spec)};gitCommands({{spawn:()=>undefined}});\n',2,'TS2353'),
 ('negative-boundary',f'import {{createGitCommands}} from {json.dumps(spec)};createGitCommands({{discoveryBoundary:1}});\n',2,'TS2322'),
 ('negative-public-root',f'import {{createGitCommand}} from {json.dumps(public)};void createGitCommand;\n',2,'TS2305')]
for name,text,code,diagnostic in types:add('types/'+name+'.ts',text)
add('types/package.json','{"type":"module"}\n')
add('TYPES.json',[{'id':name,'path':'types/'+name+'.ts','sha256':sha(text.encode()),'exitCode':code,'diagnostic':diagnostic} for name,text,code,diagnostic in types])
npm=pathlib.Path('/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm')
assert json.loads((npm/'package.json').read_text())['version']=='10.9.7'
tool_census=[{'name':row['name'],'root':row['root'],'version':row['version'],'rows':census(pathlib.Path(row['root']))} for row in binding['tools']]
tool_census.append({'name':'npm','root':str(npm),'version':'10.9.7','rows':census(npm,True)})
add('TOOLS.json',tool_census)
add('SOURCE-PROOF.json',{'kind':'SOURCE_LINKED_CONDITIONAL_JOIN','candidate':binding['source'],'base':binding['base'],
 'exactSourceIdentities':[row for row in binding['selected'] if row['path'] in ['src/commands/git/codec.ts','src/commands/git/index.ts','src/commands/git/io.ts','src/commands/git/repository.ts','src/contracts/output.ts','src/shell/runtime.ts','src/shell/cleanup.ts','src/shell/shell.ts']],
 'chain':['codec finally always destroys and awaits written?.catch then closed wait','Repository.object awaits inflateObject; query/command awaits object work',
 'Git execute always awaits session.operation.close once Session exists; argument/preabort routes may admit none','direct helper existing execute await/catch and registered cleanup allSettled observed separately',
 'Shell actual plugin definition returns original execute Promise; root scope invokes known callback and existing Shell.exec joins scope before successful return'],
 'privatePromiseTimestampObserved':False,'errorMapping':'only unique single pre-execute unowned codec error plus exact canonical invalid-zlib diagnostic and status128 through authenticated sole codec mapping branch; source-qualified not cause-owned',
 'ownedRetirement':'saved original iterator.return, language/source-qualified preceding yield; exact first destroy argument enrolled synchronously before forward on same resource',
 'conditions':['immutable original source/modules and fixtures','sequential direct Git invocations or exact one-Git Shell pipeline','no unknown/reentrant hostile host JS','all actual admitted callbacks and close notifications settled within bounded drain'],
 'unqualified':['all future late errors','native allocation/RSS freedom','opaque external cleanup','untaken native listener installation/fallback branches']})
sequence=[{'id':'build','kind':'tool','exitCode':0,'timeoutMs':120000,'captureMiB':2}, {'id':'offline-install','kind':'tool','exitCode':0,'timeoutMs':120000,'captureMiB':2}]
sequence += [{'id':name,'kind':'layout','cases':[row['id'] for row in routes],'exitCode':0,'timeoutMs':2200000,'captureMiB':16} for name in ['source','compiled','installed','moved']]
sequence += [{'id':'types-'+name,'kind':'type','exitCode':code,'diagnostic':diagnostic,'timeoutMs':120000,'captureMiB':1} for name,text,code,diagnostic in types]
for mutant in old_seal['mutants']:
    sequence.append({'id':'mutant-'+mutant['id'],'kind':'mutant','cases':mutant['cases'],'mutant':mutant['id'],'exitCode':1,'timeoutMs':120000,'captureMiB':2})
    sequence.append({'id':'restore-'+mutant['id'],'kind':'restore','cases':mutant['cases'],'mutant':mutant['id'],'exitCode':0,'timeoutMs':120000,'captureMiB':2})
sequence += [{'id':'binding-'+name,'kind':'binding','binding':name,'exitCode':1,'diagnostic':'BINDING_'+name.upper()+'_REFUSED','timeoutMs':30000,'captureMiB':1} for name in ['entry','hash','import']]
assert len(sequence)==20
files=[{'path':str(path.relative_to(ROOT)),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())} for path in sorted(ROOT.rglob('*')) if path.is_file()]
add('PRESEAL.json',{'schema':'fresh-independent-M1A-continuation-v11','frozenWall':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'preparationFirstWall':'2026-08-28T20:59:49Z','preparationScriptMs':(time.monotonic_ns()-START)/1e6,'preparationGitCommands':METADATA,
 'candidate':binding['source'],'base':binding['base'],'packageSha256':old_seal['packageSha256'],'packageMembers':898,
 'node':binding['node'],'sequence':sequence,'limits':{'aggregateMs':6600000,'caseMs':30000,'cleanupMs':5000,'allProcesses':21,'spawnedChildren':20,'allChildCeiling':48,'peakProcesses':2,'peakCeiling':4,'captureBytes':134217728,'workBytes':536870912},
 'mechanicalFull71':{'planned':False,'reason':'reviewer source-conditional proof used; no additional instrumented denominator'},
 'allowedBuiltins':sorted(set(re.findall(r'[\'\"](node:[a-zA-Z0-9_/-]+)[\'\"]',builtin_text))|{'node:assert/strict','node:fs','node:fs/promises','node:path','node:url','node:crypto','node:zlib','node:module','node:timers/promises'}),
 'sourceTransformOptions':{'target':'ES2023','module':'ES2022'},'files':files,
 'command':binding['node']['path']+' '+str((ROOT/'run.mjs').relative_to(REPO)),'cwd':str(REPO),
 'oldTrees':[{'root':str(ROOT.parent/name),'rows':census(ROOT.parent/name)} for name in ['m1a-review-v5','observer-qualification-v6','observer-qualification-v7','observer-qualification-v8','observer-v8-independent','adapter-v9','adapter-pilot-v10']],
 'foreignIndexBefore':subprocess.check_output(['git','diff','--cached','--name-status','-z'],cwd=REPO).decode(),
 'nativeGit':0,'M1B':0,'private':0,'network':0,'extraSyntaxOrControlChildren':0,'freshBudgetNotRenewal':True})
