import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time


ROOT = Path('/Users/kjopek/Workspace/safe-bash')
OWN = 'tests/commands/yq-independent-20260828/executor-review-v1/results-v3'
PREFIX = 'tests/commands/yq-independent-20260828/executor-preparation-v1/integration-v2'
SOURCE = '4fafd93a2a414fe9ce1965f77ab45da1d417d10a'
EVIDENCE = '83035d641c415019ac62a0d0114cf2836ba77e45'
SEAL = '47c3874f520efee18062d4b2e687159a52039a86d35945a7f5371e85eb00fdff'
preseal = sys.argv[1]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=15)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def regular(filename, mode, expected):
    status = filename.lstat()
    assert stat.S_ISREG(status.st_mode) and filename.resolve() == filename
    assert stat.S_IMODE(status.st_mode) == mode and digest(filename.read_bytes()) == expected, str(filename)


for name in ['COMPLETION-AND-INTEGRATION-PRESEAL.md', 'finish.py', 'integration-check.mjs', 'capture-dubngyeu/POSTPROCESS-FAILURE.json']:
    assert (ROOT / OWN / name).read_bytes() == git('show', f'{preseal}:{OWN}/{name}')
capture = ROOT / OWN / 'capture-dubngyeu'
authentication = json.loads((capture / 'AUTHENTICATION.json').read_bytes())
runtime = authentication['config']
for entry in runtime['files']:
    regular(Path(entry['copy']), entry['mode'], entry['sha256'])
for entry in authentication['history']:
    regular(ROOT / entry['path'], entry['mode'], entry['sha256'])
runtime_root = Path(runtime['scratch']) / 'recipe'
runtime_source = Path(runtime['runtime'])
runtime_seal = json.loads((runtime_source / 'RECIPE-SEAL.json').read_bytes())
assert digest((runtime_source / 'RECIPE-SEAL.json').read_bytes()) == runtime['recipeSealSha256']
assert sorted(path.name for path in runtime_root.iterdir()) == [entry['path'] for entry in runtime_seal['entries'] if entry['kind'] == 'file']
for entry in runtime_seal['entries']:
    if entry['kind'] == 'file':
        regular(runtime_root / entry['path'], entry['mode'], entry['sha256'])
patch = (runtime_source / 'V1-V2.diff').read_text()
assert digest(patch.encode()) == 'ae8de91fef938c24df0293a78548492bac44435509a610bf7f7decaede5c59fc'
patched = []
original_root = Path(runtime['mirror']) / 'tests/commands/yq-independent-20260828/executor-preparation-v1/runtime/recipe'
for block in patch.split('diff --git ')[1:]:
    lines = block.splitlines(True)
    match = re.fullmatch(r'a/recipe/(\S+) b/recipe/\1\n', lines[0])
    assert match
    name = match.group(1)
    assert lines[1] == f'--- a/recipe/{name}\n' and lines[2] == f'+++ b/recipe/{name}\n'
    original = (original_root / name).read_text().splitlines(True)
    result = []
    offset = 0
    index = 3
    while index < len(lines):
        hunk = re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\n', lines[index])
        assert hunk, lines[index]
        target = int(hunk.group(1)) - 1
        assert target >= offset
        result.extend(original[offset:target])
        offset = target
        old_count = new_count = 0
        index += 1
        while index < len(lines) and not lines[index].startswith('@@ '):
            line = lines[index]
            assert line[0] in ' +-'
            if line[0] != '+':
                assert original[offset] == line[1:]
                offset += 1
                old_count += 1
            if line[0] != '-':
                result.append(line[1:])
                new_count += 1
            index += 1
        assert old_count == int(hunk.group(2) or 1) and new_count == int(hunk.group(4) or 1)
    result.extend(original[offset:])
    assert ''.join(result).encode() == (runtime_root / name).read_bytes()
    patched.append(name)
