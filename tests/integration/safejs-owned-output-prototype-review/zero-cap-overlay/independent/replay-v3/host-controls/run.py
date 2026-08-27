import hashlib
import json
from pathlib import Path
import subprocess

REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
HERE = Path(__file__).resolve().parent
EXECUTION = HERE.parent / 'execution'
BINDINGS = json.loads((EXECUTION / 'BINDINGS.json').read_bytes())
RUNTIME = Path(BINDINGS['runtimeRoot'])
OUTPUT = Path(BINDINGS['outputRoot']) / 'finite-host-controls'
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with (OUTPUT / name).open('xb') as stream:
        stream.write(data)


def authenticate():
    own_path = (HERE / 'run.py').relative_to(REPOSITORY).as_posix()
    commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', own_path], cwd=REPOSITORY, env=ENVIRONMENT).decode().strip()
    assert subprocess.check_output(['git', 'show', commit + ':' + own_path], cwd=REPOSITORY, env=ENVIRONMENT) == (HERE / 'run.py').read_bytes()
    records = []
    for name in ['surface/controls.mjs', 'surface/child.mjs']:
        path = RUNTIME / name
        assert path.resolve() == path and path.is_file() and not path.is_symlink()
        data = path.read_bytes()
        entry = next(entry for entry in BINDINGS['runtimeEntries'] if entry['path'] == name)
        assert sha(data) == entry['sha256'] and len(data) == entry['bytes']
        original = subprocess.check_output(['git', 'show', BINDINGS['authorFreezeCommit'] + ':tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay/author/' + name], cwd=REPOSITORY, env=ENVIRONMENT)
        assert data == original
        records.append(entry)
    node = Path(BINDINGS['node']['path'])
    assert node.resolve() == node and sha(node.read_bytes()) == BINDINGS['node']['sha256']
    return {'hostControlFreezeCommit': commit, 'runtimeExecutionFreezeCommit': '63d730a48ab0048fc16561164d6eeedb5f6cf1d1', 'inputs': records, 'node': BINDINGS['node']}


def main():
    assert Path.cwd() == REPOSITORY
    summary = json.loads((Path(BINDINGS['outputRoot']) / 'independent-summary.json').read_bytes())
    assert summary['allPass'] and all(entry['status'] == 'PASS' for entry in summary['runs'])
    OUTPUT.mkdir()
    before = authenticate()
    save('inputs-before.json', before)
    command = [BINDINGS['node']['path'], str(RUNTIME / 'surface/controls.mjs')]
    save('STARTED.json', {'command': command, 'timeoutSeconds': 5, 'qualification': 'Same predeclared nine finite observer host controls; no guest/product/private engine execution; not an additional25-profile attempt'})
    result = subprocess.run(command, cwd=REPOSITORY, env=ENVIRONMENT, capture_output=True, timeout=5)
    save('stdout.json', result.stdout)
    save('stderr.txt', result.stderr)
    save('inputs-after.json', authenticate())
    assert authenticate() == before
    assert result.returncode == 0 and not result.stderr
    raw = json.loads(result.stdout)
    assert len(raw['results']) == 9
    assert raw['guestExecutions'] == raw['productImports'] == raw['privateEngineImports'] == 0
    for entry in raw['results']:
        assert entry['pass'] and entry['calls'] == entry['finalizers'] == 1
        assert entry['sameReferenceOrPrimitive'] is True and entry['getterReads'] == 0
    save('RESULT.json', {'exitCode': result.returncode, 'controls': 9, 'pass': 9, 'guestExecutions': 0, 'privateQueries': 0, 'noPromotion': True})
    print(json.dumps({'finiteHostControls': 9, 'pass': 9, 'guestExecutions': 0}))


if __name__ == '__main__':
    main()
