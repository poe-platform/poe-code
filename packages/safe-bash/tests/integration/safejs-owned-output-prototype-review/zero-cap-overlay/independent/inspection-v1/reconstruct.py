import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
BASE = 'tests/integration/safejs-owned-output-prototype-review'
AUTHOR = BASE + '/zero-cap-overlay/author'
COMMIT = 'a61e63bc46e8389e59c0d8fdc1d424003f62c769'
PREP_COMMIT = 'ee8bc35906e363566a22e26b8286e5bcac7f1d2f'
HERE = Path(__file__).resolve().parent
PREPARATION = HERE.parent
SOURCE = Path('/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/source-route')
PREPARED = Path('/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK')
NODE = Path('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node')
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPOSITORY), '-c', 'core.fsmonitor=false', *args], env=ENVIRONMENT)


def blob(commit, filename):
    return git('show', commit + ':' + filename)


def regular(filename):
    assert filename.resolve() == filename and filename.is_file() and not filename.is_symlink(), filename
    return filename.read_bytes()


def inventory(root, metadata=False):
    assert root.resolve() == root
    entries = []
    for filename in root.rglob('*'):
        assert not filename.is_symlink()
        if filename.is_dir():
            continue
        data = regular(filename)
        entry = {'path': str(filename.relative_to(root)), 'bytes': len(data), 'sha256': sha(data)}
        if metadata:
            stat = filename.stat()
            entry.update(mode=stat.st_mode & 0o777, mtimeNs=stat.st_mtime_ns, ctimeNs=stat.st_ctime_ns)
        entries.append(entry)
    return sorted(entries, key=lambda entry: entry['path'])


def shape(root):
    return sorted([{'path': str(filename.relative_to(root)), 'kind': 'directory' if filename.is_dir() else 'file'} for filename in root.rglob('*')], key=lambda entry: entry['path'])


def copy_regular(source, target, expected):
    assert inventory(source) == expected
    assert not target.exists()
    for entry in expected:
        destination = target / entry['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as stream:
            stream.write(regular(source / entry['path']))
        destination.chmod(0o644)
    assert inventory(target) == expected


def put(name, value):
    target = HERE / name
    assert not target.exists()
    text = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    assert not text or text.endswith('\n')
    patch = '*** Begin Patch\n*** Add File: ' + str(target) + '\n'
    patch += ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), check=True, cwd=REPOSITORY)
    assert target.read_text() == text


