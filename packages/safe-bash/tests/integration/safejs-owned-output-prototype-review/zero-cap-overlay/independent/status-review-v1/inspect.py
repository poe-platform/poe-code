import ast
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
BASE = 'tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay'
COMMIT = '71abbafc8a9adadf98ed8921b4cc549ae90399ff'
AUTHOR = BASE + '/author/status-binding-v2'
HERE = Path(__file__).resolve().parent
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPOSITORY), '-c', 'core.fsmonitor=false', *args], env=ENVIRONMENT, timeout=20)


def blob(commit, path):
    return git('show', f'{commit}:{path}')


def publish(name, value):
    path = HERE / name
    assert not path.exists()
    text = json.dumps(value, indent=2) + '\n'
    patch = f'*** Begin Patch\n*** Add File: {path.relative_to(REPOSITORY)}\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), cwd=REPOSITORY, check=True)


def main():
    assert Path.cwd() == REPOSITORY
    temporary = Path(tempfile.mkdtemp(prefix='safe-bash-zero-status-independent-review-', dir='/private/tmp')).resolve()
    inputs = temporary / 'sealed'
    inputs.mkdir()
    paths = git('ls-tree', '-r', '--name-only', COMMIT, '--', AUTHOR).decode().splitlines()
    entries = []
    for filename in paths:
        name = filename[len(AUTHOR) + 1:]
        data = blob(COMMIT, filename)
        path = inputs / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(data)
        path.chmod(0o400)
        entries.append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
    freeze_data = (inputs / 'EXECUTION-FREEZE.json').read_bytes()
    assert sha(freeze_data) == '2d3f9fb25ad60f0b11e3d38f122249b0c7eab972267e0d5f95b904f713cc26d0'
    freeze = json.loads(freeze_data)
    assert [entry for entry in entries if entry['path'] != 'EXECUTION-FREEZE.json'] == freeze['files']
    profile_data = (inputs / 'PRIVATE-STATUS.json').read_bytes()
    assert sha(profile_data) == '5633dad0df72d6a0305bb665665eb768482f90fadcae88b46305fa8a417747c7'
    profile = json.loads(profile_data)
    historical = profile['historicalSnapshot']
    original_data = blob(historical['commit'], historical['path'])
    assert sha(original_data) == historical['sha256']
    original = json.loads(original_data)
    additions = ['?? docs/plans/safejs-audit-data-pipelines-review-2026-08-27.md', '?? docs/plans/safejs-audit-streaming-sketches-2026-08-27.md']
    assert profile['addedLines'] == additions and profile['historicalStatus'] == original['status']
    expected = copy.deepcopy(original)
    anchor = '?? docs/plans/safejs-24h-audit-2026-08-27.md\n'
    assert expected['status'].count(anchor) == 1
    expected['status'] = expected['status'].replace(anchor, anchor + ''.join(line + '\n' for line in additions))
    assert expected['status'] == profile['expectedStatus']
    assert expected == json.loads((inputs / 'expected-private.json.data').read_bytes())
    assert [key for key in original if original[key] != expected[key]] == ['status']
    assert sha(original['status'].encode()) == profile['historicalStatusSha256']
    assert sha(expected['status'].encode()) == profile['expectedStatusSha256']
    provenance = json.loads((inputs / 'PROVENANCE.json').read_bytes())
    for entry in provenance:
        data = blob(entry['commit'], entry['path'])
        assert sha(data) == entry['sha256'] and len(data) == entry['bytes']
        assert git('rev-parse', f"{entry['commit']}:{entry['path']}").decode().strip() == entry['gitBlob']
    preparation = json.loads((inputs / 'PREPARATION.json').read_bytes())
    runtime = temporary / 'runtime-exact-author'
    runtime.mkdir()
    changed = []
    for entry in preparation['runtimeEntries']:
        name = entry['path']
        if name == 'PRIVATE-STATUS.json':
            data = profile_data
        elif name in ['admission.mjs', 'lifecycle/run.mjs', 'controls/run.mjs']:
            data = (inputs / 'driver-copies' / (name + '.data')).read_bytes()
            changed.append(name)
        else:
            data = blob('a61e63bc46e8389e59c0d8fdc1d424003f62c769', BASE + '/author/' + name)
        assert len(data) == entry['bytes'] and sha(data) == entry['sha256'], name
        target = runtime / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(0o400)
    assert len(preparation['runtimeEntries']) == 38 and len(changed) == 3
    snapshot_bindings = preparation['frozen88Entries']
    assert len(snapshot_bindings) == 88
    for entry in snapshot_bindings:
        data = blob('a61e63bc46e8389e59c0d8fdc1d424003f62c769', BASE + '/author/' + entry['path'])
        assert len(data) == entry['bytes'] and sha(data) == entry['sha256']
    module = ast.parse((inputs / 'binding.py').read_text())
    function = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'historical_schema')
    namespace = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), 'sealed historical_schema data-only', 'exec'), namespace)
    captures = []
    own_prefix = BASE + '/independent/replay-v2/attempt-01/raw/independent-surface/'
    capture_refs = [('31f5678e62e3f3d43b4825d839ec970e7768da7d', own_prefix + name) for name in ['private-before.json', 'private-after.json']]
    capture_refs += [(entry['commit'], entry['path']) for entry in provenance if entry['commit'] == '06426bb62b6cc79f0be04dbf208efd17cfb84082' and entry['path'].endswith(('private-before.json', 'private-after.json'))]
    assert len(capture_refs) == 4
    for commit, path in capture_refs:
        data = blob(commit, path)
        raw = json.loads(data)
        projected = namespace['historical_schema'](raw)
        assert projected == expected, path
        records = [raw['index'], *raw['metadata'].values(), *raw['engine']]
        assert len(records) == 271
        captures.append({'commit': commit, 'path': path, 'sha256': sha(data), 'projectedMatchesExpected': True,
                         'metadataRecords': len(records), 'raw': raw})
    assert captures[0]['raw'] == captures[1]['raw']
    assert captures[2]['raw'] == captures[3]['raw']
    state_fields = ['head', 'tree', 'status', 'staged', 'index', 'metadata', 'engine']
    common_state = {key: captures[0]['raw'][key] for key in state_fields}
    assert all({key: entry['raw'][key] for key in state_fields} == common_state for entry in captures)
    assert set(captures[2]['raw']) - set(captures[0]['raw']) == {'qualification', 'engineShape'}
    assert not set(captures[0]['raw']) - set(captures[2]['raw'])
    negatives = []
    for name, mutate in [
        ('remove-authorized-line', lambda value: value.update(status=value['status'].replace(additions[0] + '\n', ''))),
        ('add-third-line', lambda value: value.update(status=value['status'] + '?? extra\n')),
        ('reorder-authorized-lines', lambda value: value.update(status=value['status'].replace('\n'.join(additions), '\n'.join(reversed(additions))))),
        ('change-newline', lambda value: value.update(status=value['status'].rstrip('\n'))),
        ('change-head', lambda value: value.update(head='0' * 40)),
        ('change-index-byte-hash', lambda value: value['index'].update(sha256='0' * 64)),
        ('change-staging', lambda value: value.update(staged='A\tunexpected\n')),
        ('change-metadata-byte-hash', lambda value: value['metadata']['package.json'].update(sha256='0' * 64)),
        ('change-engine-byte-hash', lambda value: value['engine'][0].update(sha256='0' * 64)),
        ('change-historical-millisecond', lambda value: value['index'].update(mtimeMs=value['index']['mtimeMs'] + 1)),
    ]:
        altered = copy.deepcopy(expected)
        mutate(altered)
        assert altered != expected
        negatives.append({'id': name, 'exactComparisonRejects': True})
    altered_raw = copy.deepcopy(captures[0]['raw'])
    altered_raw['index']['mtimeNs'] += 1
    assert altered_raw != captures[0]['raw']
    negatives.append({'id': 'raw-after-one-nanosecond-drift', 'rawBeforeAfterExactComparisonRejects': True})
    for entry in captures:
        del entry['raw']
    node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'
    assert sha(Path(node).read_bytes()) == '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'
    parsers = []
    for path in sorted(runtime.rglob('*.mjs')):
        result = subprocess.run([node, '--check', str(path)], capture_output=True, env=ENVIRONMENT)
        assert result.returncode == 0, (str(path), result.stderr.decode())
        parsers.append({'path': path.relative_to(runtime).as_posix(), 'exitCode': result.returncode})
    publish('STATIC-REVIEW.json', {'authorPreparationCommit': COMMIT, 'freezeSha256': sha(freeze_data),
        'privateStatusProfileSha256': sha(profile_data), 'temporary': str(temporary), 'sealedInputRoot': str(inputs),
        'runtimeExactAuthorRoot': str(runtime), 'files': entries, 'provenanceEntriesAuthenticated': len(provenance),
        'runtimeFiles': 38, 'unchangedRuntimeFilesFromA61': 34, 'guardOnlyChangedFiles': changed,
        'addedRuntimeStatusData': 1, 'original88GitInputsAuthenticated': True, 'onlyExpectedPrivateChange': ['status'],
        'capturedStateProjection': captures, 'bothFullRawBeforeAfterPairsEqual': True,
        'allFourRequiredRawStatesEqual': True, 'authorOnlyCaptureFields': ['qualification', 'engineShape'],
        'metadataRecordsPerProjection': 271,
        'staticPreparationRefusals': [{'attempt': 1, 'failure': 'Cross-author whole JSON equality assertion failed: author capture has qualification and engineShape fields absent from independent capture. Each full before/after pair and every required state field match exactly. No runtime or private query occurred.'}, {'attempt': 2, 'failure': 'Static helper initially reversed the direction of the two schema-only extra fields; corrected to author-only after printing exact key sets. No expected private state changed.'}],
        'noNumericToleranceOrRoundingAdded': True, 'privateCheckoutQueries': 0, 'parserOnlyChecks': parsers,
        'dataOnlyNegatives': negatives, 'productPrivateEngineGuestTransportExecutions': 0, 'noPromotion': True})
    print(json.dumps({'temporary': str(temporary), 'sealedFiles': len(entries), 'runtimeFiles': 38,
                      'provenance': len(provenance), 'rawStateComparisons': 4, 'parserChecks': len(parsers),
                      'dataOnlyNegatives': len(negatives), 'privateQueries': 0, 'runtimeExecutions': 0}))


if __name__ == '__main__':
    main()
