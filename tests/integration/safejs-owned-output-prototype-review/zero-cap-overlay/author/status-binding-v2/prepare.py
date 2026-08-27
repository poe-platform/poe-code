import ast
import copy
import difflib
import importlib.util
import json
from pathlib import Path
import re
import tempfile


OWNER = Path(__file__).resolve().parent
PREVIOUS = OWNER.parent / 'execution-v1'
specification = importlib.util.spec_from_file_location('previous_shared', PREVIOUS / 'shared.py')
previous = importlib.util.module_from_spec(specification)
specification.loader.exec_module(previous)
AUTHOR = previous.AUTHOR_COMMIT
EXECUTION = '8d58de4e08b9a50a8305b17686bd842a9e7d2d5e'
REFUSAL = '06426bb62b6cc79f0be04dbf208efd17cfb84082'
AUTHOR_PATH = previous.AUTHOR_PATH
OWNED_PATH = OWNER.relative_to(previous.REPOSITORY).as_posix()
HISTORICAL_PATH = 'tests/integration/safejs-owned-output-prototype-review/lifecycle/execution-v1/evidence/attempt-01/private-after.json'
PINS_PATH = 'tests/integration/safejs-owned-output-prototype-review/lifecycle/SOURCE-PINS.json'


def replace_once(text, before, after):
    assert text.count(before) == 1, before
    return text.replace(before, after)


def patch(name, before, after):
    previous.put(OWNER / 'diffs' / (name + '.patch-data'), ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), 'previous/' + name, 'status-binding-v2/' + name)))


def put_copy(path, value):
    previous.put(path, value.decode() if isinstance(value, bytes) else value)


