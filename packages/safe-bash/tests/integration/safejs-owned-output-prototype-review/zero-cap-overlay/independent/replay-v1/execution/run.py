import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
BINDINGS = json.loads((HERE / 'BINDINGS.json').read_bytes())
AUTHOR = Path(BINDINGS['authorRoot'])
OUTPUT = Path(BINDINGS['outputRoot'])
NODE = Path(BINDINGS['node']['path'])
PRIVATE = Path('/Users/kjopek/Workspace/poe-code')
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


def save(path, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(data)


def git(root, *args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(root), '-c', 'core.fsmonitor=false', *args],
                                   env=ENVIRONMENT, timeout=20)


def regular(path, metadata=False):
    assert path.resolve() == path and path.is_file() and not path.is_symlink(), str(path)
    stat = path.stat()
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha(data), **({'mode': stat.st_mode & 0o777,
            'mtimeNs': stat.st_mtime_ns, 'ctimeNs': stat.st_ctime_ns} if metadata else {})}


def inventory(root, metadata=False, excluded=()):
    assert root.resolve() == root and root.is_dir()
    entries = []

    def visit(directory):
        for path in sorted(directory.iterdir()):
            if path.name in excluded:
                continue
            assert not path.is_symlink(), str(path)
            if path.is_dir():
                visit(path)
            else:
                entries.append({'path': path.relative_to(root).as_posix(), **regular(path, metadata)})

    visit(root)
    return sorted(entries, key=lambda entry: entry['path'])


def authenticate():
    freeze_path = (HERE / 'FREEZE.json').relative_to(REPOSITORY).as_posix()
    commit = git(REPOSITORY, 'log', '-1', '--format=%H', '--', freeze_path).decode().strip()
    assert git(REPOSITORY, 'show', f'{commit}:{freeze_path}') == (HERE / 'FREEZE.json').read_bytes()
    for entry in load(HERE / 'FREEZE.json')['files']:
        filename = HERE / entry['path']
        assert regular(filename)['sha256'] == entry['sha256']
        assert git(REPOSITORY, 'show', f'{commit}:{filename.relative_to(REPOSITORY)}') == filename.read_bytes()
    assert inventory(AUTHOR) == BINDINGS['authorFiles']
    for entry in BINDINGS['authorFiles']:
        path = (AUTHOR / entry['path']).relative_to(REPOSITORY).as_posix()
        assert sha(git(REPOSITORY, 'show', f"{BINDINGS['authorFreezeCommit']}:{path}")) == entry['sha256']
    assert regular(NODE)['sha256'] == BINDINGS['node']['sha256']
    for key, filename in [('candidateRoot', 'candidate-all940.json'), ('packageRoot', 'candidate-package709.json')]:
        assert inventory(Path(BINDINGS[key])) == load(AUTHOR / 'inventories' / filename)
    receipt = load(HERE / 'ROOT-RELEASE.json')
    review = json.loads(git(REPOSITORY, 'show', f"{receipt['independentReviewCommit']}:{receipt['independentReviewPath']}"))
    assert review['verdict'] == 'ALLOW_REPLAY_OF_EXACT_FREEZE'
    for key in ['authorFreezeCommit', 'candidateManifestSha256', 'sourceManifestSha256']:
        assert review[key] == receipt[key] == BINDINGS[key]
    return {'at': now(), 'independentRunnerFreeze': commit, 'authorFreeze': BINDINGS['authorFreezeCommit'],
            'admissionCommit': receipt['independentReviewCommit'], 'nodeSha256': regular(NODE)['sha256'],
            'authorFiles': len(BINDINGS['authorFiles']), 'candidateFiles': 940, 'packageFiles': 709}


def private_snapshot():
    def text(*args):
        return git(PRIVATE, *args).decode()

    index = Path(text('rev-parse', '--git-path', 'index').strip())
    if not index.is_absolute():
        index = PRIVATE / index
    return {'head': text('rev-parse', 'HEAD').strip(), 'tree': text('rev-parse', 'HEAD^{tree}').strip(),
            'status': text('status', '--porcelain=v1'), 'staged': text('diff', '--cached', '--name-status'),
            'index': regular(index, True), 'metadata': {name: regular(PRIVATE / name, True) for name in
            ['AGENTS.md', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'packages/poe-agent/package.json']},
            'engine': inventory(PRIVATE / 'packages/safejs', True, ['.git', 'node_modules', 'dist', '.cache', '.turbo'])}


