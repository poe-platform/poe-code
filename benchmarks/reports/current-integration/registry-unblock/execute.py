import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path('/Users/kjopek/Workspace/safe-bash')
REPORT = ROOT / 'benchmarks/reports/current-integration/registry-unblock'
EVIDENCE = REPORT / 'execution'
OLD = Path('/tmp/safe-bash-current-integration-69dbdy0m/source-clean')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def live_state():
    return {'head': git('rev-parse', 'HEAD').decode().strip(),
            'status': git('status', '--porcelain=v1', '--untracked-files=all').decode(),
            'staged': git('diff', '--cached', '--name-only').decode()}


def inventory():
    tracked = set(git('ls-files', '-z').decode().split('\0')) - {''}
    untracked = set(git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')) - {''}
    selected, excluded = {}, {}
    for name in sorted(tracked | untracked):
        path = Path(name)
        reason = None
        if any(part in {'node_modules', '.git', 'dist', 'reports', 'evidence', 'coverage'} for part in path.parts):
            reason = 'dependency/git/generated/evidence/report tree'
        elif any(part.startswith(('.native-', '.real-', '.verify-', '.tmp-')) for part in path.parts):
            reason = 'temporary fixture debris'
        elif name.endswith(('.log', '.tap', '.stdout', '.stderr', '.tsbuildinfo', '.snapshot.mjs')):
            reason = 'generated output or unexecuted snapshot alias runner'
        if reason:
            excluded[name] = reason
            continue
        source = ROOT / name
        if not source.exists():
            excluded[name] = 'deleted current path'
            continue
        for ancestor in [source, *source.parents]:
            if ancestor == ROOT:
                break
            if ancestor.is_symlink():
                raise RuntimeError(f'source symlink rejected: {source}')
        details = source.stat()
        if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
            raise RuntimeError(f'nonregular/hardlinked source rejected: {source}')
        selected[name] = {'sha256': digest(source), 'bytes': details.st_size, 'tracked': name in tracked}
    return selected, excluded


def fingerprint(files):
    return hashlib.sha256(''.join(f'{name}\0{entry["sha256"]}\n' for name, entry in sorted(files.items())).encode()).hexdigest()


def copy_source(files, destination):
    for name, entry in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
        if target.is_symlink() or target.stat().st_nlink != 1 or digest(target) != entry['sha256']:
            raise RuntimeError(f'copy mismatch: {name}')


def verify_source(files, source):
    changed = [name for name, entry in files.items() if not (source / name).is_file() or
               (source / name).is_symlink() or (source / name).stat().st_nlink != 1 or
               digest(source / name) != entry['sha256']]
    return {'changed': changed, 'same': not changed, 'fingerprint': fingerprint(files)}


def reuse_dependencies(source):
    accepted = json.loads((REPORT.parent / 'dependencies.json').read_text())['root']
    assert digest(source / 'package-lock.json') == accepted['lockSha256']
    assert digest(source / 'package.json') == accepted['manifestSha256']
    lock = json.loads((source / 'package-lock.json').read_text())
    hidden = json.loads((OLD / 'node_modules/.package-lock.json').read_text())
    for name, entry in accepted['files'].items():
        origin = OLD / 'node_modules' / name
        assert not origin.is_symlink() and origin.stat().st_nlink == 1
        assert digest(origin) == entry['sha256'], name
        target = source / 'node_modules' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, target)
        assert target.stat().st_nlink == 1 and digest(target) == entry['sha256']
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
    return {'method': 'regular private copies of previously frozen installed root dependencies; private relative .bin links only',
            'lockSha256': accepted['lockSha256'], 'files': len(accepted['files']),
            'packages': accepted['packages'], 'links': accepted['internalLinks'],
            'limitations': ['Installed bytes match accepted hashes and installed metadata matches pinned lock; npm tarball integrity not independently re-extracted.',
                            'Platform-inapplicable optional packages absent as previously recorded.',
                            'No comparator dependency used or comparison performed; pinned just-bash historical baseline unchanged.']}


