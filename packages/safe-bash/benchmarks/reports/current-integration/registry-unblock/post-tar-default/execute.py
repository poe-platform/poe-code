import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent
spec = importlib.util.spec_from_file_location('historical_registry_executor', PARENT / 'execute.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.REPORT = HERE
base.EVIDENCE = HERE / 'execution'
original_inventory = base.inventory


def inventory():
    selected, excluded = original_inventory()
    for name in list(selected):
        path = Path(name)
        generated_names = {'legacy-current.json', 'built-checks.json', 'native-reverification.json',
                           'primary-references.json', 'preparation-type-evidence.json', 'ready-wait.json',
                           'invocation-closure-read-checkpoint.json'}
        if path.name in generated_names or any(part.startswith('.invocation-closure-') for part in path.parts) or path.suffix in {'.out', '.err'} or (path.suffix == '.json' and
                path.name.startswith(('final-', 'first-fix', 'root-fix', 'validation.')) and
                'jq-42-author-20260827' in path.parts):
            excluded[name] = 'concurrent unrelated command-generated output'
            del selected[name]
    return selected, excluded


def dependencies(source):
    accepted = json.loads((PARENT.parent / 'dependencies.json').read_text())['root']
    assert base.digest(source / 'package-lock.json') == accepted['lockSha256']
    manifest = json.loads((source / 'package.json').read_text())
    lock = json.loads((source / 'package-lock.json').read_text())
    historical_manifest = json.loads((base.OLD / 'package.json').read_text())
    for field in ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'workspaces']:
        assert manifest.get(field) == historical_manifest.get(field), field
    assert manifest['devDependencies'] == lock['packages']['']['devDependencies']
    hidden = json.loads((base.OLD / 'node_modules/.package-lock.json').read_text())
    for name, entry in accepted['files'].items():
        origin = base.OLD / 'node_modules' / name
        assert not origin.is_symlink() and origin.stat().st_nlink == 1
        assert base.digest(origin) == entry['sha256'], name
        target = source / 'node_modules' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, target)
        assert target.stat().st_nlink == 1 and base.digest(target) == entry['sha256']
    for name, link in accepted['internalLinks'].items():
        target = source / 'node_modules' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(link)
        assert target.resolve().is_relative_to((source / 'node_modules').resolve())
    for name, entry in accepted['packages'].items():
        actual = json.loads((source / name / 'package.json').read_text())
        assert actual['version'] == lock['packages'][name]['version'] == entry['version']
        for field in ['version', 'resolved', 'integrity']:
            assert hidden['packages'][name].get(field) == lock['packages'][name].get(field)
    return {'method': 'private regular copies of verified installed locked root dependencies; four internal relative .bin links',
            'lockSha256': accepted['lockSha256'], 'currentManifestSha256': base.digest(source / 'package.json'),
            'manifestChange': 'tar export added; all dependency/workspace declarations unchanged and locked',
            'files': len(accepted['files']), 'packages': accepted['packages'], 'links': accepted['internalLinks'],
            'limitations': ['Installed bytes match accepted hashes; no npm tarball re-extraction.',
                           'Platform-inapplicable optional packages absent; no comparator dependencies or just-bash run.']}


base.inventory = inventory
base.reuse_dependencies = dependencies


