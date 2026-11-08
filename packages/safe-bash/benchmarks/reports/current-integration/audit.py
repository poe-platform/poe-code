import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time


ROOT = Path('/Users/kjopek/Workspace/safe-bash')
REPORT = ROOT / 'benchmarks/reports/current-integration'
STATE = REPORT / 'state.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode()


def fingerprint(entries):
    return digest('\n'.join(f'{name}\0{entry["sha256"]}' for name, entry in sorted(entries.items())).encode())


def exclude(name):
    parts = Path(name).parts
    if any(part in {'.git', 'node_modules', 'dist', 'coverage', '.cache'} for part in parts):
        return 'dependency/generated/git tree'
    if name.startswith('benchmarks/reports/'):
        return 'previous reports and this audit output'
    if any(part.startswith(('.native-', '.tmp-', '.fixture-')) for part in parts):
        return 'native temporary fixture accumulation'
    if name.endswith(('.log', '.tap', '.tsbuildinfo')):
        return 'generated log/build output'
    return None


def inventory():
    tracked = set(git('ls-files', '-z').split('\0')) - {''}
    untracked = set(git('ls-files', '--others', '--exclude-standard', '-z').split('\0')) - {''}
    entries, excluded = {}, {}
    for name in sorted(tracked | untracked):
        reason = exclude(name)
        if reason:
            excluded[name] = reason
            continue
        path = ROOT / name
        if not path.exists():
            excluded[name] = 'absent in current worktree'
            continue
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError(f'Nonregular source rejected: {name}')
        if info.st_nlink != 1:
            raise RuntimeError(f'Hardlinked source rejected: {name}')
        for parent in path.parents:
            if parent == ROOT:
                break
            if parent.is_symlink():
                raise RuntimeError(f'Symlinked source ancestor rejected: {name}')
        data = path.read_bytes()
        entries[name] = {'sha256': digest(data), 'bytes': len(data), 'mode': stat.S_IMODE(info.st_mode), 'tracked': name in tracked}
    return entries, excluded


def dependencies(base):
    lockpath = base / 'package-lock.json'
    lock = json.loads(lockpath.read_text())
    hiddenpath = base / 'node_modules/.package-lock.json'
    hidden = json.loads(hiddenpath.read_text())
    manifest = json.loads((base / 'package.json').read_text())
    packages, issues, missing_optional = {}, [], []
    for name, metadata in lock['packages'].items():
        if not name:
            continue
        installed = base / name / 'package.json'
        if not installed.exists():
            (missing_optional if metadata.get('optional') else issues).append(name)
            continue
        actual = json.loads(installed.read_text())
        fields = {key: metadata.get(key) for key in ('version', 'resolved', 'integrity')}
        hidden_metadata = hidden.get('packages', {}).get(name, {})
        packages[name] = {**fields, 'installedVersion': actual.get('version'), 'packageJsonSha256': digest(installed.read_bytes()), 'hiddenLockMatches': all(hidden_metadata.get(key) == value for key, value in fields.items())}
        if actual.get('version') != metadata.get('version') or not packages[name]['hiddenLockMatches']:
            issues.append(name + ': version/hidden-lock mismatch')
        if metadata.get('link'):
            issues.append(name + ': workspace link')
    for name in hidden.get('packages', {}):
        if name not in lock['packages']:
            issues.append(name + ': installed hidden-lock entry absent from lock')
    for field in ('dependencies', 'devDependencies', 'optionalDependencies'):
        if manifest.get(field, {}) != lock['packages'][''].get(field, {}):
            issues.append('root manifest/lock mismatch: ' + field)
    files, links = {}, {}
    tree = base / 'node_modules'
    for current, directories, names in os.walk(tree, followlinks=False):
        for name in directories + names:
            path = Path(current) / name
            relative = str(path.relative_to(tree))
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(tree.resolve()):
                    raise RuntimeError(f'External dependency symlink rejected: {path}')
                links[relative] = os.readlink(path)
            elif path.is_file():
                files[relative] = {'sha256': digest(path.read_bytes()), 'bytes': path.stat().st_size}
    return {'lockSha256': digest(lockpath.read_bytes()), 'hiddenLockSha256': digest(hiddenpath.read_bytes()), 'manifestSha256': digest((base / 'package.json').read_bytes()), 'packages': packages, 'issues': issues, 'missingOptionalPackages': missing_optional, 'files': files, 'internalLinks': links, 'fileFingerprint': fingerprint(files), 'limitations': 'Installed version and hidden-lock integrity metadata match, plus installed file hashes. No registry access, tarball reconstruction, signature or independent tarball-integrity verification; not a pristine npm-ci attestation.'}


