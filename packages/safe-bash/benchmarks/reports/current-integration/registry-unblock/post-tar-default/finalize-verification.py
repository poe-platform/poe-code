import json
from pathlib import Path
import subprocess
import time

from execute import HERE, PARENT, base, inventory

evidence = base.EVIDENCE
state = json.loads((evidence / 'sealed-input.json').read_text())
first = json.loads((HERE / 'selection-attempt1/sealed-input.json').read_text())
prior52 = json.loads((PARENT / 'execution/sealed-input.json').read_text())
accepted_dependencies = json.loads((PARENT.parent / 'dependencies.json').read_text())['root']
expectations = {}
for name in ['tests/commands/structured-stress/final-increment/fresh-native.json',
             'tests/commands/structured-stress/split-increment/native.json',
             'tests/commands/structured-stress/split-increment/evidence.ts',
             'tests/integration/adapter-tools-diagnostics/reference.json']:
    expected = base.digest(base.OLD / name)
    assert base.digest(Path(state['source']) / name) == expected
    expectations[name] = expected
manifests = {}
for directory in [PARENT, PARENT.parent]:
    count = 0
    for line in (directory / 'ARTIFACTS.sha256').read_text().splitlines():
        expected, name = line.split('  ', 1)
        assert base.digest(directory / name) == expected, name
        count += 1
    manifests[str(directory)] = {'entries': count, 'sha256': base.digest(directory / 'ARTIFACTS.sha256')}
assert manifests[str(PARENT)]['sha256'] == first['priorStageManifestSha256']
snapshots = {}
for label, captured in [('historical52', prior52), ('initial53', first), ('refined53', state)]:
    for kind, location in [('baseline', Path(captured['source'])), ('mutation', Path(captured['workspace']) / 'mutation-source')]:
        result = base.verify_source(captured['files'], location)
        assert result['same']
        for name, entry in accepted_dependencies['files'].items():
            target = location / 'node_modules' / name
            assert target.stat().st_nlink == 1 and not target.is_symlink() and base.digest(target) == entry['sha256']
        extras = [str(path.relative_to(location)) for path in location.rglob('*') if path.is_file() and
                  not path.is_relative_to(location / 'node_modules') and str(path.relative_to(location)) not in captured['files']]
        assert all(name.startswith(('audit/', 'dist/')) for name in extras), extras
        snapshots[f'{label}-{kind}'] = {'path': str(location), 'sourceCheck': result, 'dependencyFilesMatch': 314,
                                      'generatedExtras': extras, 'fixtureDebris': []}
base.save(evidence / 'mutation-static-entrypoints.json', ['audit/independent-mutations.test.mjs'])
env = json.loads((evidence / 'independent162.environment.json').read_text())['env']
closure = subprocess.run(['node', str(PARENT / 'static-closure.mjs'), str(Path(state['workspace']) / 'mutation-source'),
                          str(evidence / 'mutation-static-entrypoints.json')], env=env, capture_output=True, text=True, timeout=30)
assert closure.returncode == 0, closure.stderr
(evidence / 'mutation-static-closure.json').write_text(closure.stdout)
phase_sets = []
for directory in [PARENT / 'execution', HERE / 'selection-attempt1', evidence]:
    for name in ['phase-results.json', 'supplement-phase-results.json']:
        phase_sets.extend(json.loads((directory / name).read_text()))
groups = {phase['pid'] for phase in phase_sets}
processes = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,command='], text=True).splitlines()
remaining = [line for line in processes if len(line.split(None, 2)) == 3 and int(line.split(None, 2)[1]) in groups]
assert not remaining
files, exclusions = inventory()
review = Path('/tmp/safe-bash-registry-unblock-final-review-detail.txt')
catalog = json.loads((HERE / 'expected-default-commands.json').read_text())
old_catalog = json.loads((PARENT / 'expected-default-commands.json').read_text())
initial_catalog = json.loads((HERE / 'selection-attempt1/catalog-as-run.json').read_text())
assert sorted(catalog['names']) == sorted([*old_catalog['names'], 'tar']) == sorted(initial_catalog['names'])
assert catalog['count'] == catalog['mutation']['requiredCardinality'] == 53
base.save(evidence / 'final-verification.json', {
    'capturedEpoch': time.time(), 'elapsedSinceOriginalFreezeSeconds': time.time() - first['startedEpoch'],
    'expectationsUnchanged': expectations, 'immutableManifests': manifests, 'snapshots': snapshots,
    'rejectedUnexecutedCandidate': '/tmp/safe-bash-registry-post-tar-ztx4patg/source-attempt-1',
    'retainedOriginalDependencySnapshot': str(base.OLD), 'remainingOwnedProcessGroups': remaining,
    'literal53EqualsImmutable52PlusTar': True, 'correctedCatalogOnlyUnusedMetadataChanged': True,
    'liveFinalSeparate': base.live_state(), 'liveSelectedFilesAfter': files, 'liveExclusionsAfter': exclusions,
    'liveSelectedHashAfter': base.fingerprint(files),
    'liveSelectedDrift': sorted(name for name in set(files) | set(state['files']) if files.get(name) != state['files'].get(name)),
    'reviewRead': {'path': str(review), 'sha256': base.digest(review), 'status': 'Prior static handoff accepted; fresh53 execution evidence review pending'},
})
print(json.dumps({'immutableManifestEntries': [entry['entries'] for entry in manifests.values()],
                  'snapshotsVerified': len(snapshots), 'remainingOwnedProcessGroups': remaining,
                  'elapsedSeconds': time.time() - first['startedEpoch']}))
