import difflib
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time


ROOT = Path('/Users/kjopek/Workspace/safe-bash')
PREFIX = 'tests/commands/yq-independent-20260828/executor-preparation-v1/runtime-v2'
OWN = 'tests/commands/yq-independent-20260828/executor-review-v1/results-v3'
REVIEW = 'tests/commands/yq-independent-20260828/executor-review-v1'
SOURCE = '7add5d2c0a3acb27483ba0bb5dd52385812d8ed7'
EVIDENCE = '70fa3df66f9c8dc3f972cfa8c0c5862d77d7514e'
HISTORY = '7ed356ade4509e492e15615587408eb4b41f92e0'
SOURCE_HASH = 'c971d27207b661ae3ee23d61d6e1ee7cfefc2b6a8a890f4e0fde228c81945c64'
RECIPE_HASH = 'fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15'
DIFF_HASH = 'ae8de91fef938c24df0293a78548492bac44435509a610bf7f7decaede5c59fc'
TREE_HASH = '6a5ca19fef1237091719a4fb7571271f1c37ff02dde4a4c65253d34bd69b2878'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=15)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def committed(commit, path):
    raw = git('show', f'{commit}:{path}')
    assert len(raw) <= 16777216
    mode, kind, tail = git('ls-tree', commit, '--', path).decode().strip().split(' ', 2)
    blob, actual_path = tail.split('\t')
    assert kind == 'blob' and actual_path == path and mode in ['100644', '100755']
    return raw, {'commit': commit, 'path': path, 'blob': blob, 'gitMode': mode, 'mode': int(mode, 8) & 0o7777, 'bytes': len(raw), 'sha256': digest(raw)}


def regular(path, mode, expected):
    status = path.lstat()
    assert stat.S_ISREG(status.st_mode) and not path.is_symlink() and path.resolve() == path
    assert stat.S_IMODE(status.st_mode) == mode and digest(path.read_bytes()) == expected, str(path)


preseal = sys.argv[1]
assert len(preseal) == 40 and set(preseal) <= set('0123456789abcdef')
for name in ['PRESEAL.md', 'audit.py', 'check.mjs']:
    assert (ROOT / OWN / name).read_bytes() == git('show', f'{preseal}:{OWN}/{name}')
output = Path(tempfile.mkdtemp(prefix='capture-', dir=ROOT / OWN))
scratch = Path(tempfile.mkdtemp(prefix='yq-runtime-independent-v3-')).resolve()
mirror = scratch / 'object-reader'
mirror.mkdir()
(mirror / '.git').write_text('gitdir: ' + git('rev-parse', '--absolute-git-dir').decode().strip() + '\n')
files = []
copies = {}


def authenticate_copy(commit, path, expected=None, copy=True):
    raw, entry = committed(commit, path)
    if expected:
        for key in ['sha256', 'bytes', 'mode', 'blob', 'gitMode']:
            if key in expected:
                assert entry[key] == expected[key], (path, key)
    if copy:
        destination = mirror / path
        if path in copies:
            assert copies[path]['sha256'] == entry['sha256']
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
            destination.chmod(entry['mode'])
            entry['copy'] = str(destination)
            files.append(entry)
            copies[path] = entry
    return raw, entry


source_raw, _ = authenticate_copy(SOURCE, PREFIX + '/SOURCE-PRESEAL.json', {'sha256': SOURCE_HASH})
source_seal = json.loads(source_raw)
source_members = [entry['path'] for entry in source_seal['files']] + ['SOURCE-PRESEAL.json']
tree_members = git('ls-tree', '-r', '--name-only', SOURCE, '--', PREFIX).decode().splitlines()
assert sorted(tree_members) == sorted(PREFIX + '/' + name for name in source_members)
for entry in source_seal['files']:
    authenticate_copy(SOURCE, PREFIX + '/' + entry['path'], entry)
assert digest((mirror / PREFIX / 'RECIPE-SEAL.json').read_bytes()) == RECIPE_HASH
assert digest((mirror / PREFIX / 'V1-V2.diff').read_bytes()) == DIFF_HASH
bindings = json.loads((mirror / PREFIX / 'BINDINGS.json').read_bytes())
for entry in bindings['entries']:
    authenticate_copy(entry['commit'], entry['path'], entry, copy=entry['liveImmutable'])