assert patched == ['assert-capture.mjs', 'authorization.mjs', 'context.mjs', 'import-fence.mjs']
for entry in runtime_seal['entries']:
    if entry['kind'] == 'file' and entry['path'] not in patched:
        assert (original_root / entry['path']).read_bytes() == (runtime_root / entry['path']).read_bytes()
summary = json.loads((capture / 'SUMMARY.json').read_bytes())
process_record = json.loads((capture / 'PROCESS.json').read_bytes())
assert [summary['count'], summary['matched'], summary['activeChildren']] == [20, 20, []]
assert process_record['status'] == 0 and process_record['signal'] is None
assert not process_record['timedOut'] and not process_record['overflow'] and process_record['reaped'] and process_record['groupAbsent']
children = []
for observation in summary['observations']:
    assert observation['matched'] and observation['failure'] is None
    raw = json.loads((capture / (observation['id'] + '-raw.json')).read_bytes())
    verdict = json.loads((capture / (observation['id'] + '-verdict.json')).read_bytes())
    assert observation == verdict and raw['activeChildren'] == []
    if isinstance(raw['returned'], dict) and 'summary' in raw['returned']:
        cohort = raw['returned']['summary']
        for result in cohort['results']:
            if result['admitted']:
                assert result['metadata']['reaped']
                children.append(result['metadata'])
                if result['metadata']['exitCode'] != 0 or result['metadata']['signal'] is not None or result['metadata']['timedOut']:
                    assert cohort['aggregate'] == 'FAIL' and result['outcome'] == 'FAIL'
save(capture / 'COMPLETION.json', {'verdict': 'PASS_SAVED_RUNTIME_PREDICATES_NOT_ORIGINAL_AGGREGATE', 'preseal': preseal, 'controls': 20, 'matched': 20, 'runtimeWorkerStatus': 0, 'originalOuterStatus': 1, 'originalPreparationStatus': 1, 'reruns': 0, 'exactSealedPatchApplied': patched, 'unchangedComponents': 7, 'children': children, 'outerProcess': process_record, 'historyFilesUnchanged': len(authentication['history']), 'productImports': 0, 'builds': 0, 'compilerRuns': 0})

output = Path(tempfile.mkdtemp(prefix='integration-', dir=ROOT / OWN))
scratch = Path(tempfile.mkdtemp(prefix='yq-integration-independent-v3-')).resolve()
mirror = scratch / 'mirror'
mirror.mkdir()
records = []
tree_cache = {}


def committed(commit, path, copy=False, expected=None):
    raw = git('show', f'{commit}:{path}')
    assert len(raw) <= 16777216
    mode, kind, tail = git('ls-tree', commit, '--', path).decode().strip().split(' ', 2)
    blob, actual = tail.split('\t')
    assert kind == 'blob' and mode in ['100644', '100755'] and actual == path
    entry = {'commit': commit, 'path': path, 'gitMode': mode, 'blob': blob, 'mode': int(mode, 8) & 4095, 'bytes': len(raw), 'sha256': digest(raw)}
    if expected:
        assert digest(raw) == expected
    if copy:
        filename = mirror / path
        filename.parent.mkdir(parents=True, exist_ok=True)
        filename.write_bytes(raw)
        filename.chmod(entry['mode'])
        entry['copy'] = str(filename)
    records.append(entry)
    return raw


source_paths = git('ls-tree', '-r', '--name-only', SOURCE, '--', PREFIX).decode().splitlines()
for path in source_paths:
    committed(SOURCE, path, copy=True)
core = mirror / PREFIX / 'core'
seal_path = mirror / PREFIX / 'SEAL-v4.json'
assert digest(seal_path.read_bytes()) == SEAL
seal = json.loads(seal_path.read_bytes())
assert digest((core / 'RECIPE.json').read_bytes()) == 'eecdc319fc90ccc89bdae0fbb7900beb33dbd07807c4fa78738280b77e412158'
assert digest((mirror / PREFIX / 'SOURCE-DELTA-v2.json').read_bytes()) == '616f64e1966f43ab37a241414026b4b82b88b5679956573bc16aa1c7c1a9ac3f'
assert sorted(path.name for path in core.iterdir()) == [entry['path'] for entry in seal['entries'] if entry['kind'] == 'file']
for entry in seal['entries']:
    if entry['kind'] == 'file':
        regular(core / entry['path'], entry['mode'], entry['sha256'])