def private_identity(snapshot):
    pins = load(REPOSITORY / 'tests/integration/safejs-owned-output-prototype-review/lifecycle/SOURCE-PINS.json')['privateExpectedAtRelease']
    for key in ['head', 'tree', 'status', 'staged']:
        assert snapshot[key] == pins[key], key
    assert snapshot['index']['sha256'] == pins['index']['sha256']
    assert len(snapshot['metadata']) == 6 and len(snapshot['engine']) == 264
    for name, value in snapshot['metadata'].items():
        assert value['sha256'] == pins['metadata'][name]['sha256'], name
    files = [{key: entry[key] for key in ['path', 'bytes', 'sha256']} for entry in snapshot['engine']]
    assert sha(json.dumps(files, separators=(',', ':')).encode()) == pins['engineInventorySha256']


def imports_check(raw_root, cohort, parent):
    expected = {}
    if cohort == 'surface':
        temporary = Path(parent['task'])
        sets = load(raw_root / 'inputs-before.json')
        for root, entries in sets.items():
            for entry in entries:
                expected[(Path(root) / entry['path']).relative_to(temporary).as_posix()] = entry['sha256']
    else:
        sets = load(raw_root / 'immutable-before.json')
        for root, entries in sets.items():
            for entry in entries:
                expected[f"{root}/{entry['path']}"] = entry['sha256']
    journals = sorted(raw_root.rglob('*.imports.ndjson')) if cohort != 'surface' else sorted(raw_root.glob('*/imports.ndjson'))
    observations = []
    for path in journals:
        records = [json.loads(line) for line in path.read_text().splitlines() if line]
        assert records
        for entry in records:
            assert expected.get(entry['path']) == entry['sha256'], entry
        names = {entry['path'] for entry in records}
        for required in ['engine/src/run.ts', 'engine/src/interp/budget.ts', 'engine/src/modules/fs.ts', 'engine/src/interp/host-bridge.ts']:
            assert required in names, (path.name, required)
        assert any(name.startswith('consumer/node_modules/virtual-bash/dist/') for name in names)
        assert not any(name.startswith('engine/dist/') or 'poe-agent' in name for name in names)
        observations.append({'journal': path.relative_to(raw_root).as_posix(), 'entries': len(records),
                             'engineFiles': len([name for name in names if name.startswith('engine/')]), 'exact': True})
    return observations


def assess_cohort(cohort, directory):
    from assess import CONTROLS, LIFECYCLE, SURFACE, lifecycle_check, surface_check

    if cohort == 'surface':
        locations = sorted(OUTPUT.glob('surface-zero-overlay-*/results/journal.json'))
        assert len(locations) == 1
        raw_root = locations[0].parent
        parent = load(locations[0])
        cases = [row for row in SURFACE['cases'] if not row.get('conditional')]
        assert len(cases) == 8
        assert parent['privateUnchanged'] and parent['inputTreesUnchanged'] and parent['sharedTreesUnchanged']
        assert not parent['failures']
        assert parent['counts']['conditionalExecuted'] == 0
        assert parent['status'] == 'EXECUTION_SETTLED'
    else:
        raw_root = OUTPUT / f'{cohort}-raw'
        parent = load(raw_root / 'report.json')
        cases = (LIFECYCLE if cohort == 'lifecycle' else CONTROLS)['rows']
        assert parent['privateUnchanged'] and parent['sharedUnchanged']
        assert parent['cleanup']['knownCaseChildrenClosed'] and parent['cleanup']['removed']
        assert not any(parent.get(key) for key in ['failure', 'privateAfterFailure', 'afterGuardFailure', 'finalContainment'])
    before = load(raw_root / 'private-before.json')
    after = load(raw_root / 'private-after.json')
    assert {key: value for key, value in before.items() if key != 'at'} == {key: value for key, value in after.items() if key != 'at'}
    assert before['head'] == 'bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e' and len(before['engine']) == 264
    assert len(before['metadata']) == 6
    imports = imports_check(raw_root, cohort, parent)
    children = parent['children']
    assert all(entry.get('closed') and not entry.get('signal') and not entry.get('timedOut') and not entry.get('outputExceeded') and not entry.get('containment') for entry in children)
    assert all(entry.get('code') == 0 for entry in children)
    results = []
    for selected in cases:
        filename = raw_root / selected['id'] / 'actual.json' if cohort == 'surface' else raw_root / (selected['id'] + '.json')
        entry = {'id': selected['id'], 'classification': 'BLOCKED', 'rawPresent': filename.exists(), 'engineRuns': 0}
        if filename.exists():
            raw = load(filename)
            entry['engineRuns'] = raw.get('runtimeCalls', raw.get('engineRuns', 0))
            entry['authorClassification'] = raw.get('classification')
            try:
                (surface_check if cohort == 'surface' else lifecycle_check)(raw, selected)
                entry['classification'] = 'PASS'
            except Exception as error:
                entry.update(classification='FAIL', error=repr(error))
            if cohort == 'surface':
                entry['engineOutcome'] = raw.get('engineOutcome')
                entry['publicOutcome'] = raw.get('shell')
                entry['qualification'] = 'DIALECT_ONLY' if selected['id'].startswith('07-') else 'OBSERVED_AWAIT_REJECTION' if selected['id'].startswith('08-') else 'SUPPORTED_SURFACE'
            else:
                entry['publicOutcome'] = raw.get('publicOutcome')
                entry['selector'] = raw.get('selector')
                entry['network'] = raw.get('network')
                entry['zeroPolicy'] = raw.get('zeroPolicy')
            if selected.get('requiresPositive') or selected.get('requiresMatchedOpen'):
                for key in ['requiresPositive', 'requiresMatchedOpen']:
                    if selected.get(key):
                        assert any(previous['id'] == selected[key] and previous['classification'] == 'PASS' for previous in results)
        results.append(entry)
    counts = {'scheduled': len(cases), 'childrenLaunched': len(children), 'engineRuns': sum(entry['engineRuns'] for entry in results),
              **{key.lower(): sum(entry['classification'] == key for entry in results) for key in ['PASS', 'FAIL', 'BLOCKED']}}
    assert len(imports) == len(children)
    return {'cohort': cohort, 'rawRoot': str(raw_root), 'counts': counts, 'rows': results, 'imports': imports,
            'privateBeforeAfterExact': True, 'privateHead': before['head'], 'allKnownChildrenClosed': True,
            'authorParentStatus': parent['status'], 'independentAllPass': counts['pass'] == len(cases), 'noPromotion': True}