def main():
    started = previous.now()
    provenance = []
    def authenticated(commit, path):
        value = previous.blob(commit, path)
        assert previous.regular(previous.REPOSITORY / path) == value
        provenance.append({'commit': commit, 'path': path, 'gitBlob': previous.git('rev-parse', f'{commit}:{path}').decode().strip(), 'bytes': len(value), 'sha256': previous.sha(value)})
        return value
    execution_freeze = json.loads(authenticated(EXECUTION, AUTHOR_PATH + '/execution-v1/EXECUTION-FREEZE.json'))
    for entry in execution_freeze['files']:
        value = authenticated(EXECUTION, AUTHOR_PATH + '/execution-v1/' + entry['path'])
        assert len(value) == entry['bytes'] and previous.sha(value) == entry['sha256']
    old_preparation = json.loads(previous.blob(EXECUTION, AUTHOR_PATH + '/execution-v1/PREPARATION.json'))
    assert previous.inventory(old_preparation['runtimeRoot']) == old_preparation['runtimeEntries']
    assert previous.inventory(old_preparation['frozenRoot']) == old_preparation['frozen88Entries']
    shared_before = previous.snapshot(old_preparation['sharedRoots'])
    assert shared_before == json.loads(previous.blob(EXECUTION, AUTHOR_PATH + '/execution-v1/PREPARATION-SHARED.json'))
    old_inputs_before = previous.snapshot(old_preparation['immutableRoots'])
    assert old_inputs_before == json.loads(previous.blob(EXECUTION, AUTHOR_PATH + '/execution-v1/PREPARATION-INPUTS.json'))
    historical_bytes = authenticated(AUTHOR, HISTORICAL_PATH)
    historical = json.loads(historical_bytes)
    pins = json.loads(authenticated(AUTHOR, PINS_PATH))['privateExpectedAtRelease']
    captured = []
    for phase in ['before', 'after']:
        path = AUTHOR_PATH + f'/execution-v1/attempt-01/raw/surface/private-{phase}.json'
        captured.append(json.loads(authenticated(REFUSAL, path)))
    assert captured[0] == captured[1]
    assert pins['status'] == historical['status']
    additions = ['?? docs/plans/safejs-audit-data-pipelines-review-2026-08-27.md', '?? docs/plans/safejs-audit-streaming-sketches-2026-08-27.md']
    anchor = '?? docs/plans/safejs-24h-audit-2026-08-27.md\n'
    expected_status = replace_once(historical['status'], anchor, anchor + ''.join(line + '\n' for line in additions))
    assert expected_status == captured[0]['status']
    assert [line for line in expected_status.splitlines(True) if line not in [entry + '\n' for entry in additions]] == historical['status'].splitlines(True)
    expected = {**historical, 'status': expected_status}
    profile = {
        'version': 2, 'authority': 'ROOT NARROW PREPARATION ONLY, user message2026-08-27; exact two observed UNTRACKED status lines only',
        'historicalSnapshot': {'commit': AUTHOR, 'path': HISTORICAL_PATH, 'sha256': previous.sha(historical_bytes)},
        'historicalPins': {'commit': AUTHOR, 'path': PINS_PATH, 'sha256': previous.sha(previous.blob(AUTHOR, PINS_PATH))},
        'preservedCaptureCommit': REFUSAL, 'historicalStatus': historical['status'], 'addedLines': additions, 'expectedStatus': expected_status,
        'historicalStatusSha256': previous.sha(historical['status'].encode()), 'expectedStatusSha256': previous.sha(expected_status.encode()),
        'changedExpectedFields': ['status'], 'allOtherHistoricalSnapshotFieldsUnchanged': True, 'freshBeforeAfterFullEqualityRequired': True,
        'runtimeAuthorized': False, 'privateFileContentsRead': False, 'creatorInference': False, 'noPromotion': True,
    }
    previous.put(OWNER / 'PRIVATE-STATUS.json', profile)
    expected_text = replace_once(historical_bytes.decode(), json.dumps(historical['status']), json.dumps(expected_status))
    assert json.loads(expected_text) == expected
    put_copy(OWNER / 'expected-private.json.data', expected_text)
    patch('private-expected.json', historical_bytes.decode(), expected_text)
    for name in ['shared.py', 'assess.py']:
        put_copy(OWNER / name, previous.blob(EXECUTION, AUTHOR_PATH + '/execution-v1/' + name))
    temporary = Path(tempfile.mkdtemp(prefix='safe-bash-zero-status-binding-v2-', dir='/private/tmp'))
    frozen_root = temporary / 'frozen-author'
    runtime_root = temporary / 'runtime'
    frozen_paths = previous.git('ls-tree', '-r', '--name-only', AUTHOR, '--', AUTHOR_PATH).decode().splitlines()
    assert len(frozen_paths) == 88
    frozen = {}
    for path in frozen_paths:
        value = authenticated(AUTHOR, path)
        relative = path[len(AUTHOR_PATH) + 1:]
        frozen[relative] = value
        put_copy(frozen_root / relative, value)
        (frozen_root / relative).chmod(0o444)
    assert previous.inventory(frozen_root) == old_preparation['frozen88Entries']
    old_runtime = Path(old_preparation['runtimeRoot'])
    original_adapter = frozen['admission.mjs'].decode()
    adapter = original_adapter
    relocations = [
        ('export const author = dirname(fileURLToPath(import.meta.url));', f'export const author = "{frozen_root}";'),
        ('const freezePath = relative(repository, join(author, "FREEZE.json"));', f'const freezePath = "{AUTHOR_PATH}/FREEZE.json";'),
        ('`${commit}:${relative(repository, join(author, entry.path))}`', f'`${{commit}}:{AUTHOR_PATH}/${{entry.path}}`'),
    ]
    for before, after in relocations:
        adapter = replace_once(adapter, before, after)
    adapter = replace_once(adapter, '  return commit;\n}', '  verifyBindingInputs();\n  return commit;\n}')
    adapter = replace_once(adapter, '  verifyCandidate(admission);\n  return', '  verifyBindingRelease(admission);\n  verifyCandidate(admission);\n  return')
    supplement = previous.regular(OWNER / 'parent-binding.mjs.data').decode()
    adapter += '\n' + replace_once(supplement, '__BINDING_OWNER__', str(OWNER))
    runtime_changes = []
    for entry in old_preparation['runtimeEntries']:
        name = entry['path']
        original = previous.regular(old_runtime / name).decode()
        updated = original
        if name == 'admission.mjs':
            updated = adapter
        elif name in ['lifecycle/run.mjs', 'controls/run.mjs']:
            updated = replace_once(updated, 'import { author, candidate, directoryShape, releaseFor, verifyCandidate, verifyFrozen }', 'import { author, candidate, directoryShape, expectedPrivateProfile, releaseFor, verifyCandidate, verifyFrozen }')
            updated = replace_once(updated, 'assert.deepEqual(before, load(join(lifecycle, "execution-v1/evidence/attempt-01/private-after.json")), "Fresh private state drift from original accepted engine profile");', 'assert.deepEqual(before, expectedPrivateProfile(), "Fresh private state drift from exact status-only binding");')
        if updated != original:
            put_copy(OWNER / 'driver-copies' / (name + '.data'), updated)
            patch(name, original, updated)
            runtime_changes.append({'path': name, 'beforeSha256': previous.sha(original.encode()), 'afterSha256': previous.sha(updated.encode()), 'classification': 'parent-only expected-status/authenticated execution-binding guard; no guest/product assertions'})
        else:
            assert previous.sha(original.encode()) == entry['sha256']
        put_copy(runtime_root / name, updated)
        (runtime_root / name).chmod(0o444)
    put_copy(runtime_root / 'PRIVATE-STATUS.json', previous.regular(OWNER / 'PRIVATE-STATUS.json'))
    (runtime_root / 'PRIVATE-STATUS.json').chmod(0o444)
    runtime_entries = previous.inventory(runtime_root)
    assert len(runtime_entries) == 38 and len(runtime_changes) == 3
    original_run = previous.blob(EXECUTION, AUTHOR_PATH + '/execution-v1/run.py').decode()
    run = replace_once(original_run, 'from assess import assess\n', 'from assess import assess\nfrom binding import binding_release, expected_private_profile, historical_schema\n')
    run = replace_once(run, "    temporary = Path(preparation['temporary'])\n", "    descriptor, descriptor_bytes = binding_release(freeze_commit, preparation)\n    expected_private = expected_private_profile()\n    temporary = Path(preparation['temporary'])\n")
    run = replace_once(run, "    descriptor = temporary / 'ROOT-RELEASE.json'\n    assert regular(descriptor) == regular(OWNER / 'ROOT-RELEASE.json')\n", '')
    run = replace_once(run, "            for key in ['head', 'tree', 'status', 'staged']:\n", "            assert pins['status'] == load(OWNER / 'PRIVATE-STATUS.json')['historicalStatus']\n            pins = {**pins, 'status': expected_private['status']}\n            for key in ['head', 'tree', 'status', 'staged']:\n")
    run = replace_once(run, "            shared_before = snapshot(preparation['sharedRoots'])\n", "            assert historical_schema(before) == expected_private, 'Private immutable historical profile drift outside exact status-only binding'\n            shared_before = snapshot(preparation['sharedRoots'])\n")
    run = replace_once(run, "                entry['sharedUnchanged'] = shared_before is not None and shared_after == shared_before\n                entry['inputsUnchanged'] = inputs_before is not None and inputs_after == inputs_before\n                assert entry['sharedUnchanged'] and entry['inputsUnchanged']\n                assert regular(descriptor) == regular(OWNER / 'ROOT-RELEASE.json')\n", "                entry['sharedUnchanged'] = None if shared_before is None else shared_after == shared_before\n                entry['inputsUnchanged'] = None if inputs_before is None else inputs_after == inputs_before\n                for name, baseline in [('shared', shared_before), ('inputs', inputs_before)]:\n                    if baseline is None:\n                        entry[name + 'Comparison'] = 'NOT_COMPARED: before snapshot not acquired; primary refusal retained'\n                        assert entry['launched'] is False and blocked is not None\n                    else:\n                        assert entry[name + 'Unchanged'] is True\n                assert regular(descriptor) == descriptor_bytes\n")
    for reason in ['fresh private after-guard failure', 'input/shared after-guard failure']:
        run = replace_once(run, f"                blocked = f'{{cohort}}: {reason}'", f"                blocked = blocked or f'{{cohort}}: {reason}'")
    put_copy(OWNER / 'run.py', run)
    patch('run.py', original_run, run)
    candidate = json.loads(frozen['CANDIDATE.json'])
    all_entries = json.loads(frozen['inventories/candidate-all940.json'])
    package_entries = json.loads(frozen['inventories/candidate-package709.json'])
    previous.copy_tree(Path(old_preparation['candidateRoot']), temporary / 'candidate', all_entries)
    previous.copy_tree(Path(old_preparation['packageRoot']), temporary / 'package', package_entries)
    for name in ['raw', 'home', 'tmp']:
        (temporary / name).mkdir()
    pending = {key: candidate[key] for key in ['sourceManifestSha256', 'candidateManifestSha256', 'compiledManifestSha256', 'packageManifestSha256']}
    pending.update({'authorFreezeCommit': AUTHOR, 'independentReviewCommit': previous.ADMISSION_COMMIT, 'independentReviewPath': previous.ADMISSION_PATH,
        'rootAuthorized': False, 'rootAuthorization': 'PREPARATION ONLY; new different binding review and explicit ROOT release required',
        'bindingPreparationCommit': None, 'bindingFreezeSha256': None, 'privateStatusProfileSha256': previous.sha(previous.regular(OWNER / 'PRIVATE-STATUS.json')),
        'bindingReviewCommit': None, 'bindingReviewPath': None, 'allowedCohorts': ['surface', 'lifecycle', 'controls'],
        'candidateRoot': str(temporary / 'candidate'), 'packageRoot': str(temporary / 'package'), 'outputRoot': str(temporary / 'raw'), 'noPromotion': True})
    previous.put(OWNER / 'ROOT-RELEASE.pending.json', pending)
    put_copy(temporary / 'ROOT-RELEASE.pending.json', previous.regular(OWNER / 'ROOT-RELEASE.pending.json'))
    immutable_roots = [frozen_root, runtime_root, temporary / 'candidate', temporary / 'package']
    preparation = {key: old_preparation[key] for key in ['sourceManifestSha256', 'candidateManifestSha256', 'compiledManifestSha256', 'packageManifestSha256', 'preparedEngine', 'loaderSha256', 'node', 'sharedRoots']}
    preparation.update({'started': started, 'finished': previous.now(), 'temporary': str(temporary), 'frozenRoot': str(frozen_root), 'runtimeRoot': str(runtime_root),
        'candidateRoot': str(temporary / 'candidate'), 'packageRoot': str(temporary / 'package'), 'immutableRoots': list(map(str, immutable_roots)),
        'originalFreezeCommit': AUTHOR, 'sourceAdmissionCommit': previous.ADMISSION_COMMIT, 'previousExecutionFreezeCommit': EXECUTION, 'previousRefusalCommit': REFUSAL,
        'frozen88Entries': previous.inventory(frozen_root), 'runtimeEntries': runtime_entries, 'runtimeChanges': runtime_changes, 'runtimeAddedFiles': ['PRIVATE-STATUS.json'],
        'metadataRelocations': relocations, 'scheduledProfiles': {'surface': 8, 'lifecycle': 11, 'controls': 6},
        'productGuestScorerBudgetTimerAssertionChanges': 0, 'sourceCandidateChanges': 0, 'privateQueries': 0, 'nodeExecutions': 0,
        'runtimePending': True, 'differentBindingReviewPending': True, 'noPromotion': True})
    previous.put(OWNER / 'PREPARATION.json', preparation)
    previous.put(OWNER / 'PREPARATION-INPUTS.json', previous.snapshot(immutable_roots))
    previous.put(OWNER / 'PREPARATION-SHARED.json', shared_before)
    admission_bytes = authenticated(previous.ADMISSION_COMMIT, previous.ADMISSION_PATH)
    assert json.loads(admission_bytes)['authorFreezeCommit'] == AUTHOR
    previous.put(OWNER / 'SOURCE-ADMISSION.json.data', admission_bytes.decode())
    previous.put(OWNER / 'PROVENANCE.json', provenance)
    import_specification = importlib.util.spec_from_file_location('prepared_binding', OWNER / 'binding.py')
    import sys
    sys.path.insert(0, str(OWNER))
    binding = importlib.util.module_from_spec(import_specification)
    import_specification.loader.exec_module(binding)
    assert binding.expected_private_profile() == expected
    assert binding.historical_schema(captured[0]) == expected
    negative_checks = []
    for name, mutate in [
        ('historical-status-without-additions', lambda value: value.update(status=historical['status'])),
        ('one-addition-missing', lambda value: value.update(status=expected_status.replace(additions[0] + '\n', ''))),
        ('extra-unapproved-status-line', lambda value: value.update(status=value['status'] + '?? unapproved-path\n')),
        ('reordered-status', lambda value: value.update(status=''.join(reversed(value['status'].splitlines(True))))),
        ('changed-head', lambda value: value.update(head='0' * 40)),
        ('changed-tree', lambda value: value.update(tree='0' * 40)),
        ('changed-staging', lambda value: value.update(staged='M\tpackage.json\n')),
        ('changed-index', lambda value: value['index'].update(sha256='0' * 64)),
        ('changed-metadata', lambda value: value['metadata']['package.json'].update(sha256='0' * 64)),
        ('changed-engine', lambda value: value['engine'][0].update(sha256='0' * 64)),
    ]:
        value = copy.deepcopy(captured[0])
        mutate(value)
        assert binding.historical_schema(value) != expected, name
        negative_checks.append({'case': name, 'classification': 'DATA_ONLY_REJECTED_NOT_GUEST_PASS'})
    python_files = []
    for path in sorted(OWNER.glob('*.py')):
        ast.parse(previous.regular(path), filename=str(path))
        python_files.append(path.name)
    all_original_modules = {name: value.decode() for name, value in frozen.items() if name.endswith('.mjs')}
    status_occurrences = []
    for name, value in all_original_modules.items():
        for number, line in enumerate(value.splitlines(), 1):
            if any(term in line for term in ['privateExpectedAtRelease', 'private-after.json', 'privateUnchanged', 'comparablePrivate', 'before.head', 'before.engine']):
                status_occurrences.append({'path': name, 'line': number, 'text': line})
    previous.put(OWNER / 'GUARD-COVERAGE.json', {'originalAuthorModulesInspected': len(all_original_modules), 'matches': status_occurrences,
        'historicalStatusComparisonsRevised': ['outer run.py: four-field historical pin loop', 'lifecycle/run.mjs: whole historical snapshot', 'controls/run.mjs: whole historical snapshot'],
        'freshBeforeAfterGuardsUnchanged': ['outer raw nanosecond snapshot including full status and eligible shape', 'surface comparablePrivate excluding only observation timestamp', 'lifecycle whole raw privateState', 'controls whole raw privateState'],
        'additionalOuterGuard': 'Historical whole JS-schema equality, exact ns->ms projection of metadata only; no tolerance. Fresh ns snapshot equality remains verbatim.',
        'secondaryReportingOnly': 'Missing before snapshots are NOT_COMPARED/null when no child launched and primary refusal exists; never passes',
        'publicGitTranslation': 'Only three declared admission pathname bindings; no Git interception, substitute identities or imported hash changes',
        'privateQueriesDuringPreparation': 0})
    immutable_modules = [name for name in all_original_modules if name.startswith(('surface/', 'lifecycle/', 'controls/')) and name not in ['lifecycle/run.mjs', 'controls/run.mjs']]
    for name in immutable_modules:
        assert previous.regular(runtime_root / name) == frozen[name]
    import_lines = {name: [line for line in frozen[name].decode().splitlines() if re.search(r'\bimport\b|expectedImports|importAllow|allowedImports', line)] for name in immutable_modules}
    previous.put(OWNER / 'IMPORTS.json', {'unchangedModulePaths': immutable_modules, 'unchangedImportAndAllowlistLines': import_lines,
        'loaderSha256': preparation['loaderSha256'], 'parentOnlyChangedPaths': [entry['path'] for entry in runtime_changes], 'newParentModuleSpecifiers': [],
        'privateSourceHookNotInstalledPackage': True, 'childSourceAndImportedByteHashesNeverSubstituted': True})
    for name in ['lifecycle/run.mjs', 'controls/run.mjs']:
        updated = previous.regular(runtime_root / name).decode()
        assert 'assert.deepEqual(after, before)' in updated
        assert 'load(join(lifecycle, "execution-v1/evidence/attempt-01/private-after.json"))' not in updated
    assert 'entry[\'privateUnchanged\'] = before is not None and after == before' in run
    for key, entries, count in [('candidateManifestSha256', all_entries, 940), ('sourceManifestSha256', [entry for entry in all_entries if entry['path'].startswith('src/')], 213), ('compiledManifestSha256', [entry for entry in all_entries if entry['path'].startswith('dist/')], 708), ('packageManifestSha256', package_entries, 709)]:
        assert len(entries) == count
        assert previous.sha(previous.encoded(entries)) == candidate[key]
    assert previous.snapshot(old_preparation['sharedRoots']) == shared_before
    assert previous.snapshot(old_preparation['immutableRoots']) == old_inputs_before
    assert previous.sha(previous.regular(previous.NODE)) == preparation['node']['sha256']
    previous.put(OWNER / 'STATIC-CHECKS.json', {'at': previous.now(), 'classification': 'PREPARATION_DATA_AND_STATIC_CHECKS_ONLY',
        'originalAuthorFiles': 88, 'previousRuntimeFiles': 37, 'newRuntimeFiles': 38, 'changedRuntimeFiles': 3, 'unchangedPreviousRuntimeFiles': 34,
        'expectedProfileChangedFields': [key for key in expected if expected[key] != historical[key]], 'preservedPrivateBeforeAfterExact': True,
        'preservedCaptureMatchesDerivedProfile': True, 'all271MetadataRecordsExactlyProjectToHistoricalMs': True,
        'source213Compiled708Full940Package709IdentitiesUnchanged': True, 'originalSharedAndExecutionInputsBeforeAfterUnchanged': True,
        'pythonASTParsed': python_files, 'dataOnlyNegativeChecks': negative_checks, 'guestPasses': 0, 'newActualAttempts': 0,
        'privateQueries': 0, 'nodeExecutions': 0, 'productImports': 0, 'privateEngineImports': 0, 'nativeOrTransportExecutions': 0,
        'MjsSyntaxRuntimeValidation': 'Not executed; exact guard-only patches and unchanged modules statically inspected; different review pending',
        'noPromotion': True})
    print(json.dumps({'temporary': str(temporary), 'newRuntimeFiles': 38, 'originalAuthorFiles': 88, 'privateQueries': 0, 'newActualAttempts': 0}))


if __name__ == '__main__':
    main()