def freeze():
    EVIDENCE.mkdir(exist_ok=False)
    started = time.time()
    workspace = Path(tempfile.mkdtemp(prefix='safe-bash-registry-unblock-'))
    before = live_state()
    files, exclusions = inventory()
    source = workspace / 'source'
    copy_source(files, source)
    after_files, after_exclusions = inventory()
    after = live_state()
    assert files == after_files and exclusions == after_exclusions and before == after, 'moving capture; STOP'
    handoffs = {}
    for commit, names in {
        '98498c1': ['tests/integration/adapter-tools/fixtures.ts', 'tests/integration/adapter-tools/preflight-review/preflight.ts', 'tests/integration/adapter-tools/preflight-review/preflight.test.ts'],
        '7d0fe7b': ['tests/plugins/agent-commands.test.ts', 'tests/commands/metadata/integration.test.ts'],
    }.items():
        git('merge-base', '--is-ancestor', commit, before['head'])
        for name in names:
            committed = hashlib.sha256(git('show', f'{commit}:{name}')).hexdigest()
            assert files[name]['sha256'] == committed, name
            handoffs[name] = {'commit': git('rev-parse', commit).decode().strip(), 'sha256': committed, 'matches': True}
    historical = json.loads((REPORT / 'historical-99.json').read_text())
    for cohort in historical['cohorts']:
        assert files[cohort['file']]['sha256'] == cohort['sourceSha256'], cohort['file']
    dependencies = reuse_dependencies(source)
    for name in ['expected-default-commands.json', 'independent-mutations.test.mjs']:
        target = workspace / 'aux' / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(REPORT / name, target)
    commands = json.loads((REPORT / 'proposed-commands.json').read_text())
    phases = commands['baselineCohorts']
    probe = commands['baselineRegistryProbe']
    probe['argv'][-1] = str(workspace / 'aux/expected-default-commands.json')
    phases.append(probe)
    phases.append({'phase': 'registry-author2', 'timeoutSeconds': 40, 'argv': ['node', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern=^(?:aggregate definitions are exactly the seven delivered families, each registered once|metadata root API preflights collisions and excludes optional network/runtime plugins)$', 'tests/plugins/agent-commands.test.ts', 'tests/commands/metadata/integration.test.ts']})
    phases.append({'phase': 'preflight-author30', 'timeoutSeconds': 60, 'argv': ['node', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/integration/adapter-tools/preflight-review/preflight.test.ts']})
    phases.append({'phase': 'independent162', 'timeoutSeconds': 240, 'mutation': True, 'argv': ['node', '--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', 'audit/independent-mutations.test.mjs']})
    state = {'startedEpoch': started, 'deadlineEpoch': started + 900, 'workspace': str(workspace), 'source': str(source),
             'liveBefore': before, 'liveAfterSeal': after, 'files': files, 'exclusions': exclusions,
             'fingerprint': fingerprint(files), 'srcFingerprint': fingerprint({key: value for key, value in files.items() if key.startswith('src/')}),
             'dirtySource': bool(before['status']), 'handoffs': handoffs, 'dependencies': dependencies,
             'historicalTestFilesUnchanged': True, 'phases': phases,
             'scripts': json.loads((source / 'package.json').read_text())['scripts']}
    save(EVIDENCE / 'sealed-input.json', state)
    checkpoint = f"FROZEN DIRTY current source, not committed-source validation\nHEAD {before['head']}\nselected SHA256 {state['fingerprint']}\nsrc SHA256 {state['srcFingerprint']}\n{len(files)} regular independent files; before/after sealing identical\n{source}\nHandoffs 98498c1 and 7d0fe7b accepted bytes match. Historical four test files unchanged.\nExact 79+8+6+6=99; separate literal52, author2, author30, independent154 missing +7 optional workflow +1 literal-list controls.\nFull argv and dirty paths: {EVIDENCE / 'sealed-input.json'}\nNo full suite/comparator; 900s overall bound; no staging/commit.\n"
    (EVIDENCE / 'checkpoint.txt').write_text(checkpoint)
    Path('/tmp/safe-bash-registry-unblock-checkpoint.txt').write_text(checkpoint)
    print(checkpoint, flush=True)


def run(supplement=False):
    state = json.loads((EVIDENCE / 'sealed-input.json').read_text())
    source = Path(state['source'])
    workspace = Path(state['workspace'])
    results = []
    prefix = 'supplement-' if supplement else ''
    assert not (EVIDENCE / f'{prefix}phase-results.json').exists(), 'refuse to overwrite historical phase captures'
    phases = state['phases']
    if supplement:
        (source / 'audit').mkdir(exist_ok=True)
        shutil.copyfile(REPORT / 'scoped-tsconfig.json', source / 'audit/scoped-tsconfig.json')
        phases = [
            {'phase': 'scoped-typecheck', 'timeoutSeconds': 90, 'argv': ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'audit/scoped-tsconfig.json']},
            {'phase': 'root-build', 'timeoutSeconds': 90, 'argv': ['npm', 'run', 'build']},
        ]
        save(EVIDENCE / 'supplement-input.json', {'phases': phases, 'configSha256': digest(source / 'audit/scoped-tsconfig.json'), 'capturedEpoch': time.time()})
    for phase in phases:
        remaining = state['deadlineEpoch'] - time.time()
        if remaining < 5:
            results.append({'phase': phase['phase'], 'notRun': 'overall deadline'})
            continue
        cwd = source
        if phase.get('mutation'):
            cwd = workspace / 'mutation-source'
            for name in state['files']:
                target = cwd / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source / name, target)
            reuse_dependencies(cwd)
            (cwd / 'audit').mkdir()
            for name in ['independent-mutations.test.mjs', 'expected-default-commands.json']:
                shutil.copyfile(workspace / 'aux' / name, cwd / 'audit' / name)
        isolated = workspace / 'environment' / phase['phase']
        env = {'PATH': f'{Path(shutil.which("node")).parent}:/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TZ': 'UTC', 'CI': '1'}
        for key in ['HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'npm_config_cache']:
            location = isolated / key
            location.mkdir(parents=True)
            env[key] = str(location)
        env['XDG_RUNTIME_DIR'] = str(isolated / 'runtime')
        Path(env['XDG_RUNTIME_DIR']).mkdir(mode=0o700)
        capture = {'phase': phase['phase'], 'capturedEpoch': time.time(), 'provenance': 'CONTEMPORANEOUS immediately before spawn', 'env': env, 'cwd': str(cwd), 'argv': phase['argv']}
        save(EVIDENCE / f'{phase["phase"]}.environment.json', capture)
        start = time.monotonic()
        timed_out = False
        with (EVIDENCE / f'{phase["phase"]}.stdout').open('wb') as stdout, (EVIDENCE / f'{phase["phase"]}.stderr').open('wb') as stderr:
            child = subprocess.Popen(phase['argv'], cwd=cwd, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                child.wait(timeout=min(phase['timeoutSeconds'], max(1, state['deadlineEpoch'] - time.time())))
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=3)
            finally:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                    remaining_group = True
                except ProcessLookupError:
                    remaining_group = False
        result = {'phase': phase['phase'], 'exit': child.returncode, 'signal': -child.returncode if child.returncode < 0 else None,
                  'timeout': timed_out, 'seconds': round(time.monotonic() - start, 3), 'pid': child.pid,
                  'remainingProcessGroupKilled': remaining_group}
        results.append(result)
        save(EVIDENCE / f'{prefix}phase-results.json', results)
        print(json.dumps(result), flush=True)
    final_files, final_exclusions = inventory()
    fixture_debris = []
    for tree in [source, workspace / 'mutation-source']:
        if not tree.exists():
            continue
        for path in tree.rglob('.real-*'):
            fixture_debris.append(str(path))
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
    final = {'baseline': verify_source(state['files'], source),
             'mutation': verify_source(state['files'], workspace / 'mutation-source'),
             'liveAfter': live_state(), 'liveSelectedFingerprintAfter': fingerprint(final_files),
             'liveSelectedDrift': sorted(name for name in set(final_files) | set(state['files']) if final_files.get(name) != state['files'].get(name)),
             'fixtureDebrisCleaned': fixture_debris, 'elapsedSeconds': time.time() - state['startedEpoch']}
    save(EVIDENCE / f'{prefix}after.json', final)
    assert final['baseline']['same'] and final['mutation']['same']


if __name__ == '__main__':
    {'freeze': freeze, 'run': run, 'supplement': lambda: run(True)}[sys.argv[1]]()