def prepare():
    before, exclusions = inventory()
    status = git('status', '--porcelain=v1', '--untracked-files=all')
    revision = git('rev-parse', 'HEAD').strip()
    dependency_records = {name: dependencies(ROOT / relative) for name, relative in [('root', ''), ('benchmark', 'benchmarks')]}
    workspace = Path(tempfile.mkdtemp(prefix='safe-bash-current-integration-', dir='/tmp'))
    snapshot = workspace / 'source'
    snapshot.mkdir()
    for name, metadata in before.items():
        destination = snapshot / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, destination)
        destination.chmod(metadata['mode'])
        if digest(destination.read_bytes()) != metadata['sha256']:
            raise RuntimeError(f'Live source changed during copy: {name}')
        if destination.stat().st_ino == (ROOT / name).stat().st_ino and destination.stat().st_dev == (ROOT / name).stat().st_dev:
            raise RuntimeError(f'Source inode alias: {name}')
    after, _ = inventory()
    if before != after:
        save(REPORT / 'copy-drift.json', {'before': before, 'after': after})
        raise RuntimeError('Live source drifted during snapshot: retry explicitly')
    scripts = json.loads((snapshot / 'package.json').read_text())['scripts']
    state = {'revision': revision, 'dirty': True, 'statusBefore': status, 'workspace': str(workspace), 'snapshot': str(snapshot), 'inputFingerprint': fingerprint(before), 'sourceFingerprint': fingerprint({name: value for name, value in before.items() if name.startswith('src/')}), 'scripts': scripts, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'dependencyMethod': 'Private regular-file copies of installed dependency trees to snapshot node_modules and benchmarks/node_modules, excluded from source inventory; only verified internal dependency links preserved; never link back to live tree.'}
    save(STATE, state)
    save(REPORT / 'inputs.json', {'state': state, 'files': before, 'exclusions': exclusions, 'ignoredExclusions': ['git-ignored files (git ls-files --others --exclude-standard)', 'all dependency trees', 'all generated dist/coverage/cache output', 'all reports copies'], 'selection': 'Every present tracked file and every nonignored relevant untracked file, minus explicit exclusions. Retained checked-in JSON evidence/fixtures may be inputs; no archive investigation.'})
    save(REPORT / 'dependencies.json', dependency_records)
    commands = [('typecheck', 'npm run typecheck', 180), ('build', 'npm run build', 180), ('test', 'npm test', 900), ('contracts', 'npm run test:contracts', 180), ('benchmark-typecheck', 'npm --prefix benchmarks run typecheck', 180), ('comparison', 'npm run benchmark -- --output <owned-reportdir>/comparison.json', 300)]
    save(REPORT / 'phase-order.json', commands)
    checkpoint = '\n'.join([
        'BOUNDED CURRENT-STATE INTEGRATED AUDIT CHECKPOINT',
        f'Created: {state["startedAt"]}', f'HEAD: {revision}; DIRTY CURRENT SNAPSHOT, NOT COMMITTED VALIDATION',
        f'Snapshot: {snapshot}', f'Source SHA256: {state["sourceFingerprint"]}', f'All selected inputs SHA256: {state["inputFingerprint"]}',
        f'Selected {len(before)} regular files ({sum(not value["tracked"] for value in before.values())} relevant untracked); {len(exclusions)} explicitly excluded paths.',
        f'Exact per-file hashes, selection/exclusions: {REPORT / "inputs.json"}',
        'Dirty files at freeze:\n' + status,
        'Relevant untracked selected:\n' + '\n'.join(name for name, value in before.items() if not value['tracked']),
        'Actual complete root package scripts:\n' + json.dumps(scripts, indent=2),
        'Bounded serial phase order:\n' + '\n'.join(f'{name}: {command} (hard timeout {timeout}s)' for name, command, timeout in commands),
        'Dependencies: reuse only privately copied installed locked trees; no installation/network, no workspace links, no source symlinks/hardlinks. Copy excluded from source inventory.',
        '\n'.join(f'{name}: lock={record["lockSha256"]}; installed fingerprint={record["fileFingerprint"]}; {len(record["packages"])} installed locked packages; {len(record["missingOptionalPackages"])} absent optional; issues={record["issues"]}' for name, record in dependency_records.items()),
        'just-bash pinned existing 3.4.2 only; comparison BLOCKED if version/lock/hidden-lock evidence fails. Tarball cryptographic authenticity is NOT re-established from installed files.',
        'Environment rebuilt from allowlist: isolated HOME/TMPDIR/TMP/TEMP/XDG/npm cache, TSX_DISABLE_CACHE=1; SAFEJS_LOCAL_ROOT and all optional oracle override variables unset; no private checkout access.',
        'Full scripts unchanged; TAP stdout/stderr retained. Private process groups with timeout TERM/KILL cleanup; descendant native helper groups tracked, only owned children stopped.',
        'Native system oracles may differ by dialect; conditional-env omissions and every skip/TODO/cancel/failure remain explicit. Comparison only existing harness, no new breadth or superiority claim.',
        'After validation: exact unique test accounting, highest-impact documented gaps and existing crossbackend/pipeline/stdin coverage; live-after hashes separate from frozen source; no archive work.',
    ]) + '\n'
    Path('/tmp/safe-bash-current-integration-checkpoint.txt').write_text(checkpoint)
    (REPORT / 'checkpoint.txt').write_text(checkpoint)
    print(checkpoint)


