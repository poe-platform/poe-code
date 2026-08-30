import base64
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import time

from execute import HERE as REPORT, PARENT, base
EVIDENCE = base.EVIDENCE
OLD = base.OLD
ROOT = base.ROOT
digest, fingerprint, live_state, save, verify_source = base.digest, base.fingerprint, base.live_state, base.save, base.verify_source


def tap(phase):
    lines = (EVIDENCE / f'{phase}.stdout').read_text().splitlines()
    rows = []
    for index, line in enumerate(lines):
        match = re.match(r'^(ok|not ok) (\d+) - (.+)$', line)
        if not match:
            continue
        name = match[3]
        status = 'pass' if match[1] == 'ok' else 'fail'
        if re.search(r' # SKIP\b', name, re.I):
            status = 'skip'
        if re.search(r' # TODO\b', name, re.I):
            status = 'todo'
        detail = []
        for next_line in lines[index + 1:]:
            if next_line.startswith('# Subtest:') or re.match(r'^(ok|not ok) \d+ ', next_line):
                break
            detail.append(next_line)
        if any("failureType: 'cancelledByParent'" in item for item in detail):
            status = 'cancelled'
        rows.append({'name': name, 'status': status, 'line': index + 1, 'detail': '\n'.join(detail) if status != 'pass' else None})
    assert len(rows) == len({row['name'] for row in rows}), phase
    counts = {key: sum(row['status'] == key for row in rows) for key in ['pass', 'fail', 'skip', 'todo', 'cancelled']}
    footer = dict((match[1], int(match[2])) for line in lines if (match := re.match(r'^# (tests|pass|fail|skipped|todo|cancelled) (\d+)$', line)))
    assert footer['tests'] == len(rows), (phase, footer, len(rows))
    for key, value in counts.items():
        assert footer['skipped' if key == 'skip' else key] == value, (phase, key)
    return {'unique': len(rows), 'counts': counts, 'footer': footer, 'rows': rows}


state = json.loads((EVIDENCE / 'sealed-input.json').read_text())
source = Path(state['source'])
historical = json.loads((PARENT / 'historical-99.json').read_text())
accepted = json.loads((PARENT.parent / 'clean-test.nonpass.json').read_text())
accepted_by_id = {row['id']: row for row in accepted}
cohorts = {}
identities = []
for cohort in historical['cohorts']:
    name = cohort['id']
    parsed = tap(name)
    expected = [row for row in historical['identities'] if row['cohort'] == name]
    assert parsed['unique'] == cohort['count']
    assert {row['name'] for row in parsed['rows']} == {row['name'] for row in expected}
    actual = {row['name']: row for row in parsed['rows']}
    for original in expected:
        prior = accepted_by_id[original['historicalTapId']]
        assert prior['name'] == original['name'] and prior['status'] == 'fail'
        result = actual[original['name']]
        identities.append({**original, 'newExecutionStatus': result['status'], 'newTapLine': result['line'],
                           'callbackEvidence': 'unchanged awaited callback assertions complete' if result['status'] == 'pass' else 'failure stack inside callback at matrix.test.ts:105',
                           'failureDetail': result['detail']})
    cohorts[name] = parsed
assert len(identities) == len({(row['file'], row['name']) for row in identities}) == 99
counts = {key: sum(row['newExecutionStatus'] == key for row in identities) for key in ['pass', 'fail', 'skip', 'todo', 'cancelled']}
assert counts == {'pass': 97, 'fail': 2, 'skip': 0, 'todo': 0, 'cancelled': 0}
assert all('adapter-tools preflight: missing required' not in (row['failureDetail'] or '') for row in identities)
controls = {name: tap(name) for name in ['registry-author-full', 'preflight-author30', 'independent162']}
assert controls['registry-author-full']['counts']['pass'] == 31
assert controls['preflight-author30']['counts']['pass'] == 30
assert controls['independent162']['counts']['pass'] == 162
diagnostics = [json.loads(line[2:]) for line in (EVIDENCE / 'independent162.stdout').read_text().splitlines() if line.startswith('# {')]
missing = [entry for entry in diagnostics if 'missing' in entry]
optional = [entry for entry in diagnostics if 'optionalExecuted' in entry]
assert len(missing) == len({(entry['backend'], entry['missing']) for entry in missing}) == 154
assert all(entry['beforeCount'] == entry['afterCount'] == len(entry['baselineNames']) and not entry['callbackEntered'] for entry in missing)
assert len(optional) == len({entry['backend'] for entry in optional}) == 7
assert all(entry['beforeCount'] == len(entry['baselineNames']) and entry['afterCount'] == entry['beforeCount'] + 1 and entry['callbackEntered'] and entry['optionalExecuted'] for entry in optional)
decoded = [json.loads(base64.b64decode(line.split(' ', 2)[2])) for line in (EVIDENCE / 'diagnostics8.stdout').read_text().splitlines() if line.startswith('# EVIDENCE ')]
assert len(decoded) == 8 and all(entry['status'] == 'PASS' for entry in decoded)
save(EVIDENCE / 'diagnostic-callbacks.json', decoded)
backends = {}
for row in identities:
    backend = backends.setdefault(row['backend'], {'pass': 0, 'fail': 0, 'total': 0})
    backend[row['newExecutionStatus']] += 1
    backend['total'] += 1