evidence_raw = committed(EVIDENCE, PREFIX + '/EVIDENCE-SEAL.json', expected='d735da382ebe622a868fbb0c4f6ce9d8af5c99e7b0448eb2b24db9a76bffc54e')
evidence = json.loads(evidence_raw)
assert evidence['sourceCommit'] == SOURCE and evidence['integrationSeal']['sha256'] == SEAL
evidence_paths = []
for entry in evidence['entries']:
    if entry['kind'] == 'file':
        path = PREFIX + '/' + entry['path']
        raw = committed(EVIDENCE, path, expected=entry['sha256'])
        assert len(raw) == entry['bytes']
        regular(ROOT / path, entry['mode'], entry['sha256'])
        evidence_paths.append(path)
assert sorted(git('ls-tree', '-r', '--name-only', EVIDENCE, '--', PREFIX).decode().splitlines()) == sorted([*evidence_paths, PREFIX + '/EVIDENCE-SEAL.json'])
pins = json.loads((core / 'COMPONENTS.json').read_bytes())
assert pins['runtime']['commit'] == '7add5d2c0a3acb27483ba0bb5dd52385812d8ed7'
assert pins['runtime']['sourcePreseal']['sha256'] == 'c971d27207b661ae3ee23d61d6e1ee7cfefc2b6a8a890f4e0fde228c81945c64'
runtime_sources = {entry['path']: entry for entry in authentication['sourceSeal']['files']}
for entry in pins['runtime']['files']:
    original = runtime_sources[Path(entry['path']).name]
    assert entry['sha256'] == original['sha256'] and entry['mode'] == original['mode']
assert len(pins['runtime']['files']) == len(runtime_sources) == 11
assert pins['runtime']['seal']['sha256'] == runtime['recipeSealSha256']
assert pins['runtime']['treeSha256'] == runtime['recipeTreeSha256']
assert pins['consumers']['commit'] == '90c4c50070334a34c1b75d78f7da25d302f6bb61'
assert pins['consumers']['seal']['sha256'] == '69dfaf2aa833590312d80515a62d1dcc544952e55f9844aea73a3a8c2d90330b'
delta = json.loads((mirror / PREFIX / 'SOURCE-DELTA-v2.json').read_bytes())
for entry in delta['changes']:
    assert digest((core / entry['path']).read_bytes()) == entry['sha256']
    if entry.get('originalPath'):
        before = committed(delta['originalCommit'], entry['originalPath'], expected=entry['originalSha256'])
        if entry['path'] == 'worker.mjs':
            assert before == (core / 'worker.mjs').read_bytes()
old_recipe = json.loads(committed(delta['originalCommit'], 'tests/commands/yq-independent-20260828/executor-preparation-v1/integration/core/RECIPE.json'))
recipe = json.loads((core / 'RECIPE.json').read_bytes())
unchanged_fields = ['originalIds', 'overlays', 'roleCounts', 'preparedIds', 'jobsPerEnvironment', 'jobsSha256', 'routes', 'sourceProbeRoutes', 'scopedTypeJobs', 'pendingPublicJobs', 'semantic', 'missingBindings']
for field in unchanged_fields:
    assert recipe[field] == old_recipe[field], field
packet = 'tests/commands/yq-independent-20260828/candidate-35da1854-v1'
maps_path = packet + '/MAPS.json'
committed(pins['packet']['commit'], maps_path, copy=True, expected='4759a03c95d51330176a196ba6d10bc7724d1a8f964071de4efc1f4bd3993506')
for name in ['fullReceipt', 'buildReceipt', 'admissionReceipt']:
    value = pins['packet'][name]
    committed(pins['packet']['commit'], value['path'], copy=True, expected=value['sha256'])