def data_negatives(assessments):
    from assess import CONTROLS, LIFECYCLE, SURFACE, lifecycle_check, surface_check

    roots = {entry['cohort']: Path(entry['rawRoot']) for entry in assessments}
    surface = load(roots['surface'] / '08-function-spread-profile/actual.json')
    precedence = load(roots['lifecycle'] / 'L05-execution-error.json')
    success = load(roots['controls'] / 'Z01-open.json')
    retry = load(roots['controls'] / 'Z02-open.json')
    mutations = []
    changed = copy.deepcopy(surface); changed['events'].remove('actual-engine-run-rejected')
    mutations.append((BINDINGS['dataOnlyMutants'][0], surface_check, changed, SURFACE['cases'][7]))
    changed = copy.deepcopy(surface); changed['engine'] = {'ok': False}
    mutations.append((BINDINGS['dataOnlyMutants'][1], surface_check, changed, SURFACE['cases'][7]))
    changed = copy.deepcopy(precedence); changed['publicOutcome'].update(kind='result', result={'exitCode': 1})
    mutations.append((BINDINGS['dataOnlyMutants'][2], lifecycle_check, changed, next(row for row in LIFECYCLE['rows'] if row['id'] == changed['id'])))
    changed = copy.deepcopy(success); changed['network']['authorizationJournal'].append(copy.deepcopy(changed['network']['authorizationJournal'][0]))
    mutations.append((BINDINGS['dataOnlyMutants'][3], lifecycle_check, changed, CONTROLS['rows'][0]))
    changed = copy.deepcopy(success); changed['events'] = [entry for entry in changed['events'] if entry['event'] != 'response-disposed']
    mutations.append((BINDINGS['dataOnlyMutants'][4], lifecycle_check, changed, CONTROLS['rows'][0]))
    changed = copy.deepcopy(retry); changed['zeroPolicy']['timerRequests'].append({'operation': 'setTimeout', 'delay': 1000})
    mutations.append((BINDINGS['dataOnlyMutants'][5], lifecycle_check, changed, CONTROLS['rows'][2]))
    changed = copy.deepcopy(retry); changed['files']['/work/body.bin']['hex'] = ''
    mutations.append((BINDINGS['dataOnlyMutants'][6], lifecycle_check, changed, CONTROLS['rows'][2]))
    results = []
    for name, predicate, changed, selected in mutations:
        try:
            predicate(changed, selected)
        except (AssertionError, KeyError, ValueError) as error:
            results.append({'id': name, 'rejected': True, 'reason': repr(error)})
        else:
            results.append({'id': name, 'rejected': False})
    return {'kind': 'DATA_ONLY_NOT_GUEST_PASSES', 'controls': results, 'allRejected': all(entry['rejected'] for entry in results), 'guestExecutions': 0}


