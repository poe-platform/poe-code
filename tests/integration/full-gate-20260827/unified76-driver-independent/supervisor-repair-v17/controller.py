import base64
import gzip
import hashlib
import json
import os
import pathlib
import resource
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN = ROOT / 'tests/integration/full-gate-20260827/unified76-driver-independent/supervisor-repair-v17'
PREFIX = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/'
BINDINGS = json.loads((OWN / 'BINDINGS.json').read_bytes())
ENV = {'PATH': '/dev/null', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def authenticate():
    for tool in BINDINGS['tools']:
        file = pathlib.Path(tool['path'])
        assert str(file.resolve()) == tool['realpath'] and not file.is_symlink()
        assert digest(file.read_bytes()) == tool['sha256']

def observe():
    authenticate()
    data = subprocess.check_output(['/bin/ps', *BINDINGS['observerArgv']], env=ENV, timeout=2)
    assert len(data) <= 8 * 1024 * 1024
    records = []
    for line in data.decode().splitlines():
        parts = line.split()
        records.append(dict(pid=int(parts[0]), parent=int(parts[1]), group=int(parts[2]), born=' '.join(parts[3:8])))
    return records

def save_additive(name, data):
    patch = '*** Begin Patch\n*** Add File: ' + str((OWN / name).relative_to(ROOT)) + '\n'
    patch += ''.join('+' + line + '\n' for line in data.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), cwd=ROOT, check=True)

def limited():
    resource.setrlimit(resource.RLIMIT_FSIZE, (16*1024*1024, 16*1024*1024))

authenticate()
recipe_commit = sys.argv[1]
recipe = json.loads(subprocess.check_output(['git', 'show', recipe_commit + ':' + str((OWN/'RECIPE.json').relative_to(ROOT))], cwd=ROOT, timeout=10))
for name, expected in recipe['ownedFiles'].items():
    assert digest((OWN/name).read_bytes()) == expected
assert not (OWN / 'cohort-01.json').exists(), 'one-shot output exists'
pre_index = subprocess.check_output(['git', 'diff', '--cached', '--binary'], cwd=ROOT)
stage = pathlib.Path(tempfile.mkdtemp(prefix='unified76-supervisor-review-')).resolve()
write_root = pathlib.Path(tempfile.mkdtemp(prefix='unified76-os-write-', dir='/private/tmp')).resolve()
output = pathlib.Path(tempfile.mkdtemp(prefix='unified76-build-types-review-supervisor-', dir='/private/tmp')).resolve()
assert all(file.stat().st_mode & 0o777 == 0o700 for file in [stage, write_root, output])
for name in ['home', 'tmp']:
    (write_root / name).mkdir(mode=0o700)
staged = {}
for name, commit, original in [
    ('supervise.mjs', BINDINGS['source'], 'supervise.mjs'),
    ('old-supervise.mjs', BINDINGS['base'], 'supervise.mjs'),
    ('os-instruction-fence.mjs', BINDINGS['source'], 'os-instruction-fence.mjs'),
    ('TOOL-ROUTES.json', BINDINGS['source'], 'TOOL-ROUTES.json'),
]:
    data = subprocess.check_output(['git', 'show', commit + ':' + PREFIX + original], cwd=ROOT, timeout=10)
    (stage / name).write_bytes(data)
    staged[name] = digest(data)
for name in ['review.mjs', 'BINDINGS.json']:
    data = (OWN / name).read_bytes()
    (stage / name).write_bytes(data)
    staged[name] = digest(data)
assert sum(file.stat().st_size for file in stage.iterdir()) < 2*1024*1024
command = [BINDINGS['tools'][0]['path'], '--experimental-vm-modules', str(stage / 'review.mjs'), str(stage), str(output), str(write_root)]
start = time.monotonic()
child = subprocess.Popen(command, cwd=stage, env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, preexec_fn=limited)
controller_identity = next(row for row in observe() if row['pid'] == os.getpid())
coordinator_identity = next(row for row in observe() if row['pid'] == child.pid)
selector = selectors.DefaultSelector()
for stream, label in [(child.stdout, 'stdout'), (child.stderr, 'stderr')]:
    os.set_blocking(stream.fileno(), False)
    selector.register(stream, selectors.EVENT_READ, label)