def prepare():
    freeze_bytes = blob(COMMIT, AUTHOR + '/FREEZE.json')
    freeze = json.loads(freeze_bytes)
    entries = freeze['files']
    assert len(entries) == 87 and sha(compact(entries)) == freeze['filesManifestSha256']
    paths = git('ls-tree', '-r', '--name-only', COMMIT, '--', AUTHOR).decode().splitlines()
    assert sorted(paths) == sorted([AUTHOR + '/' + entry['path'] for entry in entries] + [AUTHOR + '/FREEZE.json'])
    scratch = Path(tempfile.mkdtemp(prefix='safe-bash-zero-overlay-independent-inspect-', dir='/private/tmp')).resolve()
    extracted = scratch / 'author-inputs'
    for filename in paths:
        data = blob(COMMIT, filename)
        relative = str(Path(filename).relative_to(AUTHOR))
        if relative != 'FREEZE.json':
            entry = next(entry for entry in entries if entry['path'] == relative)
            assert len(data) == entry['bytes'] and sha(data) == entry['sha256']
        target = extracted / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(0o400)
    references = json.loads((extracted / 'REFERENCES.json').read_text())
    for entry in references:
        assert sha(blob(entry['commit'], entry['path'])) == entry['sha256']
    prep_paths = git('ls-tree', '-r', '--name-only', PREP_COMMIT, '--', str(PREPARATION.relative_to(REPOSITORY))).decode().splitlines()
    for filename in prep_paths:
        assert (REPOSITORY / filename).read_bytes() == blob(PREP_COMMIT, filename)
    expected = json.loads((PREPARATION / 'SOURCE-INVENTORIES.json').read_text())
    parent = json.loads((extracted / 'inventories/parent-all940.json').read_text())
    candidate = json.loads((extracted / 'inventories/candidate-all940.json').read_text())
    package = json.loads((extracted / 'inventories/candidate-package709.json').read_text())
    assembly = json.loads(blob('07a7dae5db51612a23e74d1d164d33723d4d61b6', BASE + '/provenance/assembly.json'))
    assert parent == assembly['candidateFiles']
    assert [entry for entry in parent if entry['path'].startswith('src/')] == expected['parent']['entries']
    assert [entry for entry in candidate if entry['path'].startswith('src/')] == expected['expectedDerived']['entries']
    assert len(candidate) == 940 and sha(compact(candidate)) == 'a7333f1942956f73a0cf7d16a35685f23a81186df18d89e55fe07e5a94b32b4a'
    compiled = [entry for entry in candidate if entry['path'].startswith('dist/')]
    assert len(compiled) == 708 and sha(compact(compiled)) == '65dda12bcf3536eefb49745037b468e7ecbf424626d1d5db137a84e12bd9298e'
    assert len(package) == 709 and sha(compact(package)) == 'e207a231248d81156b6fc7b608785eb7f27cda4d34263dbee088210a19c9d010'
    changed = [after['path'] for before, after in zip(parent, candidate) if before != after]
    assert changed == ['dist/commands/network/shared.d.ts.map', 'dist/commands/network/shared.js', 'dist/commands/network/shared.js.map', 'src/commands/network/shared.ts']
    assert [entry['path'] for entry in parent] == [entry['path'] for entry in candidate]
    for filename in changed:
        decoded = base64.b64decode((extracted / 'candidate-bytes' / (filename + '.base64-data')).read_bytes(), validate=False)
        entry = next(entry for entry in candidate if entry['path'] == filename)
        assert len(decoded) == entry['bytes'] and sha(decoded) == entry['sha256']
        if filename.startswith('src/'):
            assert decoded == blob('bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29', filename)
    report = {'status': 'AUTHOR_GIT_AND_SOURCE_DERIVATION_AUTHENTICATED_NO_EXECUTION', 'at': datetime.now(timezone.utc).isoformat(), 'authorFreezeCommit': COMMIT,
        'authorFreezeSha256': sha(freeze_bytes), 'authorFiles': len(paths), 'references': len(references), 'preparedIndependentFilesUnchanged': len(prep_paths),
        'scratch': str(scratch), 'authorInputCopy': str(extracted), 'authorEntries': inventory(extracted), 'authorFileSetSha256': sha(compact(inventory(extracted))),
        'parentManifestSha256': sha(compact(parent)), 'candidateManifestSha256': sha(compact(candidate)), 'sourceManifestSha256': expected['expectedDerived']['sha256'],
        'compiledManifestSha256': sha(compact(compiled)), 'packageManifestSha256': sha(compact(package)), 'changedPaths': changed, 'unchangedEntries': 936,
        'privateQueries': 0, 'productGuestEngineTransportExecutions': 0, 'noPromotion': True}
    put('AUTHENTICATION.json', report)
    print(json.dumps({key: report[key] for key in ['scratch', 'authorFiles', 'references', 'changedPaths', 'privateQueries']}))