build = json.loads((mirror / pins['packet']['buildReceipt']['path']).read_bytes())
assert build['classification'] == 'BOUND_AUTHOR_BUILD' and build['independentlyCompiled'] is False and build['rootTrustedBuildReceipt'] is False
config = {'preseal': preseal, 'core': str(core), 'scratch': str(scratch), 'output': str(output), 'files': [entry for entry in records if 'copy' in entry], 'sealPath': str(seal_path), 'sealHash': SEAL, 'mapsPath': str(mirror / maps_path), 'fullReceiptPath': str(mirror / pins['packet']['fullReceipt']['path']), 'nodeSha256': runtime['nodeSha256']}
save(output / 'AUTHENTICATION.json', {'preseal': preseal, 'sourceCommit': SOURCE, 'evidenceCommit': EVIDENCE, 'records': records, 'unchangedRoleFields': unchanged_fields, 'unchangedWorker': True, 'authorEvidenceFilesNotScored': len(evidence_paths), 'positiveBindDeferred': True, 'productImports': 0})
save(output / 'CONFIG.json', config)
command = [runtime['node'], str(ROOT / OWN / 'integration-check.mjs'), str(output / 'CONFIG.json')]
started = time.monotonic()
child = subprocess.Popen(command, cwd=scratch, env={'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
timed_out = False
sent = []
try:
    stdout, stderr = child.communicate(timeout=30)
except subprocess.TimeoutExpired:
    timed_out = True
    os.killpg(child.pid, signal.SIGTERM)
    sent.append('SIGTERM')
    try:
        stdout, stderr = child.communicate(timeout=2)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        sent.append('SIGKILL')
        stdout, stderr = child.communicate(timeout=2)
try:
    os.killpg(child.pid, 0)
    absent = False
except ProcessLookupError:
    absent = True
(output / 'stdout.bin').write_bytes(stdout)
(output / 'stderr.bin').write_bytes(stderr)
process = {'argv': command, 'pid': child.pid, 'group': child.pid, 'status': child.returncode, 'signal': -child.returncode if child.returncode < 0 else None, 'timedOut': timed_out, 'reaped': child.returncode is not None, 'groupAbsent': absent, 'signalsSent': sent, 'elapsedMs': round((time.monotonic() - started) * 1000), 'stdoutBytes': len(stdout), 'stderrBytes': len(stderr)}
save(output / 'PROCESS.json', process)
for entry in config['files']:
    regular(Path(entry['copy']), entry['mode'], entry['sha256'])
assert sorted(path.name for path in core.iterdir()) == [entry['path'] for entry in seal['entries'] if entry['kind'] == 'file']
for entry in authentication['history']:
    regular(ROOT / entry['path'], entry['mode'], entry['sha256'])
summary = json.loads((output / 'SUMMARY.json').read_bytes()) if (output / 'SUMMARY.json').exists() else None
passed = bool(summary and summary['count'] == 10 and summary['matched'] == 10 and child.returncode == 0 and not timed_out and absent)
save(output / 'RESULT.json', {'verdict': 'PASS_BOUNDED_INTEGRATION_METADATA_ONLY' if passed else 'FAIL_RETAINED', 'sourceCommit': SOURCE, 'evidenceCommit': EVIDENCE, 'preseal': preseal, 'controls': summary['count'] if summary else 0, 'matched': summary['matched'] if summary else 0, 'process': process, 'productImports': 0, 'productRuns': 0, 'builds': 0, 'compilerRuns': 0, 'positiveBindExecuted': False, 'loadComponentsExecuted': False, 'candidateGO': False})
print(json.dumps({'runtimeControls': 20, 'runtimeMatched': 20, 'runtimeOriginalOuterStatus': 1, 'integrationOutput': str(output), 'integrationPassed': passed}))
sys.exit(0 if passed else 1)
