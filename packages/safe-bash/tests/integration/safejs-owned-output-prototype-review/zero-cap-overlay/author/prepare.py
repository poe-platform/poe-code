import difflib
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import sys


REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
OWNED = Path(__file__).resolve().parent
AUDIT = 'tests/integration/safejs-owned-output-prototype-review'
ACCEPTED = 'bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29'
REVIEW = '32debb6a'
ASSEMBLY = '07a7dae5db51612a23e74d1d164d33723d4d61b6'
CORRECTION = 'db139ae983ad66364e0367f9fb1ed0262ee61f63'
PARENT = '6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea'
SOURCE = Path('/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/source-route')
PACKAGED = SOURCE.parent / 'packaged-route'
PREPARED = Path('/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK')
NODE = Path('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node')
NETWORK = 'src/commands/network/shared.ts'
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'TZ': 'UTC', 'GIT_OPTIONAL_LOCKS': '0'}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPOSITORY), *args], env=ENVIRONMENT)


def blob(commit, path):
    return git('show', f'{commit}:{path}')


def regular(path):
    assert path.resolve() == path and path.is_file() and not path.is_symlink(), path
    return path.read_bytes()


def inventory(root):
    records = []
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink(), path
        if path.is_dir():
            continue
        data = regular(path)
        records.append({'path': path.relative_to(root).as_posix(), 'bytes': len(data), 'sha256': sha(data)})
    return sorted(records, key=lambda entry: entry['path'])


def put(path, value):
    text = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False) + '\n'
    if path.exists():
        assert path.read_text() == text, path
        return
    patch = f'*** Begin Patch\n*** Add File: {path}\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), check=True, stdout=subprocess.DEVNULL)
    assert path.read_text() == text, path


