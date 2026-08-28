import base64
import gzip
import hashlib
import json
import os
import pathlib
import resource
import secrets
import selectors
import shutil
import signal
import subprocess
import sys
import time

ROOT=pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN=ROOT/'tests/integration/full-gate-20260827/unified76-driver-independent/supervisor-repair-v17/continuation-v2'
PREFIX='tests/integration/full-gate-20260827/unified76-driver/launcher-v3/'
ENV={'PATH':'/dev/null','LANG':'C','LC_ALL':'C','TZ':'UTC'}
bindings=json.loads((OWN/'BINDINGS.json').read_bytes())
recipe_commit=sys.argv[1]
recipe=json.loads(subprocess.check_output(['git','show',recipe_commit+':'+str((OWN/'RECIPE.json').relative_to(ROOT))],cwd=ROOT,timeout=10))

def digest(data):
    return hashlib.sha256(data).hexdigest()

def authenticate():
    for tool in bindings['tools']:
        file=pathlib.Path(tool['path'])
        assert not file.is_symlink() and str(file.resolve())==tool['realpath']
        assert digest(file.read_bytes())==tool['sha256']

observer_count=0

def observe():
    global observer_count
    file=pathlib.Path('/bin/ps')
    assert digest(file.read_bytes())==bindings['tools'][1]['sha256']
    observer_count+=1
    probe=subprocess.Popen(['/bin/ps',*bindings['observerArgv']],env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    poll=selectors.DefaultSelector()
    streams={'stdout':bytearray(),'stderr':bytearray()}
    start=time.monotonic()
    for stream,label in [(probe.stdout,'stdout'),(probe.stderr,'stderr')]:
        os.set_blocking(stream.fileno(),False);poll.register(stream,selectors.EVENT_READ,label)
    try:
        while poll.get_map():
            if time.monotonic()-start>2:raise TimeoutError('parent observer deadline')
            for key,mask in poll.select(0.05):
                data=os.read(key.fileobj.fileno(),65536)
                if not data:poll.unregister(key.fileobj);key.fileobj.close();continue
                streams[key.data].extend(data)
                if len(streams[key.data])>8*1024*1024:raise ValueError('parent observer capture limit')
        status=probe.wait(timeout=0.5)
        assert status==0 and not streams['stderr']
    finally:
        if probe.poll() is None:probe.kill();probe.wait(timeout=2)
        for key in list(poll.get_map().values()):poll.unregister(key.fileobj);key.fileobj.close()
        poll.close()
    records=[]
    for line in streams['stdout'].decode().splitlines():
        fields=line.split()
        records.append(dict(pid=int(fields[0]),parent=int(fields[1]),group=int(fields[2]),born=' '.join(fields[3:8])))
    return records

def additive(name,value):
    text=json.dumps(value,indent=2)+'\n'
    patch='*** Begin Patch\n*** Add File: '+str((OWN/name).relative_to(ROOT))+'\n'+''.join('+'+line+'\n' for line in text.splitlines())+'*** End Patch\n'
    subprocess.run(['apply_patch'],input=patch.encode(),cwd=ROOT,check=True)

def limited():
    resource.setrlimit(resource.RLIMIT_FSIZE,(16*1024*1024,16*1024*1024))

for name,expected in recipe['ownedFiles'].items():assert digest((OWN/name).read_bytes())==expected
authenticate()
assert not (OWN/'cohort-01.json').exists(),'one-shot output exists'
index_before=subprocess.check_output(['git','diff','--cached','--binary'],cwd=ROOT)
suffix=secrets.token_hex(8)
stage=pathlib.Path('/private/tmp/unified76-supervisor-cont-v2-'+suffix)
write_root=pathlib.Path('/private/tmp/unified76-os-write-'+suffix)
output=pathlib.Path('/private/tmp/unified76-build-types-review-supervisor-v2-'+suffix)
for root in [stage,write_root,output]:root.mkdir(mode=0o700)
for name in ['home','tmp']:(write_root/name).mkdir(mode=0o700)
staged={}
for name in ['supervise.mjs','os-instruction-fence.mjs','TOOL-ROUTES.json']:
    data=subprocess.check_output(['git','show',bindings['source']+':'+PREFIX+name],cwd=ROOT,timeout=10)
    expected=next(row['sha256'] for row in bindings['files'] if row['path']==PREFIX+name)
    assert digest(data)==expected
    (stage/name).write_bytes(data);staged[name]=digest(data)
for name in ['review.mjs','compare.mjs','BINDINGS.json','CHILDREN.json']:
    data=(OWN/name).read_bytes();assert digest(data)==recipe['ownedFiles'][name]
    (stage/name).write_bytes(data);staged[name]=digest(data)
assert sum(file.stat().st_size for file in stage.iterdir())<2*1024*1024
command=[bindings['tools'][0]['path'],'--experimental-vm-modules',str(stage/'review.mjs'),str(stage),str(output),str(write_root)]
reserved={name:dict(reservedBeforeLaunch=True) for name in ['A01','A02','A03']}
start=time.monotonic()
child=subprocess.Popen(command,cwd=stage,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=limited)
rows=observe()
controller_identity=next(row for row in rows if row['pid']==os.getpid())
coordinator_identity=next(row for row in rows if row['pid']==child.pid)
poll=selectors.DefaultSelector()
for stream,label in [(child.stdout,'stdout'),(child.stderr,'stderr')]:
    os.set_blocking(stream.fileno(),False);poll.register(stream,selectors.EVENT_READ,label)
captures={'stdout':bytearray(),'stderr':bytearray()}
line_buffer=bytearray()
registered={};rescues=[];faults=[];observations=[]
exit_seen=None;last_observation=0;coordinator_killed=False

def registrations():
    for name in reserved:
        file=output/(name+'.identity.json')
        if name in registered or not file.exists():continue
        row=json.loads(file.read_bytes());identity=row['identity']
        assert row['id']==name and row['registeredBeforeFaultInjection'] is True
        assert row['coordinatorPid']==child.pid and identity['parent']==child.pid and identity['group']==identity['pid']
        assert identity['pid'] not in [os.getpid(),child.pid,os.getppid()] and isinstance(identity['born'],str) and identity['born']
        registered[name]=dict(identity=identity,registeredAt=time.monotonic()-start,absent=False,sourceFileSha256=digest(file.read_bytes()))

while poll.get_map() or child.poll() is None:
    elapsed=time.monotonic()-start
    if elapsed>90 and not coordinator_killed:
        faults.append('coordinator deadline');child.kill();coordinator_killed=True
    if child.poll() is not None and exit_seen is None:exit_seen=elapsed
    if exit_seen is not None and elapsed-exit_seen>5:
        faults.append('coordinator stream drain deadline');break
    for key,mask in poll.select(0.05):
        data=os.read(key.fileobj.fileno(),65536)
        if not data:poll.unregister(key.fileobj);key.fileobj.close();continue
        label=key.data
        if len(captures[label])+len(data)>1024*1024:
            faults.append(label+' overflow');child.kill();coordinator_killed=True;continue
        captures[label].extend(data)
        if label=='stdout':
            line_buffer.extend(data)
            while b'\n' in line_buffer:
                line,separator,remainder=line_buffer.partition(b'\n');line_buffer=bytearray(remainder)
                try:
                    message=json.loads(line)
                    if message.get('kind') in ['companions','case','complete']:print(json.dumps(message),flush=True)
                except Exception as error:
                    faults.append('control capture: '+repr(error));child.kill();coordinator_killed=True
    registrations()
    if registered and elapsed-last_observation>0.25:
        last_observation=elapsed;current=observe()
        for name,row in registered.items():
            identity=row['identity'];match=next((entry for entry in current if entry['pid']==identity['pid'] and entry['born']==identity['born']),None)
            row['absent']=match is None
            if match and elapsed-row['registeredAt']>8:
                assert match['group']==identity['group']
                if not any(entry['id']==name for entry in rescues):
                    rescues.append(dict(id=name,identity=identity,signal='SIGKILL',elapsed=elapsed));os.kill(identity['pid'],signal.SIGKILL)
        observations.append(dict(elapsed=elapsed,owned={name:row['absent'] for name,row in registered.items()}))
    if elapsed>100:faults.append('outer deadline');break
returncode=child.wait(timeout=5)
streams_closed=not poll.get_map()
for key in list(poll.get_map().values()):poll.unregister(key.fileobj);key.fileobj.close()
poll.close();registrations()
current=observe()
survivors=[]
for name,row in registered.items():
    identity=row['identity'];match=next((entry for entry in current if entry['pid']==identity['pid'] and entry['born']==identity['born']),None)
    row['absent']=match is None
    if match:survivors.append(dict(id=name,identity=identity))
assert not survivors,'preserve roots for unresolved owned survivor'
for name,expected in staged.items():assert digest((stage/name).read_bytes())==expected
assert sorted(file.name for file in stage.iterdir())==sorted(staged)
artifacts={};trees={}
for root in [stage,write_root,output]:
    inventory=[]
    for file in sorted(root.rglob('*')):
        assert not file.is_symlink()
        if file.is_file():
            data=file.read_bytes();inventory.append(dict(path=str(file.relative_to(root)),kind='file',bytes=len(data),sha256=digest(data)))
            if root==output:artifacts[str(file.relative_to(root))]=dict(bytes=len(data),sha256=digest(data),gzipBase64=base64.b64encode(gzip.compress(data,mtime=0)).decode())
        else:inventory.append(dict(path=str(file.relative_to(root)),kind='directory'))
    trees[str(root)]=inventory
assert sum(row.get('bytes',0) for inventory in trees.values() for row in inventory)<32*1024*1024
changed=[name for name,expected in bindings['priorOwnedHashes'].items() if digest((ROOT/name).read_bytes())!=expected]
assert not changed
index_after=subprocess.check_output(['git','diff','--cached','--binary'],cwd=ROOT)
record=dict(schema=2,recipeCommit=recipe_commit,source=bindings['source'],command=command,env=ENV,controllerIdentity=controller_identity,coordinatorIdentity=coordinator_identity,
    exit=returncode if returncode>=0 else None,signal=-returncode if returncode<0 else None,elapsedSeconds=time.monotonic()-start,streamsClosed=streams_closed,
    captures={label:dict(bytes=len(data),sha256=digest(data),gzipBase64=base64.b64encode(gzip.compress(data,mtime=0)).decode()) for label,data in captures.items()},
    reserved=reserved,registered=registered,rescues=rescues,faults=faults,survivors=survivors,observations=observations,parentObserverCalls=observer_count,
    staged=staged,artifacts=artifacts,trees=trees,priorArtifactsUnchanged=len(bindings['priorOwnedHashes']),indexBeforeSha256=digest(index_before),indexAfterSha256=digest(index_after),
    qualification='Direct reserved PID/birth/PGID only. Parent observer independent of injected module observer. No wide signals; approved ps argv enumerates table, only owned identities retained. Cooperative watchdog bounds, not kernel-hard guarantees.')
for root in [stage,write_root,output]:shutil.rmtree(root)
record['temporaryRootsRemoved']=all(not root.exists() for root in [stage,write_root,output])
additive('cohort-01.json',record)
print(json.dumps(dict(exit=returncode,streamsClosed=streams_closed,registered=len(registered),rescues=len(rescues),faults=faults,rootsRemoved=record['temporaryRootsRemoved'])))