evidence_seal_raw, evidence_seal_entry = committed(EVIDENCE, PREFIX + '/EVIDENCE-SEAL.json')
assert digest(evidence_seal_raw) == '7047fea5ae92f73a3d0b3e2c574afcd30532e63a3a7d25e7cfb4cb2827004c4d'
evidence_seal = json.loads(evidence_seal_raw)
assert [evidence_seal['sourceCommit'], evidence_seal['sourcePresealSha256'], evidence_seal['recipeSealSha256'], evidence_seal['diffSha256']] == [SOURCE, SOURCE_HASH, RECIPE_HASH, DIFF_HASH]
evidence_entries = []
for expected in evidence_seal['files']:
    raw, entry = committed(EVIDENCE, PREFIX + '/' + expected['path'])
    assert [entry['sha256'], entry['bytes'], entry['gitMode']] == [expected['sha256'], expected['bytes'], expected['gitMode']]
    evidence_entries.append(entry)
actual_evidence = git('ls-tree', '-r', '--name-only', EVIDENCE, '--', PREFIX).decode().splitlines()
assert sorted(actual_evidence) == sorted([*tree_members, *(entry['path'] for entry in evidence_entries), PREFIX + '/EVIDENCE-SEAL.json'])

original_child = REVIEW + '/results-v1/synthetic-child.mjs'
authenticate_copy('b93241dfb9983d2b660233bdddce4569ec803f89', original_child)
original_f01 = REVIEW + '/results-v1/capture-y9zvw316/ER-16-unknown-assertion-input.json'
authenticate_copy('b93241dfb9983d2b660233bdddce4569ec803f89', original_f01)
history_files = git('ls-tree', '-r', '--name-only', HISTORY, '--', REVIEW).decode().splitlines()
history = []
for path in history_files:
    raw, entry = committed(HISTORY, path)
    regular(ROOT / path, entry['mode'], entry['sha256'])
    history.append(entry)

node = str(Path(shutil.which('node')).resolve())
inventory_path = 'tests/commands/yq-independent-20260828/executor-preparation-v1/runtime/recipe/inventory.json'
inventory = json.loads((mirror / inventory_path).read_bytes())
host_evidence = scratch / 'host-evidence'
host_evidence.mkdir()
config = {
    'preseal': preseal, 'sourceCommit': SOURCE, 'evidenceCommit': EVIDENCE,
    'runtime': str(mirror / PREFIX), 'mirror': str(mirror), 'scratch': str(scratch),
    'output': str(output), 'files': files, 'node': node, 'nodeSha256': digest(Path(node).read_bytes()),
    'recipeSealSha256': RECIPE_HASH, 'recipeTreeSha256': TREE_HASH,
    'originalChild': str(mirror / original_child), 'originalF01': str(mirror / original_f01),
    'originalIds': [entry['id'] for entry in inventory['rows']], 'roleCounts': bindings['roleCounts'],
    'hostEvidence': str(host_evidence),
}
save(output / 'AUTHENTICATION.json', {'config': config, 'sourceSeal': source_seal, 'evidenceSeal': evidence_seal_entry, 'evidenceFiles': evidence_entries, 'history': history, 'objectDatabase': 'Explicit immutable Git reads only; no product/live module fallback'})
save(output / 'CONFIG.json', config)


def intact():
    for entry in files:
        regular(Path(entry['copy']), entry['mode'], entry['sha256'])
    actual = sorted(str(path.relative_to(mirror)) for path in mirror.rglob('*') if not path.is_dir())
    assert actual == sorted(['.git', *copies])
    for entry in history:
        regular(ROOT / entry['path'], entry['mode'], entry['sha256'])