captures = {'stdout': bytearray(), 'stderr': bytearray()}
parse_buffer = bytearray()
registered = {}
reserved = {name: {'reservedBeforeCoordinator': True} for name in ['A01', 'A02', 'A03']}
rescue = []
faults = []
observations = []
last_check = 0
coordinator_killed = False
while selector.get_map() or child.poll() is None:
    elapsed = time.monotonic() - start
    if elapsed > 200 and not coordinator_killed:
        faults.append('coordinator deadline');child.kill();coordinator_killed = True
    for key, mask in selector.select(0.1):
        data = os.read(key.fileobj.fileno(), 65536)
        if not data:
            selector.unregister(key.fileobj);key.fileobj.close();continue
        label = key.data
        if len(captures[label]) + len(data) > 1024*1024:
            faults.append(label + ' overflow');child.kill();coordinator_killed=True;continue
        captures[label].extend(data)
        if label == 'stdout':
            parse_buffer.extend(data)
            while b'\n' in parse_buffer:
                line, _, remaining = parse_buffer.partition(b'\n');parse_buffer = bytearray(remaining)
                try:
                    message = json.loads(line)
                    if message.get('kind') == 'registered':
                        identity = message['identity'];name = message['id']
                        assert name in reserved and name not in registered
                        assert identity['parent'] == child.pid and identity['pid'] == identity['group']
                        live = next((row for row in observe() if row['pid'] == identity['pid'] and row['born'] == identity['born']), None)
                        registered[name] = dict(identity=identity, registeredAt=elapsed, observedLive=live, absent=False)
                    if message.get('kind') == 'case':
                        print(message['id'] + ': ' + message['verdict'], flush=True)
                except Exception as error:
                    faults.append('channel: ' + repr(error));child.kill();coordinator_killed=True
    if registered and elapsed-last_check > 0.5:
        last_check=elapsed
        current=observe()
        for name, row in registered.items():
            identity=row['identity'];match=next((entry for entry in current if entry['pid']==identity['pid'] and entry['born']==identity['born']),None)
            if match is None:
                row['absent']=True
            elif elapsed-row['registeredAt'] > 8:
                assert match['group']==identity['group']
                rescue.append(dict(id=name, identity=identity, signal='SIGKILL', elapsed=elapsed))
                os.kill(identity['pid'], signal.SIGKILL)
        observations.append(dict(elapsed=elapsed, owned={name:row['absent'] for name,row in registered.items()}))
    if elapsed > 215:
        faults.append('stream deadline');break
returncode=child.wait(timeout=5)
for key in list(selector.get_map().values()):
    selector.unregister(key.fileobj);key.fileobj.close()
selector.close()
current=observe()
survivors=[]
for name,row in registered.items():
    identity=row['identity'];match=next((entry for entry in current if entry['pid']==identity['pid'] and entry['born']==identity['born']),None)
    row['absent']=match is None
    if match:survivors.append(dict(id=name,identity=identity))
assert not survivors, 'retain owned roots on unresolved survivor'
assert all(digest((stage/name).read_bytes())==expected for name,expected in staged.items())
artifacts={}
for file in sorted(output.rglob('*')):
    assert not file.is_symlink()
    if file.is_file():
        data=file.read_bytes()
        artifacts[str(file.relative_to(output))]=dict(bytes=len(data),sha256=digest(data),gzipBase64=base64.b64encode(gzip.compress(data,mtime=0)).decode())
assert sum(row['bytes'] for row in artifacts.values()) < 16*1024*1024
post_index=subprocess.check_output(['git','diff','--cached','--binary'],cwd=ROOT)
assert pre_index==post_index
changed_prior=[name for name,expected in BINDINGS['priorOwnedHashes'].items() if digest((ROOT/name).read_bytes())!=expected]
assert not changed_prior
snapshot={}
for root in [stage,write_root,output]:
    snapshot[str(root)]=[dict(path=str(file.relative_to(root)),kind='file' if file.is_file() else 'directory',bytes=file.stat().st_size,sha256=digest(file.read_bytes()) if file.is_file() else None) for file in sorted(root.rglob('*'))]
assert sum(row['bytes'] for rows_for_root in snapshot.values() for row in rows_for_root if row['kind']=='file') < 32*1024*1024
record=dict(schema=1,command=command,env=ENV,source=BINDINGS['source'],controllerIdentity=controller_identity,coordinatorIdentity=coordinator_identity,
    recipeCommit=recipe_commit,recipeSha256=digest(json.dumps(recipe,separators=(',',':')).encode()),
    exit=returncode if returncode>=0 else None,signal=-returncode if returncode<0 else None,elapsedSeconds=time.monotonic()-start,
    stdout=dict(bytes=len(captures['stdout']),sha256=digest(captures['stdout']),gzipBase64=base64.b64encode(gzip.compress(captures['stdout'],mtime=0)).decode()),
    stderr=dict(bytes=len(captures['stderr']),sha256=digest(captures['stderr']),gzipBase64=base64.b64encode(gzip.compress(captures['stderr'],mtime=0)).decode()),
    registered=registered,reserved=reserved,rescue=rescue,faults=faults,observations=observations,survivors=survivors,staged=staged,artifacts=artifacts,trees=snapshot,
    priorArtifactsUnchanged=len(BINDINGS['priorOwnedHashes']),indexUnchanged=True,
    qualification='Only reserved direct owned identities eligible for rescue; no group signaling. ps uses frozen whole-table argv, retains only owned rows. Watchdogs cooperative, not kernel hard deadlines.')
for root in [stage,write_root,output]:
    shutil.rmtree(root)
record['temporaryRootsRemoved']=all(not root.exists() for root in [stage,write_root,output])
save_additive('cohort-01.json',json.dumps(record,indent=2)+'\n')
print(json.dumps(dict(exit=returncode,rescue=len(rescue),faults=faults,rootsRemoved=record['temporaryRootsRemoved'],registered=len(registered))))
