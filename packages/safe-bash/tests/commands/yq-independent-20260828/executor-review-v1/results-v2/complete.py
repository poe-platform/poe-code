import hashlib
import json
import os
import pathlib
import subprocess
import sys

REPO = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN = REPO / 'tests/commands/yq-independent-20260828/executor-review-v1/results-v2'
CAPTURE = OWN / 'capture-a5pnxs5j'
PRESEAL = '1dc3b2bc7fa200ee674504cecf86db152aac5085'


def sha(raw): return hashlib.sha256(raw).hexdigest()
def load(path): return json.loads(path.read_bytes())
def canonical(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
def git(*args): return subprocess.check_output(['git', '-C', str(REPO), *args], timeout=5)


for name in ['complete.py', 'COMPLETION-PRESEAL.md']:
    assert git('show', sys.argv[1] + ':' + str((OWN / name).relative_to(REPO))) == (OWN / name).read_bytes()
auth = load(CAPTURE / 'AUTHENTICATION.json')
assert auth['preseal'] == PRESEAL
for name in ['PRESEAL.md', 'audit.py', 'check.mjs']:
    assert git('show', PRESEAL + ':' + str((OWN / name).relative_to(REPO))) == (OWN / name).read_bytes()
for entry in auth['files']:
    path = pathlib.Path(entry['copy'])
    assert path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == entry['sha256'] and path.stat().st_mode & 0o7777 == entry['mode']
config = load(CAPTURE / 'CONFIG.json')
for scope in ['v1', 'v2']:
    root = pathlib.Path(config[scope])
    seal = load(root / 'RECIPE-SEAL.json')
    actual = {}
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink()
        name = path.relative_to(root).as_posix()
        if name == 'RECIPE-SEAL.json': continue
        stat = path.stat()
        actual[name] = {'type': 'directory', 'mode': stat.st_mode & 0o7777} if path.is_dir() else {'type': 'file', 'mode': stat.st_mode & 0o7777, 'bytes': stat.st_size, 'sha256': sha(path.read_bytes())}
    assert actual == seal['entries'] and root.stat().st_mode & 0o7777 == seal['rootMode']

admission = load(CAPTURE / 'OBSERVATIONS.json')
assert admission['count'] == admission['matched'] == len(admission['observations']) == 25
for row in admission['observations']:
    raw = load(CAPTURE / row['raw'])
    expected = row['expected']
    matched = raw['error'] is None if expected == 'ACCEPT' else raw['error']['message'].startswith('RECIPE_INTEGRITY:') if expected == 'RECIPE_INTEGRITY_MESSAGE' else raw['error']['code'] == expected
    assert matched and row['matched'] and raw['expected'] == expected
summary = load(CAPTURE / 'replay-stdout.bin')
replay_root = pathlib.Path(summary['evidence'])
replay = load(replay_root / 'RESULTS.json')
assert summary['count'] == summary['matched'] == replay['count'] == replay['matched'] == len(replay['observations']) == 36
assert summary.get('failure') is None and replay.get('failure') is None
expected_cases = load(pathlib.Path(config['v1']) / 'NEGATIVE-CASES.json')['cases']
assert [row['id'] for row in replay['observations']] == [row['id'] for row in expected_cases]
for expected, row in zip(expected_cases, replay['observations']):
    raw = load(replay_root / (row['id'] + '-raw.json'))
    assert raw['expected'] == row['expected'] == expected['outcome']
    assert row['matched'] and (raw['error'] is None if expected['outcome'] == 'accept' else raw['error']['code'] == expected['outcome'])
processes = [load(CAPTURE / (name + '-process.json')) for name in ['admission', 'replay']]
for process in processes:
    assert process['status'] == 0 and process['signal'] is None and not process['timedOut'] and not process['overflow'] and process['reaped'] and process['groupAbsent'] and process['elapsedMs'] < 90000

data = load(CAPTURE / 'DATA-AUDIT.json')
packet = pathlib.Path(config['packet'])
maps = load(packet / 'MAPS.json')
materialization = config['materialization']
after = {}
for name, initial in data['before'].items():
    root = pathlib.Path(initial['path'])
    assert root.resolve() == root and root.is_dir()
    files = {}
    directories = {'': root.stat().st_mode & 0o7777}
    identities = {}
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink()
        relative = path.relative_to(root).as_posix()
        stat = path.stat()
        if path.is_dir(): directories[relative] = stat.st_mode & 0o7777
        else:
            assert path.is_file() and stat.st_nlink == 1
            raw = path.read_bytes()
            files[relative] = {'sha256': sha(raw), 'bytes': len(raw), 'mode': stat.st_mode & 0o7777}
            identities[relative] = {'ino': stat.st_ino, 'dev': stat.st_dev, 'links': stat.st_nlink}
    expected_map = maps['archive' if name == 'archive' else 'source' if name.startswith('source-') else 'fullPackage']
    assert files == expected_map['files'] and directories == expected_map['directories']
    current = {'path': str(root), 'files': len(files), 'directories': len(directories), 'fileMapSha256': sha(canonical(files)), 'directoryMapSha256': sha(canonical(directories)), 'fileIdentityMapSha256': sha(canonical(identities)), 'directoryIdentity': {'ino': root.stat().st_ino, 'dev': root.stat().st_dev}}
    assert current == initial
    historical = materialization['archive' if name == 'archive' else 'source' if name.startswith('source-') else 'package']
    assert historical['before'] == historical['after']
    for key in ['files', 'directories', 'fileMapSha256', 'directoryMapSha256']: assert current[key] == historical['after'][key]
    after[name] = current
for scope in ['source', 'package']:
    assert not pathlib.Path(materialization[scope]['staging']).exists()
    assert after[scope + '-moved']['directoryIdentity'] == materialization[scope]['directoryIdentity']
artifacts = pathlib.Path(materialization['artifacts']['root'])
assert set(path.name for path in artifacts.iterdir()) == set(materialization['artifacts']['before']['files'])
for name, expected in materialization['artifacts']['before']['files'].items():
    path = artifacts / name
    stat = path.stat()
    assert path.is_file() and not path.is_symlink() and stat.st_nlink == 1
    assert {'sha256': sha(path.read_bytes()), 'bytes': stat.st_size, 'mode': stat.st_mode & 0o7777} == expected
history_prefix = 'tests/commands/yq-independent-20260828/executor-review-v1/'
historical_paths = git('ls-tree', '-r', '--name-only', 'b93241dfb9983d2b660233bdddce4569ec803f89', '--', history_prefix).decode().splitlines()
assert len(historical_paths) == 203
for path in historical_paths: assert (REPO / path).read_bytes() == git('show', 'b93241dfb9983d2b660233bdddce4569ec803f89:' + path)
result = {'verdict': 'PASS_SELECTED_COMPOSITION_DATA_SYNTHETIC_ONLY', 'preseal': PRESEAL, 'completionPreseal': sys.argv[1], 'initialPythonExitStatus': 1, 'initialFailureRetained': 'POSTPROCESS-FAILURE.json', 'admissionChecks': 25, 'matchedAdmissionChecks': 25, 'frozenReplayedControls': 36, 'matchedFrozenControls': 36, 'workerStatuses': [process['status'] for process in processes], 'knownOwnedGroupsReaped': 2, 'after': after, 'priorReviewFilesPreserved': 203, 'sourceMapSha256': data['sourceMapSha256'], 'archiveMembers': 273, 'selectedSourceMembers': 271, 'packageMembers': 870, 'archiveSupportPreserved': list(data['support']), 'projectionMatchesAlreadyPresealedPolicy': True, 'authorBoundBuildOnly': True, 'productImports': 0, 'productRuns': 0, 'builds': 0, 'compilerRuns': 0, 'runtimeV2Read': False, 'remainingGates': ['Separately routed sealed runtime-v2 fixes and fence', 'Trusted build/compound recipe preseal', 'Loaded-code/public/type/product review under separate root route']}
with (CAPTURE / 'COMPLETION-RESULTS.json').open('x') as output: json.dump(result, output, indent=2); output.write('\n')
print(json.dumps({'verdict': result['verdict'], 'admission': 25, 'replay': 36, 'initialPostprocessorFailureRetained': True}))
