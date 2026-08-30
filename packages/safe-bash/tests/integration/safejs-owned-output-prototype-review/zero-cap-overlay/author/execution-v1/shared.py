import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone


REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
OWNER = Path(__file__).resolve().parent
AUTHOR_PATH = 'tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay/author'
AUTHOR_COMMIT = 'a61e63bc46e8389e59c0d8fdc1d424003f62c769'
ADMISSION_COMMIT = '88367f70feb90b589a3aa2651700ba187b1336dc'
ADMISSION_PATH = 'tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay/independent/admission-v1/ADMISSION.json'
PRIVATE = Path('/Users/kjopek/Workspace/poe-code')
PREPARED = Path('/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK')
RECEIPTS = Path('/private/tmp/safe-bash-owned-output-receipt-review-zqBitE')
NODE = Path('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node')
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'TZ': 'UTC', 'GIT_OPTIONAL_LOCKS': '0'}


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def git(*arguments, root=REPOSITORY):
    return subprocess.check_output(['/usr/bin/git', '-C', str(root), '-c', 'core.fsmonitor=false', *arguments], env=ENVIRONMENT, timeout=20)


def blob(commit, path):
    return git('show', f'{commit}:{path}')


def regular(path):
    path = Path(path)
    assert path.resolve() == path and path.is_file() and not path.is_symlink(), path
    return path.read_bytes()


def load(path):
    return json.loads(regular(path))


def record(path, metadata=False):
    value = regular(path)
    info = Path(path).stat()
    return {'bytes': len(value), 'sha256': sha(value), **({'mode': info.st_mode & 0o777, 'mtimeNs': info.st_mtime_ns, 'ctimeNs': info.st_ctime_ns} if metadata else {})}


def inventory(root, metadata=False, excluded=()):
    root = Path(root)
    assert root.resolve() == root and root.is_dir() and not root.is_symlink(), root
    entries = []
    def visit(directory):
        for path in sorted(directory.iterdir()):
            if path.name in excluded:
                continue
            assert not path.is_symlink(), path
            if path.is_dir():
                visit(path)
            else:
                entries.append({'path': path.relative_to(root).as_posix(), **record(path, metadata)})
    visit(root)
    return sorted(entries, key=lambda entry: entry['path'])


def shape(root, excluded=()):
    root = Path(root)
    entries = []
    def visit(directory):
        for path in sorted(directory.iterdir()):
            if path.name in excluded:
                continue
            assert not path.is_symlink() and (path.is_file() or path.is_dir()), path
            entries.append({'path': path.relative_to(root).as_posix(), 'kind': 'directory' if path.is_dir() else 'file'})
            if path.is_dir():
                visit(path)
    visit(root)
    return entries


def snapshot(roots):
    return {str(root): {'files': inventory(Path(root), True), 'shape': shape(Path(root))} for root in roots}


def put(path, value):
    path = Path(path)
    text = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False) + '\n'
    assert not path.exists(), path
    patch = f'*** Begin Patch\n*** Add File: {path}\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), check=True, stdout=subprocess.DEVNULL)
    assert path.read_text() == text


def raw_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as output:
        json.dump(value, output, indent=2, ensure_ascii=False)
        output.write('\n')


def copy_tree(source, target, expected):
    assert inventory(source) == expected
    for entry in expected:
        destination = Path(target) / entry['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as output:
            output.write(regular(Path(source) / entry['path']))
        destination.chmod(0o444)
    assert inventory(target) == expected


def private_snapshot():
    text = lambda *args: git(*args, root=PRIVATE).decode()
    index = Path(text('rev-parse', '--git-path', 'index').strip())
    if not index.is_absolute():
        index = PRIVATE / index
    excluded = ['.git', 'node_modules', 'dist', '.cache', '.turbo']
    return {
        'head': text('rev-parse', 'HEAD').strip(), 'tree': text('rev-parse', 'HEAD^{tree}').strip(),
        'status': text('status', '--porcelain=v1'), 'staged': text('diff', '--cached', '--name-status'),
        'index': record(index, True),
        'metadata': {name: record(PRIVATE / name, True) for name in ['AGENTS.md', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'packages/poe-agent/package.json']},
        'engine': inventory(PRIVATE / 'packages/safejs', True, excluded),
        'engineShape': shape(PRIVATE / 'packages/safejs', excluded),
        'qualification': {'optionalLocks': '0', 'fsmonitor': 'disabled per command', 'excludedNamesAtEveryDepth': excluded, 'newEligibleFilesAndDirectoriesDetected': True, 'atimeChecked': False, 'atomicInterveningStateChecked': False},
    }


def verify_freeze():
    freeze = load(OWNER / 'EXECUTION-FREEZE.json')
    path = (OWNER / 'EXECUTION-FREEZE.json').relative_to(REPOSITORY).as_posix()
    commit = git('log', '-1', '--format=%H', '--', path).decode().strip()
    assert len(commit) == 40
    assert blob(commit, path) == regular(OWNER / 'EXECUTION-FREEZE.json')
    for entry in freeze['files']:
        filename = OWNER / entry['path']
        assert record(filename) == {key: entry[key] for key in ['bytes', 'sha256']}
        assert blob(commit, filename.relative_to(REPOSITORY).as_posix()) == regular(filename)
    return commit
