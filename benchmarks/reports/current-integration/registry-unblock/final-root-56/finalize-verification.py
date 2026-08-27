import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

from execute import HERE, PARENT, base, inventory

evidence = base.EVIDENCE
state = json.loads((evidence / 'sealed-input.json').read_text())
accounting = json.loads((evidence / 'accounting.json').read_text())
required = {
    'standard': ['cat', 'cp', 'find', 'mkdir', 'mv', 'printf', 'pwd', 'rm', 'rmdir', 'sort', 'tee', 'test', 'touch', 'xargs'],
    'text': ['sed', 'awk'], 'structured': ['jq'], 'search': ['rg'], 'bytes': ['sha256sum', 'gzip'], 'diffPatch': ['diff', 'patch'],
}
backends = ['memory', 'real', 's3', 'webdav', 'mount', 'overlay', 'readonly']
expected = {(backend, family, name) for backend in backends for family, names in required.items() for name in names}
observed = accounting['independentMissingControls']
assert {(entry['backend'], entry['family'], entry['missing']) for entry in observed} == expected
for entry in observed:
    assert entry['beforeCount'] == len(entry['baselineNames']) == len(set(entry['baselineNames'])) == entry['afterCount']
    assert not entry['callbackEntered']
    assert entry['observed'] == f"adapter-tools preflight: missing required {entry['family']} command: {entry['missing']}"
for entry in accounting['independentOptionalWorkflowControls']:
    assert entry['beforeCount'] == len(entry['baselineNames']) and entry['afterCount'] == entry['beforeCount'] + 1
    assert entry['callbackEntered'] and entry['optionalExecuted']
harness = (HERE / 'independent-mutations.test.mjs').read_text()
assert not re.search(r'\b(?:52|53|54|56|57)\b|expected-default-commands|readFile', harness)
manifests = {}
for directory in [PARENT, PARENT / 'post-tar-default', PARENT.parent]:
    entries = (directory / 'ARTIFACTS.sha256').read_text().splitlines()
    for line in entries:
        expected_hash, name = line.split('  ', 1)
        assert base.digest(directory / name) == expected_hash, (directory, name)
    manifests[str(directory)] = {'entries': len(entries), 'sha256': base.digest(directory / 'ARTIFACTS.sha256')}
old_manifest = (HERE / 'historical52-manifest-before-erratum.sha256').read_text()
old_readme = (PARENT / 'README.md').read_text().replace('the other 27 test instances', 'the other eleven tests')
for line in old_manifest.splitlines():
    expected_hash, name = line.split('  ', 1)
    actual_hash = hashlib.sha256(old_readme.encode()).hexdigest() if name == 'README.md' else base.digest(PARENT / name)
    assert actual_hash == expected_hash, name
snapshots = {}
seen_inodes = set()
accepted_deps = json.loads((PARENT.parent / 'dependencies.json').read_text())['root']
phase_directories = [PARENT / 'execution', PARENT / 'post-tar-default/selection-attempt1', PARENT / 'post-tar-default/execution', evidence]
all_phases = []
for index, directory in enumerate(phase_directories):
    captured = json.loads((directory / 'sealed-input.json').read_text())
    for kind, location in [('baseline', Path(captured['source'])), ('mutation', Path(captured['workspace']) / 'mutation-source')]:
        result = base.verify_source(captured['files'], location)
        assert result['same']
        for name in captured['files']:
            path = location / name
            details = path.stat()
            inode = (details.st_dev, details.st_ino)
            assert inode not in seen_inodes and path.resolve().is_relative_to(location.resolve())
            seen_inodes.add(inode)
            for ancestor in path.parents:
                if ancestor == location:
                    break
                assert not ancestor.is_symlink()
        for name, entry in accepted_deps['files'].items():
            path = location / 'node_modules' / name
            assert path.stat().st_nlink == 1 and not path.is_symlink() and base.digest(path) == entry['sha256']
        extras = [str(path.relative_to(location)) for path in location.rglob('*') if path.is_file() and
                  not path.is_relative_to(location / 'node_modules') and str(path.relative_to(location)) not in captured['files']]
        assert all(name.startswith(('audit/', 'dist/')) for name in extras), extras
        snapshots[f'phase{index}-{kind}'] = {'path': str(location), 'inputHash': result['fingerprint'],
                                            'files': len(captured['files']), 'unchanged': True, 'regularIndependentInodes': True,
                                            'lockedDependencyFilesMatch': 314, 'extraFiles': extras, 'fixtureDebris': []}
    for name in ['phase-results.json', 'supplement-phase-results.json']:
        all_phases.extend(json.loads((directory / name).read_text()))
expectations = {}
for name in ['tests/commands/structured-stress/final-increment/fresh-native.json',
             'tests/commands/structured-stress/split-increment/native.json',
             'tests/commands/structured-stress/split-increment/evidence.ts',
             'tests/integration/adapter-tools-diagnostics/reference.json']:
    assert base.digest(Path(state['source']) / name) == base.digest(base.OLD / name)
    expectations[name] = base.digest(Path(state['source']) / name)
base.save(evidence / 'mutation-static-entrypoints.json', ['audit/independent-mutations.test.mjs'])
env = json.loads((evidence / 'independent162.environment.json').read_text())['env']
closure = subprocess.run(['node', str(PARENT / 'static-closure.mjs'), str(Path(state['workspace']) / 'mutation-source'),
                          str(evidence / 'mutation-static-entrypoints.json')], env=env, capture_output=True, text=True, timeout=30)
assert closure.returncode == 0, closure.stderr
(evidence / 'mutation-static-closure.json').write_text(closure.stdout)
groups = {phase['pid'] for phase in all_phases}
processes = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,command='], text=True).splitlines()
remaining = [line for line in processes if len(line.split(None, 2)) == 3 and int(line.split(None, 2)[1]) in groups]
assert not remaining
files, exclusions = inventory()
review = Path('/tmp/safe-bash-registry-unblock-evidence-review-detail.txt')
base.save(evidence / 'final-verification.json', {
    'capturedEpoch': time.time(), 'elapsedSinceFinalFreezeSeconds': time.time() - state['startedEpoch'],
    'priorManifests': manifests, 'historical52OnlyAuthorizedSentenceChanged': True,
    'originalHistorical52ManifestSha256': base.digest(HERE / 'historical52-manifest-before-erratum.sha256'),
    'exactRequiredMutationIdentitiesVerified': len(expected), 'workflowHarnessHasNoFixedFullRegistryCountOrCatalogImport': True,
    'measuredBaselineCountsNotExpectedConstants': sorted({entry['beforeCount'] for entry in observed}),
    'measuredOptionalCountsNotExpectedConstants': sorted({entry['afterCount'] for entry in accounting['independentOptionalWorkflowControls']}),
    'snapshots': snapshots, 'expectationsUnchanged': expectations, 'remainingOwnedGroups': remaining,
    'liveFinalSeparate': base.live_state(), 'liveSelectedFilesAfter': files, 'liveExclusionsAfter': exclusions,
    'liveSelectedHashAfter': base.fingerprint(files),
    'liveSelectedDrift': sorted(name for name in set(files) | set(state['files']) if files.get(name) != state['files'].get(name)),
    'review': {'path': str(review), 'sha256': base.digest(review), 'status': '52 raw evidence accepted with report-only erratum; final56 and post53 evidence review pending'},
})
print(json.dumps({'manifests': [entry['entries'] for entry in manifests.values()], 'snapshots': len(snapshots),
                  'exactRequiredMutations': len(expected), 'remainingGroups': remaining, 'elapsedSeconds': time.time() - state['startedEpoch']}))
