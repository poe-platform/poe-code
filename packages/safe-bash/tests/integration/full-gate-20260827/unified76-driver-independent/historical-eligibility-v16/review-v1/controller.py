import gzip
import hashlib
import json
import os
import pathlib
import selectors
import shutil
import subprocess
import sys
import tempfile
import time

OWN = pathlib.Path(__file__).resolve().parent
ROOT = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
PREFIX = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/'
BINDINGS = json.loads((OWN / 'BINDINGS.json').read_bytes())
RECIPE = json.loads((OWN / 'RECIPE.json').read_bytes())

def sha(value):
    return hashlib.sha256(value).hexdigest()

def git_blob(revision, path):
    result = subprocess.run(['git', '--no-replace-objects', 'show', revision + ':' + path], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    assert len(result.stdout) < 16 * 1024 * 1024
    return result.stdout

def inventory(root):
    rows = []
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink()
        metadata = path.lstat()
        row = dict(path=str(path.relative_to(root)), mode=metadata.st_mode & 0o777, bytes=metadata.st_size, kind='directory' if path.is_dir() else 'file')
        if path.is_file():
            row['sha256'] = sha(path.read_bytes())
        rows.append(row)
    return rows

for name, expected in RECIPE['ownedFiles'].items():
    assert sha((OWN / name).read_bytes()) == expected, name
assert os.path.realpath(sys.executable) == RECIPE['reviewHostPython']['physical']
assert sha(pathlib.Path(sys.executable).read_bytes()) == RECIPE['reviewHostPython']['sha256']
node = BINDINGS['node']
assert os.path.realpath(node['origin']) == node['physical']
with open(node['origin'], 'rb') as stream:
    hasher = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        hasher.update(chunk)
assert hasher.hexdigest() == node['sha256']
capture = OWN / 'cohort-01'
capture.mkdir()
temporary = pathlib.Path(tempfile.mkdtemp(prefix='historical-eligibility-v16-review-v1-', dir='/private/tmp'))
stage = temporary / 'stage'
scratch = temporary / 'scratch'
stage.mkdir()
scratch.mkdir()
for name in ('home', 'tmp'):
    (scratch / name).mkdir()
receipt = {'source': BINDINGS['source'], 'recipeSha256': sha((OWN / 'RECIPE.json').read_bytes()), 'capture': str(capture), 'temporary': str(temporary), 'candidateInvocations': 0, 'signalsSent': [], 'startedAtEpoch': time.time(), 'phase': 'stage', 'noRetries': True}
child = None
streams = {'stdout': bytearray(), 'stderr': bytearray()}
try:
    for name in BINDINGS['runtimeModules'] + BINDINGS['runtimeData']:
        expected = next(row for row in BINDINGS['files'] if row['path'] == PREFIX + name)
        data = git_blob(BINDINGS['source'], PREFIX + name)
        assert len(data) == expected['bytes'] and sha(data) == expected['sha256']
        with open(stage / name, 'xb') as output:
            output.write(data)
    extras = {
        'FREEZE.json': ('17b9249a06c5d768409fea932ea7f44e36b63720', 'tests/integration/full-gate-20260827/unified76-driver-independent/historical-eligibility-v16/FREEZE.json'),
        'seal-data.json': (BINDINGS['source'], PREFIX + 'DRIVER.json'),
        'consumed-release.json': ('c222e17c4cbcc6bcb9da8a77414b90af3c465d88', 'tests/integration/full-gate-20260827/unified76-driver/released-run-v2/ROOT-AUTHORIZATION.json')
    }
    for name, (revision, path) in extras.items():
        with open(stage / name, 'xb') as output:
            output.write(git_blob(revision, path))
    before = inventory(stage)
    receipt['stageBefore'] = before
    assert sum(row['bytes'] for row in before) < 64 * 1024 * 1024
    command = [node['origin'], '--permission', '--no-addons', '--unhandled-rejections=strict', '--allow-fs-read=' + str(stage), '--allow-fs-read=' + str(scratch), '--allow-fs-read=' + str(OWN), '--allow-fs-write=' + str(scratch), str(OWN / 'review.mjs'), str(stage), str(scratch), str(OWN)]
    environment = {'PATH': str(pathlib.Path(node['origin']).parent), 'HOME': str(scratch / 'home'), 'TMPDIR': str(scratch / 'tmp'), 'LC_ALL': 'C', 'LANG': 'C', 'TZ': 'UTC'}
    receipt.update(command=command, environment=environment, phase='candidate-cohort')
    child = subprocess.Popen(command, cwd=scratch, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    receipt.update(pid=child.pid, parent=os.getpid(), candidateInvocations=1)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
    selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
    started = time.monotonic()
    violation = None
    while selector.get_map():
        for key, unused in selector.select(0.05):
            data = os.read(key.fileobj.fileno(), 65536)
            if not data:
                selector.unregister(key.fileobj)
                key.fileobj.close()
                continue
            streams[key.data].extend(data)
            if len(streams[key.data]) > 1024 * 1024:
                violation = 'capture-bound'
        if time.monotonic() - started > 180:
            violation = 'outer-timeout'
        scratch_bytes = sum(path.stat().st_size for path in scratch.rglob('*') if path.is_file())
        if scratch_bytes + sum(row['bytes'] for row in before) > 64 * 1024 * 1024:
            violation = 'disk-bound'
        if violation and child.poll() is None:
            child.kill()
            receipt['signalsSent'].append({'pid': child.pid, 'signal': 'SIGKILL', 'reason': violation})
        if violation and time.monotonic() - started > 185:
            raise RuntimeError('stdio did not close after owned-child deadline')
    selector.close()
    status = child.wait(timeout=5)
    receipt.update(status=status if status >= 0 else None, signal=-status if status < 0 else None, naturalExit=not receipt['signalsSent'], stdioClosed=True, boundViolation=violation, elapsedSeconds=time.monotonic() - started)
    after = inventory(stage)
    receipt['stageAfter'] = after
    receipt['stageUnchanged'] = before == after
    assert before == after
    receipt['scratchInventory'] = inventory(scratch)
    report = scratch / 'RESULTS.json'
    if report.exists():
        data = report.read_bytes()
        decoded = json.loads(data)
        assert decoded['pid'] == child.pid
        assert len(decoded['results']) == 40
        receipt['caseCounts'] = decoded['counts']
        receipt['resultSha256'] = sha(data)
        (capture / 'RESULTS.json').write_bytes(data)
    else:
        receipt['caseCounts'] = {'PASS': 0, 'FAIL': 0, 'UNEXECUTED': 40}
        receipt['missingCoordinatorResults'] = True
    if violation:
        raise RuntimeError(violation)
except Exception as error:
    receipt['controllerError'] = {'type': type(error).__name__, 'message': str(error)}
finally:
    if child is not None and child.poll() is None:
        child.kill()
        receipt['signalsSent'].append({'pid': child.pid, 'signal': 'SIGKILL', 'reason': 'controller-finally'})
        child.wait(timeout=5)
    receipt['ownedChildReaped'] = child is None or child.poll() is not None
    for name, data in streams.items():
        compressed = gzip.compress(bytes(data), mtime=0)
        (capture / (name + '.gz')).write_bytes(compressed)
        receipt[name] = {'bytes': len(data), 'sha256': sha(data), 'gzipSha256': sha(compressed)}
    shutil.rmtree(temporary)
    receipt['temporaryRemoved'] = not temporary.exists()
    receipt['finishedAtEpoch'] = time.time()
    (capture / 'TERMINAL.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({key: receipt.get(key) for key in ('pid', 'status', 'signal', 'caseCounts', 'controllerError', 'stageUnchanged', 'ownedChildReaped', 'temporaryRemoved')}))
raise SystemExit(1 if receipt.get('controllerError') else receipt.get('status', 1))