def build():
    authentication = json.loads((HERE / 'AUTHENTICATION.json').read_text())
    scratch = Path(authentication['scratch'])
    extracted = Path(authentication['authorInputCopy'])
    assert inventory(extracted) == authentication['authorEntries']
    parent = json.loads((extracted / 'inventories/parent-all940.json').read_text())
    expected_candidate = json.loads((extracted / 'inventories/candidate-all940.json').read_text())
    expected_package = json.loads((extracted / 'inventories/candidate-package709.json').read_text())
    assembly = json.loads(blob('07a7dae5db51612a23e74d1d164d33723d4d61b6', BASE + '/provenance/assembly.json'))
    shared_roots = [SOURCE, *[PREPARED / 'node_modules' / tool['name'] for tool in assembly['tooling']]]
    before = {str(root): {'entries': inventory(root, True), 'shape': shape(root)} for root in shared_roots}
    put('shared-before.json', before)
    report = {'started': datetime.now(timezone.utc).isoformat(), 'status': 'BUILDING_PUBLIC_ONLY', 'commands': [], 'scratch': str(scratch), 'privateQueries': 0,
        'productImports': 0, 'guestExecutions': 0, 'privateEngineImports': 0, 'transportCalls': 0, 'noPromotion': True}
    try:
        node_before = sha(regular(NODE))
        assert node_before == '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'
        report['nodeBeforeSha256'] = node_before
        candidate = scratch / 'candidate'
        copy_regular(SOURCE, candidate, parent)
        for tool in assembly['tooling']:
            copy_regular(PREPARED / 'node_modules' / tool['name'], scratch / 'node_modules' / tool['name'], tool['files'])
        tool_before = inventory(scratch / 'node_modules', True)
        package = scratch / 'consumer/node_modules/virtual-bash'
        original_source = regular(candidate / 'src/commands/network/shared.ts')
        allow = json.loads((PREPARATION / 'ALLOWLIST.json').read_text())
        assert sha(original_source) == allow['before']['sha256']
        patch = '*** Begin Patch\n*** Update File: ' + str(candidate / 'src/commands/network/shared.ts') + '\n@@\n-' + allow['exactReplacement']['before'] + '\n'
        patch += ''.join('+' + line + '\n' for line in allow['exactReplacement']['after'].splitlines()) + '*** End Patch\n'
        subprocess.run(['apply_patch'], input=patch.encode(), check=True, cwd=REPOSITORY)
        assert sha(regular(candidate / 'src/commands/network/shared.ts')) == allow['after']['sha256']
        shutil.rmtree(candidate / 'dist')
        input_before = inventory(candidate, True)
        for name in ['home', 'tmp']:
            (scratch / name).mkdir()
        environment = {**ENVIRONMENT, 'HOME': str(scratch / 'home'), 'TMPDIR': str(scratch / 'tmp')}
        compiler = scratch / 'node_modules/typescript/bin/tsc'
        for label, arguments, expected_count in [('emit', ['-p', 'tsconfig.build.json', '--listFiles', '--pretty', 'false'], 343), ('noemit', ['-p', 'tsconfig.json', '--noEmit', '--listFiles', '--pretty', 'false'], 358)]:
            command = [str(NODE), str(compiler), *arguments]
            started = datetime.now(timezone.utc).isoformat()
            result = subprocess.run(command, cwd=candidate, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            put('build/' + label + '.stdout.txt', result.stdout.decode())
            put('build/' + label + '.stderr.txt', result.stderr.decode())
            receipt = {'label': label, 'command': command, 'cwd': str(candidate), 'started': started, 'finished': datetime.now(timezone.utc).isoformat(), 'exitCode': result.returncode, 'stdoutSha256': sha(result.stdout), 'stderrSha256': sha(result.stderr)}
            report['commands'].append(receipt)
            assert result.returncode == 0 and not result.stderr
            inputs = []
            for line in result.stdout.decode().splitlines():
                filename = Path(line)
                assert filename.is_absolute() and filename.is_relative_to(scratch), line
                data = regular(filename)
                inputs.append({'path': str(filename.relative_to(scratch)), 'bytes': len(data), 'sha256': sha(data)})
            assert len(inputs) == expected_count
            put('build/' + label + '.inputs.json', inputs)
            receipt['inputCount'] = len(inputs)
        actual = inventory(candidate)
        assert actual == expected_candidate
        unchanged_inputs = [entry for entry in inventory(candidate, True) if not entry['path'].startswith('dist/')]
        assert unchanged_inputs == input_before
        assert inventory(scratch / 'node_modules', True) == tool_before
        for entry in expected_package:
            target = package / entry['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(regular(candidate / entry['path']))
        assert inventory(package) == expected_package
        for entry in authentication['changedPaths']:
            expected = base64.b64decode((extracted / 'candidate-bytes' / (entry + '.base64-data')).read_bytes())
            assert regular(candidate / entry) == expected
        parser_checks = []
        for filename in sorted(extracted.rglob('*.mjs')):
            result = subprocess.run([str(NODE), '--check', str(filename)], cwd=scratch, env=environment, capture_output=True, timeout=20)
            assert result.returncode == 0 and not result.stdout and not result.stderr
            parser_checks.append({'path': str(filename.relative_to(extracted)), 'sha256': sha(regular(filename)), 'exitCode': result.returncode})
        assert len(parser_checks) == 14
        put('PARSER-CHECKS.json', parser_checks)
        put('candidate-inventory.json', actual)
        put('package-inventory.json', inventory(package))
        report.update(status='PUBLIC_RECONSTRUCTION_AND_BUILD_MATCH', candidateRoot=str(candidate), packageRoot=str(package), candidateFiles=len(actual), packageFiles=len(expected_package), candidateManifestSha256=sha(compact(actual)), sourceManifestSha256=sha(compact([entry for entry in actual if entry['path'].startswith('src/')])), compiledManifestSha256=sha(compact([entry for entry in actual if entry['path'].startswith('dist/')])), packageManifestSha256=sha(compact(expected_package)), parserOnlyChecks=len(parser_checks), unchangedNonOutputInputs=True, copiedToolsUnchanged=True)
    except Exception as failure:
        report.update(status='RECONSTRUCTION_OR_BUILD_NONPASS', failure={'type': type(failure).__name__, 'message': str(failure)})
        raise
    finally:
        after = {str(root): {'entries': inventory(root, True), 'shape': shape(root)} for root in shared_roots}
        put('shared-after.json', after)
        report['sharedBeforeAfterEqual'] = before == after
        report['nodeAfterSha256'] = sha(regular(NODE))
        report['finished'] = datetime.now(timezone.utc).isoformat()
        put('BUILD.json', report)
        assert before == after
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    {'prepare': prepare, 'build': build}[sys.argv[1]]()