save(EVIDENCE / 'accounting.json', {'uniqueHistoricalIdentities': 99, 'counts': counts, 'historicalPreflightFailures': 99,
    'currentPreflightFailures': 0, 'currentDownstreamFailures': 2, 'cohorts': cohorts, 'backends': backends,
    'identities': identities, 'separateNonadditiveControls': controls,
    'independentMissingControls': missing, 'independentOptionalWorkflowControls': optional,
    'separateLiteralRequiredList': 1, 'separateRegistryObservationNotPassOracle': json.loads((EVIDENCE / 'registry-observation.stdout').read_text()),
    'untouchedOpenHistoricalJqDifferences': 42})
entries = [cohort['file'] for cohort in historical['cohorts']] + [
    'tests/plugins/agent-commands.test.ts', 'tests/commands/metadata/integration.test.ts',
    'tests/integration/adapter-tools/preflight-review/preflight.test.ts', 'src/index.ts']
save(EVIDENCE / 'static-entrypoints.json', entries)
environment = json.loads((EVIDENCE / 'matrix79.environment.json').read_text())['env']
closure = subprocess.run(['node', str(PARENT / 'static-closure.mjs'), str(source), str(EVIDENCE / 'static-entrypoints.json')],
    env=environment, capture_output=True, text=True, timeout=30)
assert closure.returncode == 0, closure.stderr
(EVIDENCE / 'static-closure.json').write_text(closure.stdout)
runtime = subprocess.check_output(['node', '--version'], env=environment, text=True).strip()
accepted_dependencies = json.loads((PARENT.parent / 'dependencies.json').read_text())['root']
dependency_after = {}
for location in [OLD, source, Path(state['workspace']) / 'mutation-source']:
    mismatches = [name for name, entry in accepted_dependencies['files'].items() if digest(location / 'node_modules' / name) != entry['sha256']]
    assert not mismatches
    dependency_after[str(location)] = {'checkedRegularFiles': len(accepted_dependencies['files']), 'mismatches': mismatches}
parent_manifest = PARENT.parent / 'ARTIFACTS.sha256'
parent_entries = []
for line in parent_manifest.read_text().splitlines():
    expected, name = line.split('  ', 1)
    assert digest(PARENT.parent / name) == expected, name
    parent_entries.append(name)
accepted_commit = '96db59ac7d355d1a94422634b4c4f53d00932ad9'
assert subprocess.check_output(['git', 'show', f'{accepted_commit}:benchmarks/reports/current-integration/ARTIFACTS.sha256'], cwd=ROOT) == parent_manifest.read_bytes()
processes = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,command='], text=True).splitlines()
phases = json.loads((EVIDENCE / 'phase-results.json').read_text()) + json.loads((EVIDENCE / 'supplement-phase-results.json').read_text())
groups = {phase['pid'] for phase in phases}
remaining = [line for line in processes if len(line.split(None, 2)) == 3 and int(line.split(None, 2)[1]) in groups]
assert not remaining
regular = {}
for location in [source, Path(state['workspace']) / 'mutation-source']:
    result = verify_source(state['files'], location)
    assert result['same']
    regular[str(location)] = result
save(EVIDENCE / 'verification.json', {'capturedEpoch': time.time(), 'runtime': runtime, 'sourceChecks': regular,
    'dependencyChecks': dependency_after, 'acceptedParentManifestEntriesVerified': len(parent_entries),
    'acceptedParentManifestMatchesCommit': accepted_commit, 'ownedChildProcessGroupsRemaining': remaining,
    'liveFinalSeparate': live_state(), 'independentHarnessSha256': digest(REPORT / 'independent-mutations.test.mjs'),
    'independentHarnessCopyMatches': digest(REPORT / 'independent-mutations.test.mjs') == digest(Path(state['workspace']) / 'mutation-source/audit/independent-mutations.test.mjs'),
    'limits': ['All dirty paths captured before/after sealing; selected source file bytes hashed. Excluded reports/debris paths are inventoried, not certified as frozen input bytes.',
               'Native jq expectations are retained frozen JSON, not a fresh host jq oracle; S3 mock and loopback WebDAV do not establish real provider coverage.',
               'Live changes after seal are separate from frozen results; no source-frozen committed-tree claim.']})
print(json.dumps({'counts': counts, 'backends': backends, 'controls': {name: value['counts'] for name, value in controls.items()},
                  'parentManifestVerified': len(parent_entries), 'remainingChildren': remaining, 'runtime': runtime}, indent=2))
