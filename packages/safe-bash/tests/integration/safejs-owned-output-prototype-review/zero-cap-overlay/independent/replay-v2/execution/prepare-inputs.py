from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
BASE = 'tests/integration/safejs-owned-output-prototype-review'
AUTHOR_PATH = BASE + '/zero-cap-overlay/author'
AUTHOR_COMMIT = 'a61e63bc46e8389e59c0d8fdc1d424003f62c769'
HERE = Path(__file__).resolve().parent
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPOSITORY), '-c', 'core.fsmonitor=false', *args], env=ENVIRONMENT, timeout=20)


def add(filename, value):
    path = HERE / filename
    assert not path.exists()
    text = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    patch = f'*** Begin Patch\n*** Add File: {path.relative_to(REPOSITORY)}\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), cwd=REPOSITORY, check=True)


def main():
    assert Path.cwd() == REPOSITORY
    prior = REPOSITORY / BASE / 'zero-cap-overlay/independent/replay-v1/execution'
    old_bindings = json.loads(git('show', f'326ca8e758ac0ac4167ba09418e7b7667d6ee5e1:{prior.relative_to(REPOSITORY)}/BINDINGS.json'))
    expected = old_bindings['authorFiles']
    assert len(expected) == 88
    authority = git('ls-tree', '-r', '--name-only', AUTHOR_COMMIT, '--', AUTHOR_PATH).decode().splitlines()
    assert sorted(authority) == sorted(AUTHOR_PATH + '/' + entry['path'] for entry in expected)
    output = Path(tempfile.mkdtemp(prefix='safe-bash-zero-overlay-independent-v2-', dir='/private/tmp')).resolve()
    snapshot = output / 'input-snapshot'
    snapshot.mkdir()
    for name in ['home', 'tmp']:
        (output / name).mkdir()
    copied = []
    for entry in expected:
        data = git('show', f"{AUTHOR_COMMIT}:{AUTHOR_PATH}/{entry['path']}")
        assert len(data) == entry['bytes'] and sha(data) == entry['sha256']
        target = snapshot / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(0o400)
        assert target.resolve() == target and target.read_bytes() == data
        copied.append({'path': entry['path'], 'bytes': len(data), 'sha256': sha(data), 'commit': AUTHOR_COMMIT,
                       'gitPath': AUTHOR_PATH + '/' + entry['path']})
    shape = []
    for path in sorted(snapshot.rglob('*')):
        assert not path.is_symlink()
        shape.append({'path': path.relative_to(snapshot).as_posix(), 'kind': 'directory' if path.is_dir() else 'file'})
    for path in sorted(snapshot.rglob('*'), reverse=True):
        if path.is_dir():
            path.chmod(0o500)
    snapshot.chmod(0o500)
    ignored = []
    expected_names = {entry['path'] for entry in expected}
    for directory, directories, filenames in os.walk(REPOSITORY / AUTHOR_PATH, followlinks=False):
        for name in sorted(filenames):
            path = Path(directory) / name
            relative = path.relative_to(REPOSITORY / AUTHOR_PATH).as_posix()
            if relative not in expected_names:
                ignored.append({'path': relative, 'classification': 'LIVE_EXECUTION_EVIDENCE_NOT_AN_INPUT',
                                'contentReadOrExecuted': False})
    references = {}
    def bind(commit, path, expected_sha=None):
        data = git('show', f'{commit}:{path}')
        if expected_sha:
            assert sha(data) == expected_sha
        references[(commit, path)] = {'commit': commit, 'path': path, 'bytes': len(data), 'sha256': sha(data)}
    for entry in json.loads((snapshot / 'REFERENCES.json').read_bytes()):
        bind(entry['commit'], entry['path'], entry['sha256'])
    for commit, prefix in [('19da254941847de60e80ea18407332bbe10b5265', BASE + '/lifecycle'),
                           ('37b89260c16e51dbf3f825f111d5f5b3c5ea32e8', BASE + '/lifecycle/validity-proposal')]:
        for path in git('ls-tree', '-r', '--name-only', commit, '--', prefix).decode().splitlines():
            bind(commit, path)
    bindings = {**old_bindings, 'authorRoot': str(snapshot), 'authorGitRoot': str(REPOSITORY / AUTHOR_PATH),
                'outputRoot': str(output), 'authorDirectoryShape': shape, 'publicReferenceBindings': list(references.values()),
                'parentExecution': 'Exact copied88 Git blobs, including unmodified admission/run/child/scorer/guest files. Parent-only preload translates two exact public Git lookup argument shapes back to their pinned original Git paths; no author code transformation.',
                'inputBindingVersion': 2, 'priorRefusalCommit': '8e950bd846f69b86f851d2a901e62e0b3bb92ded',
                'driverAdaptations': 0, 'runtimeGuestProductExecutionsAtPreparation': 0}
    add('BINDINGS.json', bindings)
    release = {key: bindings[key] for key in ['authorFreezeCommit', 'candidateManifestSha256', 'sourceManifestSha256', 'candidateRoot', 'packageRoot', 'outputRoot']}
    release.update({'noPromotion': True, 'rootAuthorized': True,
                    'rootAuthorization': 'ROOT NARROW VERSIONED INPUT-BINDING REPAIR and ONE new attempt release, 2026-08-27, verifier thread01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4; isolated exact88 inputs plus only public Git run-location identity rebinding; same8/11/6 cohorts and unchanged stop scopes/positive prerequisites; no retry or semantic/source/limit/signal/cleanup change.',
                    'allowedCohorts': bindings['cohorts'], 'independentReviewCommit': bindings['admissionCommit'],
                    'independentReviewPath': bindings['admissionPath']})
    add('ROOT-RELEASE.json', release)
    old_run = git('show', f'326ca8e758ac0ac4167ba09418e7b7667d6ee5e1:{prior.relative_to(REPOSITORY)}/run.py').decode()
    run = old_run.replace("path = (AUTHOR / entry['path']).relative_to(REPOSITORY).as_posix()", "path = (Path(BINDINGS['authorGitRoot']) / entry['path']).relative_to(REPOSITORY).as_posix()")
    run = run.replace("assert inventory(AUTHOR) == BINDINGS['authorFiles']", "assert inventory(AUTHOR) == BINDINGS['authorFiles']\n    shape = [{'path': path.relative_to(AUTHOR).as_posix(), 'kind': 'directory' if path.is_dir() else 'file'} for path in sorted(AUTHOR.rglob('*'))]\n    assert shape == BINDINGS['authorDirectoryShape']\n    for entry in BINDINGS['publicReferenceBindings']:\n        data = git(REPOSITORY, 'show', f\"{entry['commit']}:{entry['path']}\")\n        assert sha(data) == entry['sha256'] and (REPOSITORY / entry['path']).read_bytes() == data")
    run = run.replace("['candidateRoot', 'packageRoot']", "['candidateRoot', 'packageRoot', 'authorRoot']")
    run = run.replace("command = [str(NODE), str(AUTHOR / cohort / 'run.mjs')]", "command = [str(NODE), '--import', str(HERE / 'git-location-binding.mjs'), str(AUTHOR / cohort / 'run.mjs')]")
    run = run.replace("'ZERO_OVERLAY_ROOT_RELEASE': str(HERE / 'ROOT-RELEASE.json')", "'ZERO_OVERLAY_ROOT_RELEASE': str(HERE / 'ROOT-RELEASE.json'),\n                           'ZERO_OVERLAY_GIT_BINDING_LOG': str(directory / 'git-bindings.ndjson')")
    add('run.py', run)
    assessor = git('show', f'326ca8e758ac0ac4167ba09418e7b7667d6ee5e1:{prior.relative_to(REPOSITORY)}/assess.py')
    add('assess.py', assessor.decode())
    import difflib
    add('orchestration-delta.patch-data', ''.join(difflib.unified_diff(old_run.splitlines(True), run.splitlines(True), fromfile='326ca8e7/run.py', tofile='replay-v2/run.py')))
    add('INPUT-PROVENANCE.json', {'at': datetime.now(timezone.utc).isoformat(), 'authorCommit': AUTHOR_COMMIT,
        'sourceOfEveryInput': 'Exact named Git blob; current author working tree not source', 'expectedFiles': 88,
        'copiedFiles': copied, 'snapshotRoot': str(snapshot), 'snapshotDirectoryShape': shape,
        'original88AuthorBytesChanged': 0, 'assessorUnchangedFrom326ca8e7Sha256': sha(assessor),
        'publicReferences': len(references), 'liveNonInputsEnumeratedOnce': sorted(ignored, key=lambda entry: entry['path']),
        'nonInputPolicy': 'No pruning or ignored subtree in snapshot authentication. The input snapshot is exactly the Git set and rejects all unknown files/directories. Mutable live author execution evidence is never loaded.',
        'privateQueries': 0, 'runtimeExecutions': 0, 'noPromotion': True})
    print(json.dumps({'outputRoot': str(output), 'snapshotRoot': str(snapshot), 'exactGitFiles': 88,
                      'publicReferences': len(references), 'liveNonInputs': len(ignored), 'runtimeExecutions': 0}))


if __name__ == '__main__':
    main()