def copy_dependencies(state):
    snapshot = Path(state['snapshot'])
    expected = json.loads((REPORT / 'dependencies.json').read_text())
    for name, relative in [('root', ''), ('benchmark', 'benchmarks')]:
        if expected[name]['issues']:
            if name == 'benchmark':
                continue
            raise RuntimeError('Root dependency verification failed')
        current = dependencies(ROOT / relative)
        if current != expected[name]:
            raise RuntimeError('Live dependencies drifted before copy: ' + name)
        shutil.copytree(ROOT / relative / 'node_modules', snapshot / relative / 'node_modules', symlinks=True)
        actual = dependencies(snapshot / relative)
        if actual != expected[name]:
            raise RuntimeError('Dependency copy mismatch: ' + name)
    save(REPORT / 'dependency-copy.json', {'completedAt': time.time(), 'method': state['dependencyMethod'], 'verified': True})


def clean_source(state):
    original = Path(state['snapshot'])
    clean = Path(state['workspace']) / 'source-clean'
    clean.mkdir()
    inputs = json.loads((REPORT / 'inputs.json').read_text())
    excluded, files = {}, {}
    for name, metadata in inputs['files'].items():
        if name.endswith(('.stdout', '.stderr', '.out', '.err')):
            excluded[name] = {**metadata, 'reason': 'historical generated output; excluded from final source selection'}
            continue
        path = clean / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original / name, path)
        path.chmod(metadata['mode'])
        if digest(path.read_bytes()) != metadata['sha256'] or path.is_symlink() or path.stat().st_nlink != 1:
            raise RuntimeError('Invalid frozen derivative: ' + name)
        files[name] = metadata
    for relative in ['', 'benchmarks']:
        shutil.copytree(original / relative / 'node_modules', clean / relative / 'node_modules', symlinks=True)
        if dependencies(clean / relative) != dependencies(original / relative):
            raise RuntimeError('Clean dependency copy mismatch: ' + relative)
    clean_state = {**state, 'snapshot': str(clean), 'inputFingerprint': fingerprint(files), 'derivedOnlyFromFrozenSnapshot': str(original)}
    save(REPORT / 'clean-state.json', clean_state)
    save(REPORT / 'clean-inputs.json', {'state': clean_state, 'files': files, 'additionalExclusions': excluded, 'originalExclusions': inputs['exclusions'], 'note': 'Final source selection removes historical output suffixes mistakenly retained in initial snapshot. Product source and every .test.ts/TypeScript input remain identical. Existing JSON fixtures/evidence remain potential test inputs.'})
    for checkpoint in [REPORT / 'checkpoint.txt', Path('/tmp/safe-bash-current-integration-checkpoint.txt')]:
        with checkpoint.open('a') as output:
            output.write(f'\nSOURCE-SELECTION CORRECTION: removed {len(excluded)} historical generated stdout/stderr/out/err copies in a fresh regular-file derivative of the FROZEN inputs, not newer live source. Final snapshot {clean}; {len(files)} files; fingerprint {clean_state["inputFingerprint"]}; product source hash unchanged. Repeat unchanged full root scripts and existing comparator under original bounds; retain earlier evidence separately.\n')
    print(json.dumps({'snapshot': str(clean), 'removed': len(excluded), 'files': len(files), 'fingerprint': clean_state['inputFingerprint']}))