intact()
command = [node, str(ROOT / OWN / 'check.mjs'), str(output / 'CONFIG.json')]
started = time.monotonic()
child = subprocess.Popen(command, cwd=scratch, env={'PATH': os.environ['PATH'], 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
selector = selectors.DefaultSelector()
selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
captured = {'stdout': bytearray(), 'stderr': bytearray()}
signals_sent = []
timed_out = False
overflow = False
terminated = None


def group_absent():
    try:
        os.killpg(child.pid, 0)
        return False
    except ProcessLookupError:
        return True


while selector.get_map() or child.poll() is None:
    elapsed = time.monotonic() - started
    if elapsed >= 120:
        timed_out = True
    if (timed_out or overflow) and terminated is None:
        if not group_absent():
            os.killpg(child.pid, signal.SIGTERM)
            signals_sent.append('SIGTERM')
        terminated = time.monotonic()
    if terminated is not None and time.monotonic() - terminated >= 2 and 'SIGKILL' not in signals_sent:
        if not group_absent():
            os.killpg(child.pid, signal.SIGKILL)
            signals_sent.append('SIGKILL')
    if terminated is not None and time.monotonic() - terminated >= 4:
        break
    for key, _ in selector.select(0.05):
        raw = os.read(key.fileobj.fileno(), 65536)
        if not raw:
            selector.unregister(key.fileobj)
            key.fileobj.close()
        else:
            remaining = max(0, 8388608 - sum(len(value) for value in captured.values()))
            captured[key.data].extend(raw[:remaining])
            if len(raw) > remaining:
                overflow = True
returncode = child.poll()
process_record = {'argv': command, 'pid': child.pid, 'group': child.pid, 'status': returncode, 'signal': -returncode if returncode is not None and returncode < 0 else None, 'timedOut': timed_out, 'overflow': overflow, 'reaped': returncode is not None, 'groupAbsent': group_absent(), 'signalsSent': signals_sent, 'elapsedMs': round((time.monotonic() - started) * 1000)}
for name, raw in captured.items():
    (output / (name + '.bin')).write_bytes(raw)
save(output / 'PROCESS.json', process_record)
intact()
summary = json.loads((output / 'SUMMARY.json').read_bytes()) if (output / 'SUMMARY.json').exists() else None

recipe_root = scratch / 'recipe'
expected_recipe = json.loads((mirror / PREFIX / 'RECIPE-SEAL.json').read_bytes())
assert sorted(path.name for path in recipe_root.iterdir()) == [entry['path'] for entry in expected_recipe['entries'] if entry['kind'] == 'file']
assert stat.S_IMODE(recipe_root.stat().st_mode) == 0o755
diff = []
changed = []
for entry in expected_recipe['entries']:
    if entry['kind'] != 'file':
        continue
    regular(recipe_root / entry['path'], entry['mode'], entry['sha256'])
    original = (mirror / Path(inventory_path).parent / entry['path']).read_text()
    actual = (recipe_root / entry['path']).read_text()
    if original != actual:
        changed.append(entry['path'])
        diff.append(f"diff --git a/recipe/{entry['path']} b/recipe/{entry['path']}\n")
        diff.extend(difflib.unified_diff(original.splitlines(True), actual.splitlines(True), fromfile='a/recipe/' + entry['path'], tofile='b/recipe/' + entry['path']))
assert changed == ['assert-capture.mjs', 'authorization.mjs', 'context.mjs', 'import-fence.mjs']
diff_raw = ''.join(diff).encode()
(output / 'RECONSTRUCTED.diff').write_bytes(diff_raw)
assert digest(diff_raw) == DIFF_HASH, 'Exact reconstructed delta differs'
complete = bool(summary and summary['count'] == 20 and summary['matched'] == 20 and not summary['activeChildren'])
passed = complete and returncode == 0 and not timed_out and not overflow and process_record['reaped'] and process_record['groupAbsent']
save(output / 'RESULT.json', {'verdict': 'PASS_FOCUSED_RUNTIME_SYNTHETIC_ONLY' if passed else 'FAIL_RETAINED', 'preseal': preseal, 'sourceCommit': SOURCE, 'evidenceCommit': EVIDENCE, 'controls': summary['count'] if summary else 0, 'matched': summary['matched'] if summary else 0, 'process': process_record, 'changedComponents': changed, 'unchangedComponents': 7, 'exactDiffSha256': digest(diff_raw), 'historyFilesUnchanged': len(history), 'authorEvidenceFilesAuthenticatedNotScored': len(evidence_entries), 'productImports': 0, 'productRuns': 0, 'builds': 0, 'compilerRuns': 0, 'semanticPasses': 0})
print(json.dumps({'output': str(output), 'controls': summary['count'] if summary else 0, 'matched': summary['matched'] if summary else 0, 'passed': passed}))
sys.exit(0 if passed else 1)
