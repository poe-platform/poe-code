import ast
import copy
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
BASE = 'tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay'
AUTHOR_PATH = BASE + '/author'
STATUS_PATH = AUTHOR_PATH + '/status-binding-v2'
AUTHOR_COMMIT = 'a61e63bc46e8389e59c0d8fdc1d424003f62c769'
STATUS_COMMIT = '71abbafc8a9adadf98ed8921b4cc549ae90399ff'
REVIEW_COMMIT = '758880944964ed1bb9f9cbb524dfeb14e88b3047'
PRIOR_COMMIT = 'c3a3b4299a7011b547c21b8fa864356391b6e04d'
PRIOR_PATH = BASE + '/independent/replay-v2/execution'
HERE = Path(__file__).resolve().parent
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPOSITORY), '-c', 'core.fsmonitor=false', *args], env=ENVIRONMENT, timeout=20)


def blob(commit, path):
    return git('show', f'{commit}:{path}')


def load(path):
    return json.loads(path.read_bytes())


def put(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(data)
    path.chmod(0o400)
    assert path.resolve() == path and not path.is_symlink()


def add(filename, value):
    path = HERE / filename
    assert not path.exists()
    text = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    subprocess.run(['apply_patch'], input=(f'*** Begin Patch\n*** Add File: {path.relative_to(REPOSITORY)}\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n').encode(), cwd=REPOSITORY, check=True)


def regular(path):
    assert path.resolve() == path and path.is_file() and not path.is_symlink()
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha(data)}


def inventory(root):
    entries = []
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink()
        if path.is_file():
            entries.append({'path': path.relative_to(root).as_posix(), **regular(path)})
        else:
            assert path.is_dir()
    return entries


def replace_once(text, before, after):
    assert text.count(before) == 1, (before, text.count(before))
    return text.replace(before, after)


