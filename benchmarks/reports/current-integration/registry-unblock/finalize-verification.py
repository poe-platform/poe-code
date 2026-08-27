import json
from pathlib import Path
import shutil
import subprocess
import time

from execute import EVIDENCE, OLD, REPORT, ROOT, digest, fingerprint, inventory, live_state, save, verify_source

state = json.loads((EVIDENCE / 'sealed-input.json').read_text())
source = Path(state['source'])
mutation = Path(state['workspace']) / 'mutation-source'
expectations = {}
for name in [
    'tests/commands/structured-stress/final-increment/fresh-native.json',
    'tests/commands/structured-stress/split-increment/native.json',
    'tests/commands/structured-stress/split-increment/evidence.ts',
    'tests/integration/adapter-tools-diagnostics/reference.json',
]:
    assert digest(OLD / name) == digest(source / name) == state['files'][name]['sha256']
    expectations[name] = {'sha256': digest(source / name), 'historicalUnchanged': True}
save(EVIDENCE / 'mutation-static-entrypoints.json', ['audit/independent-mutations.test.mjs'])
environment = json.loads((EVIDENCE / 'independent162.environment.json').read_text())['env']
closure = subprocess.run(['node', str(REPORT / 'static-closure.mjs'), str(mutation), str(EVIDENCE / 'mutation-static-entrypoints.json')],
    env=environment, capture_output=True, text=True, timeout=30)
assert closure.returncode == 0, closure.stderr
(EVIDENCE / 'mutation-static-closure.json').write_text(closure.stdout)
files, exclusions = inventory()
own_cache = REPORT / '__pycache__'
if own_cache.exists():
    shutil.rmtree(own_cache)
retained = {}
for location in [source, mutation]:
    check = verify_source(state['files'], location)
    assert check['same']
    extras = [str(path.relative_to(location)) for path in location.rglob('*') if path.is_file() and
              not path.is_relative_to(location / 'node_modules') and str(path.relative_to(location)) not in state['files']]
    assert all(name.startswith(('dist/', 'audit/')) for name in extras), extras
    retained[str(location)] = {'source': check, 'extraFiles': extras, 'fixtureDebris': []}
phases = json.loads((EVIDENCE / 'phase-results.json').read_text()) + json.loads((EVIDENCE / 'supplement-phase-results.json').read_text())
groups = {phase['pid'] for phase in phases}
process_lines = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,command='], text=True).splitlines()
remaining = [line for line in process_lines if len(line.split(None, 2)) == 3 and int(line.split(None, 2)[1]) in groups]
assert not remaining
review = Path('/tmp/safe-bash-registry-unblock-final-review-detail.txt')
save(EVIDENCE / 'final-verification.json', {
    'capturedEpoch': time.time(), 'elapsedSinceFreezeSeconds': time.time() - state['startedEpoch'],
    'expectationData': expectations, 'retainedSnapshots': retained, 'ownedGroupsRemaining': remaining,
    'liveFinalSeparate': live_state(), 'liveSelectedFingerprint': fingerprint(files),
    'liveSelectedDrift': sorted(name for name in set(files) | set(state['files']) if files.get(name) != state['files'].get(name)),
    'liveSelectedFiles': files, 'liveExclusions': exclusions,
    'review': {'path': str(review), 'sha256': digest(review), 'bytes': review.stat().st_size,
               'verdictRead': 'Static ACCEPT; execution/mutation review PENDING, not passed'},
})
print(json.dumps({'expectationsUnchanged': len(expectations), 'frozenSourcesUnchanged': True, 'remainingGroups': remaining,
                  'liveHeadSeparate': live_state()['head'], 'elapsedSeconds': time.time() - state['startedEpoch']}))