def copied(source, target, expected):
    assert inventory(source) == expected
    for entry in expected:
        destination = target / entry['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as stream:
            stream.write(regular(source / entry['path']))
    assert inventory(target) == expected


def delta(before, after):
    assert [entry['path'] for entry in before] == [entry['path'] for entry in after]
    return [{'path': first['path'], 'before': first, 'after': second} for first, second in zip(before, after) if first != second]


def main():
    assert Path.cwd() == REPOSITORY
    assert not (OWNED / 'CANDIDATE.json').exists(), 'One static author preparation only; preserve prior artifacts'
    bindings = []
    for commit, path in [
        (ASSEMBLY, f'{AUDIT}/receipt-review/attempts/r2/proof.json'),
        (ASSEMBLY, f'{AUDIT}/receipt-review/verification.json'),
        (CORRECTION, f'{AUDIT}/receipt-review/SEAL.json'),
        (CORRECTION, f'{AUDIT}/receipt-review/REPORT.md'),
        ('f666ad8c76ea4362b093ee52e3e7e3b5c3702916', f'{AUDIT}/provenance/assembly.json'),
    ]:
        value = blob(commit, path)
        assert regular(REPOSITORY / path) == value
        bindings.append({'commit': commit, 'path': path, 'blob': git('rev-parse', f'{commit}:{path}').decode().strip(), 'sha256': sha(value)})
    assembly = json.loads(blob('f666ad8c76ea4362b093ee52e3e7e3b5c3702916', f'{AUDIT}/provenance/assembly.json'))
    proof = json.loads(blob(ASSEMBLY, f'{AUDIT}/receipt-review/attempts/r2/proof.json'))
    verification = json.loads(blob(ASSEMBLY, f'{AUDIT}/receipt-review/verification.json'))
    assert proof['status'] == 'QUALIFIED_ACCEPT_ASSEMBLY_ONLY'
    assert verification['independentResultAssertions'] == 'PASS'
    before = inventory(SOURCE)
    assert before == inventory(PACKAGED) == assembly['candidateFiles']
    assert len(before) == 940
    sources = [entry for entry in before if entry['path'].startswith('src/')]
    compiled = [entry for entry in before if entry['path'].startswith('dist/')]
    assert len(sources) == 213 and len(compiled) == 708 and sha(encoded(sources)) == PARENT
    accepted_parent = git('rev-parse', ACCEPTED + '^').decode().strip()
    accepted_before = blob(accepted_parent, NETWORK)
    accepted_after = blob(ACCEPTED, NETWORK)
    original = regular(SOURCE / NETWORK)
    assert original == accepted_before, 'STOP: accepted preimage differs from frozen S1; no context reinterpretation'
    old = '    if (!Number.isSafeInteger(value) || value < 1 || (name === "maxTimeMs" && value > 2_147_483_647)) {'
    new = '    const minimum = name === "maxRedirects" || name === "maxRetries" ? 0 : 1;\n    if (!Number.isSafeInteger(value) || value < minimum || (name === "maxTimeMs" && value > 2_147_483_647)) {'
    assert original.decode().count(old) == 1
    derived = original.decode().replace(old, new).encode()
    assert derived == accepted_after
    accepted_diff = git('show', '--format=fuller', '--no-ext-diff', ACCEPTED).decode()
    minimal_diff = ''.join(difflib.unified_diff(original.decode().splitlines(True), derived.decode().splitlines(True), 'a/' + NETWORK, 'b/' + NETWORK))
    put(OWNED / 'accepted/commit.patch-data', accepted_diff)
    put(OWNED / 'overlay/zero-validation.patch-data', minimal_diff)
    put(OWNED / 'overlay/shared.before.ts.data', original.decode())
    put(OWNED / 'overlay/shared.after.ts.data', derived.decode())
    for filename in [NETWORK, 'src/commands/network/types.ts', 'src/commands/network/README.md', 'tests/commands/network/zero-caps.test.ts']:
        value = blob(ACCEPTED, filename)
        put(OWNED / 'accepted' / (filename.replace('/', '__') + '.data'), value.decode())
        bindings.append({'commit': ACCEPTED, 'path': filename, 'blob': git('rev-parse', f'{ACCEPTED}:{filename}').decode().strip(), 'sha256': sha(value)})
    review_commit = git('rev-parse', REVIEW).decode().strip()
    for filename in ['README.md', 'current-checks.json']:
        path = f'tests/commands/network-zero-caps-review/{filename}'
        value = blob(review_commit, path)
        put(OWNED / 'accepted' / ('independent-' + filename + '.data'), value.decode())
        bindings.append({'commit': review_commit, 'path': path, 'blob': git('rev-parse', f'{review_commit}:{path}').decode().strip(), 'sha256': sha(value)})
    assert sha(regular(NODE)) == verification['node']['sha256']
    resume = len(sys.argv) == 3 and sys.argv[1] == '--resume-built'
    assert len(sys.argv) == 1 or resume
    temporary = Path(sys.argv[2]) if resume else Path(tempfile.mkdtemp(prefix='safe-bash-zero-overlay-author-', dir='/private/tmp'))
    assert temporary.parent == Path('/private/tmp') and temporary.name.startswith('safe-bash-zero-overlay-author-')
    candidate = temporary / 'candidate'
    if not resume:
        copied(SOURCE, candidate, before)
    for tool in assembly['tooling']:
        if resume:
            assert inventory(temporary / 'node_modules' / tool['name']) == tool['files']
        else:
            copied(PREPARED / 'node_modules' / tool['name'], temporary / 'node_modules' / tool['name'], tool['files'])
    assert json.loads(regular(temporary / 'node_modules/typescript/package.json'))['version'] == '5.9.3'
    for name in ['home', 'tmp']:
        (temporary / name).mkdir(exist_ok=resume)
    edit = f'*** Begin Patch\n*** Update File: {candidate / NETWORK}\n@@\n-{old}\n+' + new.replace('\n', '\n+') + '\n*** End Patch\n'
    if not resume:
        subprocess.run(['apply_patch'], input=edit.encode(), check=True)
    assert regular(candidate / NETWORK) == derived
    if not resume:
        assert [entry['path'] for entry in delta(before, inventory(candidate))] == [NETWORK]
    environment = {**ENVIRONMENT, 'HOME': str(temporary / 'home'), 'TMPDIR': str(temporary / 'tmp')}
    arguments = [str(NODE), str(temporary / 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--listFiles', '--listEmittedFiles']
    if resume:
        build = subprocess.CompletedProcess(arguments, 0, regular(OWNED / 'build' / temporary.name / 'stdout.txt'), regular(OWNED / 'build' / temporary.name / 'stderr.txt'))
    else:
        build = subprocess.run(arguments, cwd=candidate, env=environment, capture_output=True, timeout=60)
    put(OWNED / 'build' / temporary.name / 'stdout.txt', build.stdout.decode())
    put(OWNED / 'build' / temporary.name / 'stderr.txt', build.stderr.decode())
    assert build.returncode == 0, build.stderr + build.stdout
    typecheck_arguments = [str(NODE), str(temporary / 'node_modules/typescript/bin/tsc'), '--noEmit', '--listFiles', '-p', 'tsconfig.json']
    typecheck = subprocess.run(typecheck_arguments, cwd=candidate, env=environment, capture_output=True, timeout=120)
    put(OWNED / 'build' / temporary.name / 'typecheck-stdout.txt', typecheck.stdout.decode())
    put(OWNED / 'build' / temporary.name / 'typecheck-stderr.txt', typecheck.stderr.decode())
    assert typecheck.returncode == 0, typecheck.stderr + typecheck.stdout
    compiler_inputs = []
    emitted = [Path(line[8:]).relative_to(candidate).as_posix() for line in build.stdout.decode().splitlines() if line.startswith('TSFILE: ')]
    for line in typecheck.stdout.decode().splitlines():
        path = Path(line)
        assert path.is_absolute()
        if path.is_relative_to(candidate):
            logical = path.relative_to(candidate).as_posix()
        else:
            assert path.is_relative_to(temporary / 'node_modules'), 'No ambient compiler input'
            logical = path.relative_to(temporary).as_posix()
        data = regular(path)
        compiler_inputs.append({'path': logical, 'bytes': len(data), 'sha256': sha(data)})
    assert len(compiler_inputs) == 358 and len(emitted) == 708
    old_inputs = {entry['normalizedPath'].removeprefix(str(REPOSITORY) + '/').removeprefix('CANDIDATE/'): entry['sha256'] for entry in proof['build']['compilerInputs']}
    assert set(old_inputs) == {entry['path'] for entry in compiler_inputs}
    input_delta = [entry['path'] for entry in compiler_inputs if old_inputs[entry['path']] != entry['sha256']]
    assert input_delta == [NETWORK]
    after = inventory(candidate)
    changed = delta(before, after)
    assert len(after) == 940
    assert all(entry['path'] == NETWORK or entry['path'].startswith('dist/commands/network/shared.') for entry in changed)
    after_sources = [entry for entry in after if entry['path'].startswith('src/')]
    after_compiled = [entry for entry in after if entry['path'].startswith('dist/')]
    assert set(emitted) == {entry['path'] for entry in after_compiled}
    package = [entry for entry in after if entry['path'] == 'package.json' or entry['path'].startswith('dist/')]
    consumer = temporary / 'consumer/node_modules/virtual-bash'
    for entry in package:
        target = consumer / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        if resume:
            assert regular(target) == regular(candidate / entry['path'])
        else:
            with target.open('xb') as stream:
                stream.write(regular(candidate / entry['path']))
    assert inventory(consumer) == package
    assert inventory(SOURCE) == inventory(PACKAGED) == before
    for tool in assembly['tooling']:
        assert inventory(temporary / 'node_modules' / tool['name']) == tool['files']
    for name, records in [('parent-all940', before), ('candidate-all940', after), ('parent-source213', sources), ('candidate-source213', after_sources), ('parent-compiled708', compiled), ('candidate-compiled708', after_compiled), ('candidate-package709', package), ('compiler-inputs358', compiler_inputs)]:
        put(OWNED / 'inventories' / (name + '.json'), records)
    for entry in changed:
        path = entry['path']
        put(OWNED / 'candidate-bytes' / (path + '.base64-data'), base64.b64encode(regular(candidate / path)).decode() + '\n')
    receipt = {
        'status': 'AUTHOR_STATIC_CANDIDATE_NOT_REVIEWED_NOT_RELEASED', 'noPromotion': True,
        'acceptedCommit': ACCEPTED, 'acceptedParent': accepted_parent, 'acceptedIndependentReview': review_commit,
        'parentSourceManifestSha256': PARENT, 'parentCompiledManifestSha256': sha(encoded(compiled)),
        'sourceManifestSha256': sha(encoded(after_sources)), 'compiledManifestSha256': sha(encoded(after_compiled)),
        'candidateManifestSha256': sha(encoded(after)), 'packageManifestSha256': sha(encoded(package)),
        'parentManifestSha256': sha(encoded(before)), 'sourceCount': 213, 'compiledCount': 708, 'packageCount': 709, 'candidateCount': 940,
        'sourceWriteSet': [NETWORK], 'changes': changed, 'unchangedEntries': len(after) - len(changed),
        'candidateRoot': str(candidate), 'packageRoot': str(consumer), 'temporaryRoot': str(temporary),
        'node': verification['node'], 'tools': assembly['tooling'],
        'build': {'argv': arguments, 'cwd': str(candidate), 'environment': environment, 'exitCode': build.returncode, 'buildInputCount': 343, 'compilerInputs': 358, 'emittedOutputs': 708, 'compilerInputDelta': input_delta, 'typecheckArgv': typecheck_arguments, 'typecheckExitCode': typecheck.returncode},
        'bindings': bindings,
        'execution': {'publicTypeScriptBuilds': 1, 'product': 0, 'guest': 0, 'privateEngine': 0, 'privateQueries': 0, 'transport': 0, 'nativeCurl': 0, 'installs': 0},
        'reconstruction': 'Authenticate parent-all940 against source-route or packaged-route; regular-copy all940, authenticate overlay preimage, apply only zero-validation.patch-data, build with pinned copied tools, compare all940 against candidate-all940. candidate-bytes holds all changed public bytes; no private code.',
        'limits': 'Only maxRedirects/maxRetries validation gains minimum zero; all defaults, clamping, other positive limits, source/tests/config/package metadata unchanged. No live source fallback.',
    }
    put(OWNED / 'CANDIDATE.json', receipt)
    print(json.dumps({key: receipt[key] for key in ['candidateRoot', 'sourceManifestSha256', 'compiledManifestSha256', 'sourceWriteSet', 'unchangedEntries']}))


if __name__ == '__main__':
    main()
