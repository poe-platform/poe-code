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
spec = importlib.util.spec_from_file_location('post_tar_executor', PARENT / 'post-tar-default/execute.py')
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)
base = reuse.base
reuse.HERE = HERE
base.REPORT = HERE
base.EVIDENCE = HERE / 'execution'
previous_inventory = base.inventory


def inventory():
    selected, excluded = previous_inventory()
    output_names = {'bounded-validation.json', 'legacy-native-proof.json', 'legacy-product-proof.json',
                    'validation.json', 'runtime-fix-evidence.json', 'stat-source-provenance.json',
                    'approved-policy-validation.json', 'handoff-recheck.json'}
    for name in list(selected):
        path = Path(name)
        output_tree = any(part in {'runtime-review', 'baseline', 'results', 'out', 'output'} for part in path.parts)
        fixture_debris = any(part.startswith(('.invocation-', '.native-', '.real-', '.verify-')) for part in path.parts)
        if output_tree or fixture_debris or path.name in output_names or path.name.startswith(('post-handoff-', 'final-checks', 'commit-audit', 'preparation-audit', 'preparation-final-types')):
            excluded[name] = 'generated results/output tree or temporary fixture debris'
            del selected[name]
    return selected, excluded


base.inventory = inventory


def freeze():
    base.EVIDENCE.mkdir(exist_ok=False)
    started = time.time()
    workspace = Path(tempfile.mkdtemp(prefix='safe-bash-registry-final56-', dir='/tmp'))
    before = base.live_state()
    files, exclusions = inventory()
    source = workspace / 'source'
    base.copy_source(files, source)
    after_files, after_exclusions = inventory()
    after = base.live_state()
    stable = files == after_files and exclusions == after_exclusions and before == after
    base.save(base.EVIDENCE / 'capture-check.json', {'before': before, 'after': after, 'stable': stable,
              'beforeHash': base.fingerprint(files), 'afterHash': base.fingerprint(after_files), 'workspace': str(workspace)})
    assert stable, 'single current capture moved; no execution and no repeated chase'
    handoffs = {}
    for commit in ['33347b7', '4a737f9', '98498c1', '7d0fe7b']:
        base.git('merge-base', '--is-ancestor', commit, before['head'])
        handoffs[commit] = {'fullCommit': base.git('rev-parse', commit).decode().strip(), 'ancestor': True}
    for commit, names in {
        '33347b7': ['src/index.ts', 'src/plugins/index.ts', 'package.json', 'tests/plugins/agent-commands.test.ts'],
        '98498c1': ['tests/integration/adapter-tools/fixtures.ts', 'tests/integration/adapter-tools/preflight-review/preflight.ts', 'tests/integration/adapter-tools/preflight-review/preflight.test.ts'],
    }.items():
        for name in names:
            expected = hashlib.sha256(base.git('show', f'{commit}:{name}')).hexdigest()
            assert files[name]['sha256'] == expected, name
            handoffs[name] = {'commit': commit, 'sha256': expected, 'matches': True}
    historical = json.loads((PARENT / 'historical-99.json').read_text())
    for cohort in historical['cohorts']:
        assert files[cohort['file']]['sha256'] == cohort['sourceSha256'], cohort['file']
    dependency_evidence = reuse.dependencies(source)
    for name in ['expected-default-commands.json', 'independent-mutations.test.mjs', 'registry-observation.mjs']:
        target = workspace / 'aux' / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(HERE / name, target)
    (source / 'audit').mkdir()
    shutil.copyfile(HERE / 'registry-observation.mjs', source / 'audit/registry-observation.mjs')
    phases = json.loads((PARENT / 'proposed-commands.json').read_text())['baselineCohorts']
    phases.extend([
        {'phase': 'registry-author-full', 'timeoutSeconds': 90, 'argv': ['node', '--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/plugins/agent-commands.test.ts']},
        {'phase': 'registry-observation', 'timeoutSeconds': 30, 'argv': ['node', '--import', 'tsx', 'audit/registry-observation.mjs']},
        {'phase': 'preflight-author30', 'timeoutSeconds': 60, 'argv': ['node', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/integration/adapter-tools/preflight-review/preflight.test.ts']},
        {'phase': 'independent162', 'timeoutSeconds': 240, 'mutation': True, 'argv': ['node', '--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'audit/independent-mutations.test.mjs']},
    ])
    state = {'startedEpoch': started, 'deadlineEpoch': started + 900, 'workspace': str(workspace), 'source': str(source),
             'liveBefore': before, 'liveAfterSeal': after, 'files': files, 'exclusions': exclusions,
             'fingerprint': base.fingerprint(files), 'srcFingerprint': base.fingerprint({name: entry for name, entry in files.items() if name.startswith('src/')}),
             'dirtySource': bool(before['status']), 'handoffs': handoffs, 'dependencies': dependency_evidence,
             'historicalTestFilesUnchanged': True, 'phases': phases,
             'runnerSha256': base.digest(HERE / 'execute.py'), 'reusedExecutorSha256': base.digest(PARENT / 'execute.py'),
             'reusedDependencyHelperSha256': base.digest(PARENT / 'post-tar-default/execute.py'),
             'scripts': json.loads((source / 'package.json').read_text())['scripts']}
    base.save(base.EVIDENCE / 'sealed-input.json', state)
    checkpoint = f"FINAL ROOT56 single frozen CURRENT capture: DIRTY {before['head']}\nselected SHA256 {state['fingerprint']}\nsrc SHA256 {state['srcFingerprint']}\n{len(files)} independent regular files; before/after seal stable;33347b7 root fixture bytes match\n{source}\nExact99=79+8+6+6; separate full Curie root registry file;154 omissions preserve observed baseline cardinality;7 optional controls use baseline+1;1 literal22 contract. No literal56 full-registry workflow gate.\nActual argv, dirtypaths and filehashes: {base.EVIDENCE / 'sealed-input.json'}\n900s bound; no live source refresh after seal; no broader suites.\n"
    (base.EVIDENCE / 'checkpoint.txt').write_text(checkpoint)
    Path('/tmp/safe-bash-registry-final56-checkpoint.txt').write_text(checkpoint)
    print(checkpoint, flush=True)


if __name__ == '__main__':
    {'freeze': freeze, 'run': base.run, 'supplement': lambda: base.run(True)}[sys.argv[1]]()
