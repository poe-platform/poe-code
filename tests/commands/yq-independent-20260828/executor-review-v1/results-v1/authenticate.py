import hashlib
import json
import os
import pathlib
import subprocess
import tempfile

REPOSITORY = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWNED = REPOSITORY / 'tests/commands/yq-independent-20260828/executor-review-v1'
PREFIX = 'tests/commands/yq-independent-20260828/executor-preparation-v1/'
RUNTIME_SOURCE = 'c49d494dd5a36b19198680239a72e0c95cb90d8d'
RUNTIME_EVIDENCE = 'ee9d0c1fd24b33aa918154eb379a92c02cfe5925'
CONSUMERS = '409449136ae1adc252ff6e205a6bb5785d113d0f'
FINAL = 'bd471ef682d768692a682d40009a874f51e3ad68'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', '-C', str(REPOSITORY), *args], timeout=5)


def read(revision, path):
    return git('show', revision + ':' + path)


def write(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as output:
        output.write(data)
    path.chmod(mode)


prepared = {
    'PROTOCOL.md': ('d7290477ea464928f02d790314eef6775fdf3c8d', '835bdef49c605140321112a700e61fae1f61cf2db6d9c721ec81876c653336c6'),
    'FIXTURES.json': ('d7290477ea464928f02d790314eef6775fdf3c8d', '4384ea29a4c094798e43154e1c216e8bd2f750330903fa4c835526887b1b31f6'),
    'PRE-REVIEW-ER08-CLARIFICATION-v1.md': ('5a24badf0016cfa535fbb372ac80907f7bf83f0c', 'afeaa21716f6483e457c1e4973f24f4d1435b5a08bae04d4994cb9bb76a1da81'),
}
for name, (revision, expected) in prepared.items():
    path = OWNED / name
    data = read(revision, str(path.relative_to(REPOSITORY)))
    assert digest(data) == expected and path.read_bytes() == data

temporary = pathlib.Path(tempfile.mkdtemp(prefix='yq-independent-framework-')).resolve()
evidence = pathlib.Path(tempfile.mkdtemp(prefix='capture-', dir=OWNED / 'results-v1')).resolve()
author = temporary / 'authenticated'
identities = []


def materialize(revision, path, destination, expected=None, mode=0o644):
    entry = git('ls-tree', revision, '--', path).decode().strip().split()
    assert entry[0] == '100644' and entry[1] == 'blob' and entry[3] == path
    data = read(revision, path)
    if expected is not None:
        assert digest(data) == expected, path
    write(destination, data, mode)
    identities.append({'commit': revision, 'path': path, 'blob': entry[2], 'gitMode': entry[0], 'mode': mode, 'bytes': len(data), 'sha256': digest(data), 'materialized': str(destination)})
    return data


runtime_path = PREFIX + 'runtime/'
runtime_root = author / runtime_path
seal_bytes = materialize(RUNTIME_EVIDENCE, runtime_path + 'RECIPE-SEAL.json', runtime_root / 'RECIPE-SEAL.json', '2fce675f035a2ad39c2e2e2ee9d54e2762a531383e70507149993268acedb7e8')
runtime_seal = json.loads(seal_bytes)
assert digest(json.dumps(runtime_seal['entries'], separators=(',', ':')).encode()) == runtime_seal['treeSha256'] == 'e04229e35902d8dd34c91c0adfbb357120312ff743ecdc9434b0d239c152db78'
for entry in runtime_seal['entries']:
    if entry['kind'] == 'directory':
        destination = runtime_root / 'recipe' / entry['path']
        destination.mkdir(parents=True, exist_ok=True)
        destination.chmod(entry['mode'])
    else:
        materialize(RUNTIME_SOURCE, runtime_path + 'recipe/' + entry['path'], runtime_root / 'recipe' / entry['path'], entry['sha256'], entry['mode'])

consumer_path = PREFIX + 'consumers/'
consumer_root = author / consumer_path
seal_bytes = materialize(CONSUMERS, consumer_path + 'RECIPE-SEAL.json', consumer_root / 'RECIPE-SEAL.json', '24e28a529cec877b82835d81ba3f274702a28d43ab5285754b7bd1ef0b82f98d')
consumer_seal = json.loads(seal_bytes)
consumer_root.chmod(consumer_seal['rootMode'])
for name, entry in consumer_seal['entries'].items():
    destination = consumer_root / name
    if entry['type'] == 'directory':
        destination.mkdir(parents=True, exist_ok=True)
        destination.chmod(entry['mode'])
    else:
        materialize(CONSUMERS, consumer_path + name, destination, entry['sha256'], entry['mode'])

frozen = temporary / 'frozen'
bindings = json.loads((runtime_root / 'recipe/source-bindings.json').read_bytes())
for binding in bindings['bindings']:
    assert binding['path'].startswith('tests/commands/yq-'), 'No product-source materialization'
    materialize(binding['revision'], binding['path'], frozen / binding['path'], binding['sha256'], binding['mode'])
for scope in bindings['scopes']:
    for entry in scope['entries']:
        destination = frozen / scope['path'] / entry['path']
        if entry['kind'] == 'directory':
            destination.mkdir(parents=True, exist_ok=True)
            destination.chmod(entry['mode'])
        elif destination.exists():
            assert digest(destination.read_bytes()) == entry['sha256']
        else:
            path = scope['path'] + '/' + entry['path']
            materialize(FINAL, path, destination, entry['sha256'], entry['mode'])

node = pathlib.Path('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node')
result = {
    'date': '2026-08-28', 'classification': 'AUTHENTICATED_SYNTHETIC_FRAMEWORK_ONLY',
    'prepared': {name: {'commit': revision, 'sha256': expected} for name, (revision, expected) in prepared.items()},
    'runtimeProtocolCommit': '0f138190073cb5419aa86c63e0a10075fe67f88f',
    'runtimeInitialCommit': 'd77e8714e9e6a97d689045f6dd66afafd5842a2d',
    'runtimeSourceCommit': RUNTIME_SOURCE, 'runtimeEvidenceCommit': RUNTIME_EVIDENCE,
    'consumerPresealCommit': '21ad8c589d7f138064616e8f37e748e6a2e7c200', 'consumerCommit': CONSUMERS,
    'actualProductCandidateNotReadOrExecuted': '35da18547ca82a67be9ca22b4adc21e3b8060780',
    'temporary': str(temporary), 'evidence': str(evidence), 'runtime': str(runtime_root),
    'consumers': str(consumer_root), 'frozen': str(frozen), 'node': str(node),
    'nodeSha256': digest(node.read_bytes()), 'files': identities,
    'authorControlsExecuted': 0, 'productImports': 0, 'productExecutions': 0, 'builds': 0, 'typeCompiles': 0,
}
write(evidence / 'AUTHENTICATION.json', (json.dumps(result, indent=2) + '\n').encode())
print(evidence / 'AUTHENTICATION.json')