def main():
    assert Path.cwd() == REPOSITORY
    prior = json.loads(blob(PRIOR_COMMIT, PRIOR_PATH + '/BINDINGS.json'))
    review = json.loads(blob(REVIEW_COMMIT, BASE + '/independent/status-review-v1/STATIC-REVIEW.json'))
    admission = json.loads(blob(REVIEW_COMMIT, BASE + '/independent/status-review-v1/ADMISSION.json'))
    temporary = Path(tempfile.mkdtemp(prefix='safe-bash-zero-overlay-independent-v3-', dir='/private/tmp')).resolve()
    frozen = temporary / 'frozen-author'
    binding = temporary / 'status-author'
    runtime = temporary / 'runtime'
    for root in [frozen, binding, runtime, temporary / 'raw', temporary / 'raw/home', temporary / 'raw/tmp']:
        root.mkdir(parents=True, exist_ok=True)
    assert len(prior['authorFiles']) == 88
    for entry in prior['authorFiles']:
        data = blob(AUTHOR_COMMIT, AUTHOR_PATH + '/' + entry['path'])
        assert len(data) == entry['bytes'] and sha(data) == entry['sha256']
        put(frozen / entry['path'], data)
    assert inventory(frozen) == prior['authorFiles']
    assert git('ls-tree', '-r', '--name-only', AUTHOR_COMMIT, '--', AUTHOR_PATH).decode().splitlines() == [AUTHOR_PATH + '/' + entry['path'] for entry in prior['authorFiles']]
    for entry in review['files']:
        data = blob(STATUS_COMMIT, STATUS_PATH + '/' + entry['path'])
        assert len(data) == entry['bytes'] and sha(data) == entry['sha256']
        put(binding / entry['path'], data)
    assert inventory(binding) == review['files']
    preparation = load(binding / 'PREPARATION.json')
    candidate = temporary / 'candidate'
    package = temporary / 'package'
    for source, target, manifest in [(Path(prior['candidateRoot']), candidate, 'candidate-all940.json'), (Path(prior['packageRoot']), package, 'candidate-package709.json')]:
        expected = load(frozen / 'inventories' / manifest)
        assert inventory(source) == expected
        for entry in expected:
            data = (source / entry['path']).read_bytes()
            assert sha(data) == entry['sha256'] and len(data) == entry['bytes']
            put(target / entry['path'], data)
        assert inventory(target) == expected
    replacements = []
    adapter_before = (binding / 'driver-copies/admission.mjs.data').read_text()
    adapter = adapter_before
    owned_preparation_path = (HERE / 'PREPARATION.json').relative_to(REPOSITORY).as_posix()
    preparation_binding = '\n'.join([
        f'  const preparationPath = "{owned_preparation_path}";',
        '  const preparationCommit = git("log", "-1", "--format=%H", "--", preparationPath).toString().trim();',
        '  assert.match(preparationCommit, /^[a-f0-9]{40}$/u);',
        '  const preparationBytes = regular(join(repository, preparationPath));',
        '  assert.deepEqual(preparationBytes, git("show", `${preparationCommit}:${preparationPath}`));',
        '  const preparation = JSON.parse(preparationBytes);',
    ])
    for before, after in [
        (f'export const author = "{preparation["frozenRoot"]}";', f'export const author = "{frozen}";'),
        (f'const bindingOwner = "{REPOSITORY / STATUS_PATH}";', f'const bindingOwner = "{binding}";'),
        ('const freezePath = relative(repository, join(bindingOwner, "EXECUTION-FREEZE.json"));', f'const freezePath = "{STATUS_PATH}/EXECUTION-FREEZE.json";'),
        ('`${commit}:${relative(repository, filename)}`', f'`${{commit}}:{STATUS_PATH}/${{entry.path}}`'),
        ('  const preparation = load(join(bindingOwner, "PREPARATION.json"));', preparation_binding),
        (f'descriptor.startsWith(join(repository, "{AUTHOR_PATH}") + "/")', f'descriptor.startsWith(join(repository, "{HERE.relative_to(REPOSITORY)}") + "/")'),
    ]:
        adapter = replace_once(adapter, before, after)
        replacements.append({'before': before, 'after': after, 'classification': 'Exact regular-copy/read-location/public Git identity binding only'})
    runtime_entries = []
    for entry in preparation['runtimeEntries']:
        name = entry['path']
        if name == 'PRIVATE-STATUS.json':
            data = (binding / name).read_bytes()
        elif name in ['admission.mjs', 'lifecycle/run.mjs', 'controls/run.mjs']:
            data = (binding / 'driver-copies' / (name + '.data')).read_bytes()
        else:
            data = (frozen / name).read_bytes()
        assert sha(data) == entry['sha256'] and len(data) == entry['bytes']
        if name == 'admission.mjs':
            data = adapter.encode()
        put(runtime / name, data)
        runtime_entries.append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
    assert inventory(runtime) == runtime_entries and len(runtime_entries) == 38
    assert [entry['path'] for entry, original in zip(runtime_entries, preparation['runtimeEntries']) if entry != original] == ['admission.mjs']
    shape = [{'path': path.relative_to(frozen).as_posix(), 'kind': 'directory' if path.is_dir() else 'file'} for path in sorted(frozen.rglob('*'))]
    bindings = {**prior, 'authorRoot': str(frozen), 'authorDirectoryShape': shape, 'runtimeRoot': str(runtime), 'statusAuthorRoot': str(binding),
        'candidateRoot': str(candidate), 'packageRoot': str(package), 'outputRoot': str(temporary / 'raw'),
        'runtimeEntries': runtime_entries, 'statusAuthorFiles': review['files'], 'bindingPreparationCommit': STATUS_COMMIT,
        'bindingReviewCommit': REVIEW_COMMIT, 'bindingReviewPath': BASE + '/independent/status-review-v1/ADMISSION.json',
        'statusAuthorGitPath': STATUS_PATH, 'bindingVersion': 3,
        'parentExecution': 'Exact runtime38 from author71 plus six explicit independent admission location/Git bindings; all37 other runtime files exact. No preload/interception.',
        'immutableRoots': ['candidateRoot', 'packageRoot', 'authorRoot', 'runtimeRoot', 'statusAuthorRoot'],
        'priorRefusalCommits': ['8e950bd846f69b86f851d2a901e62e0b3bb92ded', '31f5678e62e3f3d43b4825d839ec970e7768da7d'],
        'compiledManifestSha256': preparation['compiledManifestSha256'], 'packageManifestSha256': preparation['packageManifestSha256'],
        'privateStatusProfileSha256': admission['privateStatusProfileSha256'], 'bindingFreezeSha256': admission['bindingFreezeSha256'],
        'driverAdaptations': 'Three author guard-only deltas; independent admission-only location bindings disclosed separately. No guest/scorer/semantic changes.',
        'runtimeGuestProductExecutionsAtPreparation': 0}
    add('BINDINGS.json', bindings)
    own_preparation = {key: preparation[key] for key in ['candidateManifestSha256', 'sourceManifestSha256', 'compiledManifestSha256', 'packageManifestSha256']}
    own_preparation.update({'temporary': str(temporary), 'runtimeRoot': str(runtime), 'runtimeEntries': runtime_entries,
        'candidateRoot': str(candidate), 'packageRoot': str(package), 'originalAuthorPreparationCommit': STATUS_COMMIT,
        'originalAuthorPreparationSha256': sha((binding / 'PREPARATION.json').read_bytes()), 'readLocationOnly': True})
    add('PREPARATION.json', own_preparation)
    release = {key: bindings[key] for key in ['authorFreezeCommit', 'candidateManifestSha256', 'sourceManifestSha256', 'compiledManifestSha256', 'packageManifestSha256', 'candidateRoot', 'packageRoot', 'outputRoot', 'bindingPreparationCommit', 'bindingFreezeSha256', 'privateStatusProfileSha256', 'bindingReviewCommit', 'bindingReviewPath']}
    release.update({'rootAuthorized': True, 'rootAuthorization': 'ROOT exact status decision plus conditional ONE new independent25-profile attempt, 2026-08-27. Only two declared untracked private status lines added; historical status changed explicitly, all other state remains exact. Runtime38 author71 guards and original a61 source/semantic fixtures, independently qualified75888094. Fresh isolated own copies, unchanged8 unconditional surface/11 lifecycle/6 controls with within-cohort stop and positive-open gates. Stop later cohorts for guard failure; no retry, source/limit/semantic repair, promotion or private writes.',
        'allowedCohorts': ['surface', 'lifecycle', 'controls'], 'independentReviewCommit': bindings['admissionCommit'], 'independentReviewPath': bindings['admissionPath'], 'noPromotion': True})
    add('ROOT-RELEASE.json', release)
    expected_raw = blob('31f5678e62e3f3d43b4825d839ec970e7768da7d', BASE + '/independent/replay-v2/attempt-01/raw/independent-surface/private-before.json')
    add('expected-private-ns.json.data', expected_raw.decode())
    historical = ast.parse((binding / 'binding.py').read_text())
    function = next(node for node in historical.body if isinstance(node, ast.FunctionDef) and node.name == 'historical_schema')
    historical_function = ast.get_source_segment((binding / 'binding.py').read_text(), function)
    old_run = blob(PRIOR_COMMIT, PRIOR_PATH + '/run.py').decode()
    run = old_run
    extra_auth = '''    assert inventory(Path(BINDINGS['runtimeRoot'])) == BINDINGS['runtimeEntries']
    assert inventory(Path(BINDINGS['statusAuthorRoot'])) == BINDINGS['statusAuthorFiles']
    for entry in BINDINGS['statusAuthorFiles']:
        assert sha(git(REPOSITORY, 'show', f"{BINDINGS['bindingPreparationCommit']}:{BINDINGS['statusAuthorGitPath']}/{entry['path']}")) == entry['sha256']
    binding_review = json.loads(git(REPOSITORY, 'show', f"{BINDINGS['bindingReviewCommit']}:{BINDINGS['bindingReviewPath']}"))
    assert binding_review['verdict'] == 'ALLOW_REPLAY_OF_EXACT_STATUS_BINDING'
    for key in ['bindingPreparationCommit', 'bindingFreezeSha256', 'privateStatusProfileSha256', 'authorFreezeCommit', 'candidateManifestSha256', 'sourceManifestSha256', 'compiledManifestSha256', 'packageManifestSha256']:
        assert binding_review[key] == BINDINGS[key] == load(HERE / 'ROOT-RELEASE.json')[key]
'''
    run = replace_once(run, "    assert inventory(AUTHOR) == BINDINGS['authorFiles']\n", "    assert inventory(AUTHOR) == BINDINGS['authorFiles']\n" + extra_auth)
    run = replace_once(run, "    for key in ['head', 'tree', 'status', 'staged']:\n        assert snapshot[key] == pins[key], key", "    expected_ns = load(HERE / 'expected-private-ns.json.data')\n    assert snapshot == expected_ns, 'Exact expected raw NS private state drift'\n    expected_ms = load(Path(BINDINGS['statusAuthorRoot']) / 'expected-private.json.data')\n    assert historical_schema(snapshot) == expected_ms, 'Historical whole metadata profile drift'\n    assert pins['status'] == load(Path(BINDINGS['statusAuthorRoot']) / 'PRIVATE-STATUS.json')['historicalStatus']\n    pins = {**pins, 'status': expected_ms['status']}\n    for key in ['head', 'tree', 'status', 'staged']:\n        assert snapshot[key] == pins[key], key")
    run = replace_once(run, '\ndef private_identity(snapshot):', '\n' + historical_function + '\n\ndef private_identity(snapshot):')
    assert run.count("['candidateRoot', 'packageRoot', 'authorRoot']") == 2
    run = run.replace("['candidateRoot', 'packageRoot', 'authorRoot']", "BINDINGS['immutableRoots']")
    run = replace_once(run, "command = [str(NODE), '--import', str(HERE / 'git-location-binding.mjs'), str(AUTHOR / cohort / 'run.mjs')]", "command = [str(NODE), str(Path(BINDINGS['runtimeRoot']) / cohort / 'run.mjs')]")
    run = replace_once(run, "'ZERO_OVERLAY_ROOT_RELEASE': str(HERE / 'ROOT-RELEASE.json'),\n                           'ZERO_OVERLAY_GIT_BINDING_LOG': str(directory / 'git-bindings.ndjson')", "'ZERO_OVERLAY_ROOT_RELEASE': str(HERE / 'ROOT-RELEASE.json')")
    run = replace_once(run, "run['privateUnchanged'] = before is not None and before == after", "run['privateUnchanged'] = None if before is None else before == after\n                if before is None:\n                    run['privateComparison'] = 'NOT_COMPARED: before snapshot absent; no passing guard claim'")
    run = replace_once(run, '        before = None\n', '        before = None\n        immutable = None\n')
    run = replace_once(run, "            after_inputs = {name: inventory(Path(BINDINGS[name]), True) for name in BINDINGS['immutableRoots']}\n            save(directory / 'independent-inputs-after.json', after_inputs)\n            assert immutable == after_inputs\n", '')
    run = replace_once(run, "                save(directory / 'authentication-after.json', authenticate())", "                after_inputs = {name: inventory(Path(BINDINGS[name]), True) for name in BINDINGS['immutableRoots']}\n                save(directory / 'independent-inputs-after.json', after_inputs)\n                run['inputsUnchanged'] = None if immutable is None else immutable == after_inputs\n                if immutable is None:\n                    run['inputComparison'] = 'NOT_COMPARED: before snapshot absent; no passing guard claim'\n                    assert 'parentStarted' not in run and run['status'] != 'PASS'\n                else:\n                    assert run['inputsUnchanged'] is True\n                save(directory / 'authentication-after.json', authenticate())")
    add('run.py', run)
    assessor = blob(PRIOR_COMMIT, PRIOR_PATH + '/assess.py')
    add('assess.py', assessor.decode())
    add('admission-location.patch-data', ''.join(difflib.unified_diff(adapter_before.splitlines(True), adapter.splitlines(True), fromfile='author71/admission.mjs', tofile='independent-v3/admission.mjs')))
    add('orchestration.patch-data', ''.join(difflib.unified_diff(old_run.splitlines(True), run.splitlines(True), fromfile='c3a3b429/run.py', tofile='independent-v3/run.py')))
    add('LOCATION-PROOF.json', {'replacements': replacements, 'authorRuntimeFiles': 38, 'runtimeFilesUnchangedFromAuthor71': 37,
        'admissionBeforeSha256': sha(adapter_before.encode()), 'admissionAfterSha256': sha(adapter.encode()),
        'ownPreparationGitAuthenticatedBeforeRead': True, 'source88SnapshotChanges': 0, 'status28SnapshotChanges': 0,
        'childGuestScorerCaseSignalCleanupBudgetTimerChanges': 0, 'assessorUnchangedSha256': sha(assessor),
        'sourceCandidateCopiedFrom': prior['candidateRoot'], 'packageCopiedFrom': prior['packageRoot'],
        'excludedAuthorEvidence': 'All author paths outside exact a61 selected88 and exact71 selected28 are NOT inputs, never enumerated recursively or read/executed. Both snapshots reject every unlisted regular file; runtime38 also exact. No whole-live-author-tree scan or broad ignore rule.',
        'privateQueries': 0, 'actualExecutions': 0, 'noPromotion': True})
    node = Path(bindings['node']['path'])
    assert regular(node)['sha256'] == bindings['node']['sha256']
    checks = []
    for path in sorted(runtime.rglob('*.mjs')):
        result = subprocess.run([str(node), '--check', str(path)], env=ENVIRONMENT, capture_output=True)
        assert result.returncode == 0, result.stderr.decode()
        checks.append({'path': path.relative_to(runtime).as_posix(), 'exitCode': result.returncode})
    for path in [HERE / 'prepare.py', HERE / 'run.py', HERE / 'assess.py']:
        ast.parse(path.read_text())
    for entry in bindings['publicReferenceBindings']:
        data = blob(entry['commit'], entry['path'])
        assert sha(data) == entry['sha256'] and (REPOSITORY / entry['path']).read_bytes() == data
    add('STATIC-CHECKS.json', {'pythonAstChecks': 3, 'nodeParserOnlyChecks': checks, 'publicReferencesAuthenticated': len(bindings['publicReferenceBindings']),
        'sourceFiles': 213, 'candidateFiles': 940, 'compiledFiles': 708, 'packageFiles': 709,
        'allEffectiveRuntimeInputsEnumerated': True, 'privateQueries': 0, 'actualExecutions': 0, 'pendingOneAttempt': True})
    print(json.dumps({'temporary': str(temporary), 'runtimeRoot': str(runtime), 'sourceInputs': 88, 'statusInputs': 28, 'runtimeFiles': 38, 'parserOnlyChecks': len(checks), 'privateQueries': 0, 'actualExecutions': 0}))


if __name__ == '__main__':
    main()