def environment(state):
    workspace = Path(state['workspace'])
    environment = {'PATH': os.path.dirname(shutil.which('node')) + ':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC', 'TSX_DISABLE_CACHE': '1', 'NO_COLOR': '1', 'npm_config_update_notifier': 'false', 'npm_config_audit': 'false', 'npm_config_fund': 'false'}
    if (workspace / 'oracle-bin/rg').is_file():
        environment['PATH'] = str(workspace / 'oracle-bin') + ':' + environment['PATH']
    for name, relative in [('HOME', 'home'), ('TMPDIR', 'tmp'), ('TMP', 'tmp'), ('TEMP', 'tmp'), ('XDG_CACHE_HOME', 'cache'), ('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('npm_config_cache', 'npm-cache')]:
        path = workspace / relative
        path.mkdir(exist_ok=True)
        environment[name] = str(path)
    return environment


def process_table():
    output = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,lstart='], text=True)
    result = {}
    for line in output.splitlines():
        fields = line.split(None, 3)
        if len(fields) == 4:
            result[int(fields[0])] = (int(fields[1]), int(fields[2]), fields[3])
    return result


def run_phase(state, name, args, timeout):
    env = environment(state)
    save(REPORT / 'environment.json', env)
    save(REPORT / f'{name}.environment.json', env)
    started = time.time()
    owned = {}
    timed_out = False
    with (REPORT / f'{name}.stdout.log').open('wb') as stdout, (REPORT / f'{name}.stderr.log').open('wb') as stderr:
        child = subprocess.Popen(args, cwd=state['snapshot'], env=env, stdout=stdout, stderr=stderr, start_new_session=True)
        while child.poll() is None:
            table = process_table()
            descendants = {child.pid}
            while True:
                more = {pid for pid, (parent, _, _) in table.items() if parent in descendants}
                if more <= descendants:
                    break
                descendants |= more
            for pid in descendants:
                if pid in table:
                    owned[pid] = table[pid]
            if time.time() - started >= timeout:
                timed_out = True
                break
            time.sleep(0.2)
        cleanup = []
        for sig in [signal.SIGTERM, signal.SIGKILL]:
            table = process_table()
            groups = {value[1] for pid, value in owned.items() if pid in table and table[pid][2] == value[2] and value[1] != os.getpgrp()}
            if timed_out:
                groups.add(child.pid)
            for group in groups:
                try:
                    os.killpg(group, sig)
                    cleanup.append({'group': group, 'signal': sig.name})
                except ProcessLookupError:
                    pass
            if groups:
                time.sleep(0.4)
        returncode = child.wait(timeout=10)
    result = {'name': name, 'command': args, 'cwd': state['snapshot'], 'startedAt': started, 'durationSeconds': time.time() - started, 'timeoutSeconds': timeout, 'timedOut': timed_out, 'returnCode': returncode, 'signal': -returncode if returncode < 0 else None, 'cleanup': cleanup, 'observedChildCount': len(owned)}
    save(REPORT / f'{name}.result.json', result)
    print(json.dumps(result), flush=True)


def finalize(state):
    inputs = json.loads((REPORT / 'inputs.json').read_text())['files']
    snapshot = Path(state['snapshot'])
    frozen_after = {name: {**metadata, 'sha256': digest((snapshot / name).read_bytes())} for name, metadata in inputs.items()}
    live, exclusions = inventory()
    drift = {name: {'before': inputs.get(name), 'after': live.get(name)} for name in sorted(set(inputs) | set(live)) if inputs.get(name) != live.get(name)}
    save(REPORT / 'after.json', {'frozenFingerprintBefore': state['inputFingerprint'], 'frozenFingerprintAfter': fingerprint(frozen_after), 'frozenChanged': [name for name in inputs if inputs[name] != frozen_after[name]], 'liveRevision': git('rev-parse', 'HEAD').strip(), 'liveStatus': git('status', '--porcelain=v1', '--untracked-files=all'), 'liveFingerprint': fingerprint(live), 'liveDrift': drift, 'liveFiles': live})
    dependency_before = json.loads((REPORT / 'dependencies.json').read_text())
    dependency_after = {name: dependencies(ROOT / relative) for name, relative in [('root', ''), ('benchmark', 'benchmarks')]}
    save(REPORT / 'dependency-after.json', {name: {'liveUnchanged': dependency_after[name] == dependency_before[name], 'liveFileFingerprint': dependency_after[name]['fileFingerprint'], 'snapshotFileFingerprint': dependencies(snapshot / relative)['fileFingerprint']} for name, relative in [('root', ''), ('benchmark', 'benchmarks')]})
    generated = []
    for current, directories, files in os.walk(snapshot):
        directories[:] = [name for name in directories if name != 'node_modules']
        for name in files:
            path = Path(current) / name
            relative = str(path.relative_to(snapshot))
            if relative not in inputs:
                generated.append({'path': relative, 'bytes': path.lstat().st_size, 'symlink': path.is_symlink()})
    save(REPORT / 'generated-inventory.json', generated)
    removed = []
    for current, directories, _ in os.walk(snapshot / 'tests', topdown=True):
        for name in list(directories):
            if name.startswith(('.native-', '.tmp-', '.fixture-')):
                path = Path(current) / name
                removed.append(str(path.relative_to(snapshot)))
                shutil.rmtree(path)
                directories.remove(name)
    save(REPORT / 'fixture-cleanup.json', {'removedSnapshotOnly': removed, 'sourceSnapshotRetained': str(snapshot)})
    print(json.dumps({'frozenChanged': inputs != frozen_after, 'liveDriftCount': len(drift), 'generatedFiles': len(generated), 'cleanedFixtureDirectories': len(removed)}))


def finalize_clean():
    inputs = json.loads((REPORT / 'clean-inputs.json').read_text())
    state = inputs['state']
    snapshot = Path(state['snapshot'])
    files = inputs['files']
    after = {}
    for name, metadata in files.items():
        path = snapshot / name
        if path.is_symlink() or path.stat().st_nlink != 1:
            raise RuntimeError('Final source alias: ' + name)
        after[name] = {**metadata, 'sha256': digest(path.read_bytes())}
    live, _ = inventory()
    live = {name: value for name, value in live.items() if not name.endswith(('.stdout', '.stderr', '.out', '.err'))}
    drift = {name: {'before': files.get(name), 'after': live.get(name)} for name in sorted(set(files) | set(live)) if files.get(name) != live.get(name)}
    dependency_expected = json.loads((REPORT / 'dependencies.json').read_text())
    dependency_results = {}
    for name, relative in [('root', ''), ('benchmark', 'benchmarks')]:
        current = dependencies(ROOT / relative)
        copied = dependencies(snapshot / relative)
        dependency_results[name] = {'liveUnchanged': current == dependency_expected[name], 'copyUnchanged': copied == dependency_expected[name], 'liveFileFingerprint': current['fileFingerprint'], 'copyFileFingerprint': copied['fileFingerprint']}
    generated = []
    for current, directories, names in os.walk(snapshot):
        directories[:] = [name for name in directories if name != 'node_modules']
        for name in names:
            path = Path(current) / name
            relative = str(path.relative_to(snapshot))
            if relative not in files:
                generated.append({'path': relative, 'bytes': path.lstat().st_size})
    cleanup = []
    for child in (Path(state['workspace']) / 'tmp').iterdir():
        cleanup.append(str(child))
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    result = {'capturedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'snapshot': str(snapshot), 'frozenFingerprintBefore': state['inputFingerprint'], 'frozenFingerprintAfter': fingerprint(after), 'frozenChanged': [name for name in files if files[name] != after[name]], 'sourceFingerprint': fingerprint({name: value for name, value in after.items() if name.startswith('src/')}), 'liveRevision': git('rev-parse', 'HEAD').strip(), 'liveStatus': git('status', '--porcelain=v1', '--untracked-files=all'), 'liveFingerprint': fingerprint(live), 'liveDrift': drift, 'dependencies': dependency_results, 'generatedFiles': generated, 'isolatedTmpCleanup': cleanup}
    save(REPORT / 'clean-after.json', result)
    print(json.dumps({key: value for key, value in result.items() if key not in {'liveStatus', 'liveDrift', 'generatedFiles'}}))


if __name__ == '__main__':
    action = sys.argv[1]
    if action == 'prepare':
        prepare()
    else:
        state = json.loads(STATE.read_text())
        if action == 'dependencies':
            copy_dependencies(state)
        elif action == 'run':
            run_phase(state, sys.argv[2], sys.argv[4:], int(sys.argv[3]))
        elif action == 'clean-source':
            clean_source(state)
        elif action == 'run-clean':
            state = json.loads((REPORT / 'clean-state.json').read_text())
            run_phase(state, sys.argv[2], sys.argv[4:], int(sys.argv[3]))
        elif action == 'finalize':
            finalize(state)
        elif action == 'finalize-clean':
            finalize_clean()