def freeze():
    base.EVIDENCE.mkdir(exist_ok=False)
    started = time.time()
    original_attempt = HERE / 'selection-attempt1/sealed-input.json'
    budget_started = json.loads(original_attempt.read_text())['startedEpoch'] if original_attempt.exists() else started
    workspace = Path(tempfile.mkdtemp(prefix='safe-bash-registry-post-tar-', dir='/tmp'))
    attempts = []
    for attempt in range(3):
        before = base.live_state()
        files, exclusions = inventory()
        source = workspace / f'source-attempt-{attempt + 1}'
        try:
            base.copy_source(files, source)
            after_files, after_exclusions = inventory()
            after = base.live_state()
            stable = files == after_files and exclusions == after_exclusions and before == after
            attempts.append({'attempt': attempt + 1, 'before': before, 'after': after, 'stable': stable,
                             'selectedBefore': base.fingerprint(files), 'selectedAfter': base.fingerprint(after_files)})
        except (AssertionError, RuntimeError, FileNotFoundError) as error:
            stable = False
            attempts.append({'attempt': attempt + 1, 'before': before, 'stable': False, 'error': str(error)})
        base.save(base.EVIDENCE / 'capture-attempts.json', attempts)
        if stable:
            break
        if time.time() - started > 90:
            raise RuntimeError('moving source capture exhausted bounded preparation')
    else:
        raise RuntimeError('three moving captures; no execution')
    handoffs = {}
    for commit, names in {
        '4a737f9': ['src/index.ts', 'src/plugins/index.ts', 'package.json', 'tests/plugins/agent-commands.test.ts'],
        '98498c1': ['tests/integration/adapter-tools/fixtures.ts', 'tests/integration/adapter-tools/preflight-review/preflight.ts', 'tests/integration/adapter-tools/preflight-review/preflight.test.ts'],
        '7d0fe7b': ['tests/commands/metadata/integration.test.ts'],
    }.items():
        base.git('merge-base', '--is-ancestor', commit, before['head'])
        for name in names:
            committed = hashlib.sha256(base.git('show', f'{commit}:{name}')).hexdigest()
            assert files[name]['sha256'] == committed, name
            handoffs[name] = {'commit': base.git('rev-parse', commit).decode().strip(), 'sha256': committed, 'matches': True}
    historical = json.loads((PARENT / 'historical-99.json').read_text())
    for cohort in historical['cohorts']:
        assert files[cohort['file']]['sha256'] == cohort['sourceSha256'], cohort['file']
    old_names = json.loads((PARENT / 'expected-default-commands.json').read_text())['names']
    new_names = json.loads((HERE / 'expected-default-commands.json').read_text())['names']
    assert sorted(new_names) == sorted([*old_names, 'tar']) and len(set(new_names)) == 53
    dependency_evidence = dependencies(source)
    for name in ['expected-default-commands.json', 'independent-mutations.test.mjs']:
        target = workspace / 'aux' / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(HERE / name, target)
    commands = json.loads((PARENT / 'proposed-commands.json').read_text())
    phases = commands['baselineCohorts']
    probe = commands['baselineRegistryProbe']
    probe['phase'] = 'exact-registry53'
    probe['argv'][-2] = probe['argv'][-2].replace('52', '53')
    probe['argv'][-1] = str(workspace / 'aux/expected-default-commands.json')
    phases.append(probe)
    phases.extend([
        {'phase': 'registry-author2', 'timeoutSeconds': 40, 'argv': ['node', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern=^(?:aggregate definitions are exactly the eight delivered families, each registered once|metadata root API preflights collisions and excludes optional network/runtime plugins)$', 'tests/plugins/agent-commands.test.ts', 'tests/commands/metadata/integration.test.ts']},
        {'phase': 'preflight-author30', 'timeoutSeconds': 60, 'argv': ['node', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/integration/adapter-tools/preflight-review/preflight.test.ts']},
        {'phase': 'independent162', 'timeoutSeconds': 240, 'mutation': True, 'argv': ['node', '--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'audit/independent-mutations.test.mjs']},
    ])
    state = {'startedEpoch': budget_started, 'captureStartedEpoch': started, 'deadlineEpoch': budget_started + 900, 'workspace': str(workspace), 'source': str(source),
             'liveBefore': before, 'liveAfterSeal': after, 'files': files, 'exclusions': exclusions,
             'fingerprint': base.fingerprint(files), 'srcFingerprint': base.fingerprint({name: entry for name, entry in files.items() if name.startswith('src/')}),
             'dirtySource': bool(before['status']), 'handoffs': handoffs, 'dependencies': dependency_evidence,
             'historicalTestFilesUnchanged': True, 'phases': phases, 'priorStageManifestSha256': base.digest(PARENT / 'ARTIFACTS.sha256'),
             'runnerSha256': base.digest(HERE / 'execute.py'), 'reusedParentExecutorSha256': base.digest(PARENT / 'execute.py'),
             'scripts': json.loads((source / 'package.json').read_text())['scripts']}
    base.save(base.EVIDENCE / 'sealed-input.json', state)
    checkpoint = f"POST-TAR separate frozen DIRTY {before['head']}\nselected SHA256 {state['fingerprint']}\nsrc SHA256 {state['srcFingerprint']}\n{len(files)} selected regular files; {len(exclusions)} exclusions; capture stable; 4a737f9 exact handoff matches\nSnapshot {source}\nExact99=79+8+6+6; independent154 same-cardinality53 omissions +7 optional54 workflows +1 literal22 contract; separate literal53/registry2/author30.\nExact argv and per-file hashes: {base.EVIDENCE / 'sealed-input.json'}\n900-second deadline, no fullsuite/comparator/tar semantic tests; prior52 phase immutable.\n"
    (base.EVIDENCE / 'checkpoint.txt').write_text(checkpoint)
    Path('/tmp/safe-bash-registry-post-tar-checkpoint.txt').write_text(checkpoint)
    print(checkpoint, flush=True)


def refine():
    base.EVIDENCE.mkdir(exist_ok=False)
    prior = json.loads((HERE / 'selection-attempt1/sealed-input.json').read_text())
    origin = Path(prior['source'])
    assert base.verify_source(prior['files'], origin)['same']
    removed_names = {'legacy-current.json', 'preparation-type-evidence.json', 'ready-wait.json',
                     'invocation-closure-read-checkpoint.json'}
    files = {name: entry for name, entry in prior['files'].items() if Path(name).name not in removed_names}
    removed = {name: entry for name, entry in prior['files'].items() if name not in files}
    workspace = Path(tempfile.mkdtemp(prefix='safe-bash-registry-post-tar-refined-', dir='/tmp'))
    source = workspace / 'source'
    for name, entry in files.items():
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(origin / name, target)
        assert target.stat().st_nlink == 1 and not target.is_symlink() and base.digest(target) == entry['sha256']
    assert base.verify_source(prior['files'], origin)['same']
    assert base.verify_source(files, source)['same']
    dependency_evidence = dependencies(source)
    for name in ['expected-default-commands.json', 'independent-mutations.test.mjs']:
        target = workspace / 'aux' / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(HERE / name, target)
    state = dict(prior)
    state.update({'workspace': str(workspace), 'source': str(source), 'files': files,
                  'fingerprint': base.fingerprint(files), 'dependencies': dependency_evidence,
                  'runnerSha256': base.digest(HERE / 'execute.py'),
                  'exclusions': {**prior['exclusions'], **{name: 'generated nonexecuted report omitted in refined input' for name in removed}},
                  'refinement': {'capturedEpoch': time.time(), 'origin': str(origin), 'originSelectedHash': prior['fingerprint'],
                                 'removed': removed, 'originBeforeAfterSame': True, 'liveStateSeparate': base.live_state(),
                                 'reason': 'Retain authorized53 source sealed current at original capture; remove four nonexecuted generated JSON reports. Later live56 integration rejected, not folded into53 evidence.'}})
    for phase in state['phases']:
        if phase['phase'] == 'exact-registry53':
            phase['argv'][-1] = str(workspace / 'aux/expected-default-commands.json')
    assert state['srcFingerprint'] == base.fingerprint({name: entry for name, entry in files.items() if name.startswith('src/')})
    base.save(base.EVIDENCE / 'sealed-input.json', state)
    checkpoint = f"REFINED authorized53 input from frozen DIRTY {state['liveBefore']['head']}\nselected SHA256 {state['fingerprint']}\nsrc SHA256 {state['srcFingerprint']} (unchanged)\n{len(files)} regular files; four generated nonexecuted JSON reports excluded; no product/test/expectation edits\nOriginal live freeze {origin}; refined source {source}\nLater current56 capture rejected; not represented as tested53. Same original900-second deadline.\nExact commands: {base.EVIDENCE / 'sealed-input.json'}\n"
    (base.EVIDENCE / 'checkpoint.txt').write_text(checkpoint)
    Path('/tmp/safe-bash-registry-post-tar-checkpoint.txt').write_text(checkpoint)
    print(checkpoint, flush=True)


if __name__ == '__main__':
    {'freeze': freeze, 'refine': refine, 'run': base.run, 'supplement': lambda: base.run(True)}[sys.argv[1]]()