def main():
    assert Path.cwd() == REPOSITORY and OUTPUT.resolve() == OUTPUT
    save(OUTPUT / 'attempt-once.json', {'started': now(), 'cohorts': BINDINGS['cohorts'], 'automaticRetries': 0})
    authenticate()
    runs = []
    assessments = []
    blocked = None
    for cohort in BINDINGS['cohorts']:
        directory = OUTPUT / f'independent-{cohort}'
        directory.mkdir()
        run = {'cohort': cohort, 'started': now(), 'status': 'BLOCKED', 'childrenLaunched': 0}
        if blocked:
            run['reason'] = blocked
            save(directory / 'run.json', run); runs.append(run)
            continue
        before = None
        try:
            before = private_snapshot(); save(directory / 'private-before.json', before); private_identity(before)
            save(directory / 'authentication-before.json', authenticate())
            immutable = {name: inventory(Path(BINDINGS[name]), True) for name in ['candidateRoot', 'packageRoot']}
            save(directory / 'independent-inputs-before.json', immutable)
            command = [str(NODE), str(AUTHOR / cohort / 'run.mjs')]
            if cohort != 'surface':
                command.append(str(OUTPUT / f'{cohort}-raw'))
            run['command'] = command
            environment = {**ENVIRONMENT, 'HOME': str(OUTPUT / 'home'), 'TMPDIR': str(OUTPUT / 'tmp'),
                           'TMP': str(OUTPUT / 'tmp'), 'TEMP': str(OUTPUT / 'tmp'),
                           'ZERO_OVERLAY_ROOT_RELEASE': str(HERE / 'ROOT-RELEASE.json')}
            run['parentStarted'] = now()
            with (directory / 'parent.stdout.txt').open('xb') as stdout, (directory / 'parent.stderr.txt').open('xb') as stderr:
                completed = subprocess.run(command, cwd=REPOSITORY, env=environment, stdout=stdout, stderr=stderr)
            run['parentClosed'] = now(); run['parentExitCode'] = completed.returncode
            assessment = assess_cohort(cohort, directory)
            save(directory / 'independent-assessment.json', assessment); assessments.append(assessment)
            run['childrenLaunched'] = assessment['counts']['childrenLaunched']
            run['counts'] = assessment['counts']
            run['status'] = 'PASS' if completed.returncode == 0 and assessment['independentAllPass'] else 'FAIL'
            after_inputs = {name: inventory(Path(BINDINGS[name]), True) for name in ['candidateRoot', 'packageRoot']}
            save(directory / 'independent-inputs-after.json', after_inputs)
            assert immutable == after_inputs
        except Exception as error:
            run['status'] = 'BLOCKED_INPUT_OR_ASSESSMENT' if 'parentStarted' not in run else 'NONPASS_REQUIRES_RAW_REVIEW'
            run['error'] = repr(error)
        finally:
            try:
                after = private_snapshot(); save(directory / 'private-after.json', after)
                run['privateUnchanged'] = before is not None and before == after
                assert run['privateUnchanged']
                private_identity(after)
            except Exception as error:
                run['privateAfterFailure'] = repr(error); run['status'] = 'PRIVATE_GUARD_NONPASS'
            try:
                save(directory / 'authentication-after.json', authenticate())
            except Exception as error:
                run['authenticationAfterFailure'] = repr(error); run['status'] = 'INPUT_GUARD_NONPASS'
            run['finished'] = now(); save(directory / 'run.json', run); runs.append(run)
        print(json.dumps(run), flush=True)
        if run['status'] != 'PASS':
            blocked = f"Earlier {cohort} cohort nonpass; no later cohort or retry launched"
    if len(assessments) == 3 and all(run['status'] == 'PASS' for run in runs):
        negatives = data_negatives(assessments)
    else:
        negatives = {'kind': 'DATA_ONLY_NOT_GUEST_PASSES', 'status': 'BLOCKED', 'reason': 'All three independently passing baselines required', 'guestExecutions': 0}
    save(OUTPUT / 'data-negatives.json', negatives)
    summary = {'finished': now(), 'runs': runs, 'dataNegatives': negatives, 'automaticRetries': 0,
               'noPromotion': True, 'allPass': all(run['status'] == 'PASS' for run in runs) and negatives.get('allRejected', False)}
    save(OUTPUT / 'independent-summary.json', summary)
    print(json.dumps({'summary': str(OUTPUT / 'independent-summary.json'), 'allPass': summary['allPass']}), flush=True)
    return 0 if summary['allPass'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
