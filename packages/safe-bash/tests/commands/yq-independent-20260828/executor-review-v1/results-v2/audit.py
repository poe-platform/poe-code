import hashlib
import io
import json
import os
import pathlib
import selectors
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import zlib

REPO = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN = REPO / 'tests/commands/yq-independent-20260828/executor-review-v1/results-v2'
PREFIX = 'tests/commands/yq-independent-20260828/executor-preparation-v1/'
PACKET = 'tests/commands/yq-independent-20260828/candidate-35da1854-v1/'
V1 = '409449136ae1adc252ff6e205a6bb5785d113d0f'
V2 = '90c4c50070334a34c1b75d78f7da25d302f6bb61'
DATA = '71a16afd5b430175180fc4741531b75c31b25882'
BASE = '5137a74ec855a32d8a8860eb66b62eb44d11e290'
LENGTH = '74361026502d76b8c2b696f9c60e410ac9b78d95'
NEW = '35da18547ca82a67be9ca22b4adc21e3b8060780'
V1_SEAL = '24e28a529cec877b82835d81ba3f274702a28d43ab5285754b7bd1ef0b82f98d'
V2_SEAL = '69dfaf2aa833590312d80515a62d1dcc544952e55f9844aea73a3a8c2d90330b'
SOURCE_MAP = 'e01d63d8e782cba59597da7c970cbd364a35582e4956ab04759064c756df1284'
NODE = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'
ENV = {**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}


def sha(raw): return hashlib.sha256(raw).hexdigest()
def canonical(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
def git(*args): return subprocess.check_output(['git', '-C', str(REPO), *args], timeout=5, env=ENV)
def blob(commit, path): return git('show', commit + ':' + path)
def parsed(commit, path): return json.loads(blob(commit, path))


def write(path, raw, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as output: output.write(raw)
    path.chmod(mode)


def save(path, value): write(path, (json.dumps(value, indent=2) + '\n').encode())


preseal = sys.argv[1]
for name in ['PRESEAL.md', 'audit.py', 'check.mjs']:
    assert blob(preseal, str((OWN / name).relative_to(REPO))) == (OWN / name).read_bytes()
scratch = pathlib.Path(tempfile.mkdtemp(prefix='yq-composition-independent-', dir='/private/tmp')).resolve()
output = pathlib.Path(tempfile.mkdtemp(prefix='capture-', dir=OWN)).resolve()
repo_copy = scratch / 'object-reader'
repo_copy.mkdir()
write(repo_copy / '.git', ('gitdir: ' + git('rev-parse', '--absolute-git-dir').decode().strip() + '\n').encode())
authenticated = []


def copy(commit, path, destination, expected=None, mode=0o644):
    listing = git('ls-tree', commit, '--', path).decode().strip().split()
    assert listing[0] == '100644' and listing[1] == 'blob' and listing[3] == path
    raw = blob(commit, path)
    assert expected is None or sha(raw) == expected, path
    write(destination, raw, mode)
    authenticated.append({'commit': commit, 'path': path, 'blob': listing[2], 'mode': mode, 'bytes': len(raw), 'sha256': sha(raw), 'copy': str(destination)})
    return raw


def recipe(commit, name, expected):
    prefix = PREFIX + name + '/'
    home = repo_copy / prefix
    seal = json.loads(copy(commit, prefix + 'RECIPE-SEAL.json', home / 'RECIPE-SEAL.json', expected))
    home.chmod(seal['rootMode'])
    expected_files = {'RECIPE-SEAL.json'}
    for path, entry in seal['entries'].items():
        destination = home / path
        if entry['type'] == 'directory':
            destination.mkdir(parents=True, exist_ok=True)
            destination.chmod(entry['mode'])
        else:
            expected_files.add(path)
            copy(commit, prefix + path, destination, entry['sha256'], entry['mode'])
    actual_files = {path[len(prefix):] for path in git('ls-tree', '-r', '--name-only', commit, '--', prefix).decode().splitlines()}
    assert actual_files == expected_files
    return home, seal


v1, seal1 = recipe(V1, 'consumers', V1_SEAL)
v2, seal2 = recipe(V2, 'consumers-v2', V2_SEAL)
packet = scratch / 'packet'
packet_seal = json.loads(copy(DATA, PACKET + 'FINAL-SEAL.json', packet / 'FINAL-SEAL.json', '979cacf27eae6d3fc46980d35df17f8135274a4441f1d08d1f2768907b4cced3'))
for name, identity in packet_seal['files'].items(): copy(DATA, PACKET + name, packet / name, identity['sha256'], identity['mode'])
assert {path[len(PACKET):] for path in git('ls-tree', '-r', '--name-only', DATA, '--', PACKET).decode().splitlines()} == set(packet_seal['files']) | {'FINAL-SEAL.json'}
expected_hashes = json.loads((packet / 'EXPECTED-HASHES.json').read_bytes())
for binding in expected_hashes.values():
    if isinstance(binding, dict) and 'path' in binding:
        assert sha((packet / pathlib.Path(binding['path']).name).read_bytes()) == binding['sha256']
for name in ['SOURCE-AUTHORITY.json', 'SOURCE-RECEIPT.json', 'CONTROLS.json']:
    assert (v2 / name).read_bytes() == blob('61cec1d71bf1121234de8ee727da990ff29c54e8', PREFIX + 'consumers-v2/' + name)

authority = json.loads((v2 / 'SOURCE-AUTHORITY.json').read_bytes())
assert [authority['baseline'], authority['acceptedLength'], authority['candidateCommit'], authority['evidenceCommit']] == [BASE, LENGTH, NEW, 'ef6032b210feb5cf19e6f6f94c40413740bef335']
manifest_bytes = blob(authority['evidenceCommit'], authority['manifest']['path'])
assert sha(manifest_bytes) == authority['manifest']['sha256']
manifest = json.loads(manifest_bytes)
new_sources = [row for row in manifest['files'] if row['path'].startswith('src/commands/yq/') or row['path'] == 'src/commands/structured/query-core.ts']
assert new_sources == authority['newSources'] and len(new_sources) == 7
assert [manifest['baseline'], manifest['acceptedLength'], manifest['sourceCommit']] == [BASE, LENGTH, NEW]
baseline = json.loads((v1 / 'SOURCE-BASE.json').read_bytes())
selected_paths = git('ls-tree', '-r', '--name-only', BASE, '--', 'src', 'package.json', 'README.md', 'tsconfig.json', 'tsconfig.build.json').decode().splitlines()
assert set(selected_paths) == set(baseline) and len(baseline) == 264
source_files = {}
origins = []


def git_descriptor(commit, path):
    row = git('ls-tree', commit, '--', path).decode().strip().split()
    assert row[0] == '100644' and row[1] == 'blob' and row[3] == path
    raw = git('cat-file', 'blob', row[2])
    descriptor = {'sha256': sha(raw), 'bytes': len(raw), 'mode': 420}
    origins.append({'path': path, 'revision': commit, 'blob': row[2], **descriptor})
    return descriptor, row[2]


for path in selected_paths:
    origin = LENGTH if path == authority['interpreter']['path'] else BASE
    descriptor, object_id = git_descriptor(origin, path)
    assert baseline[path]['revision'] == origin and baseline[path]['blob'] == object_id
    assert descriptor == {key: baseline[path][key] for key in ['sha256', 'bytes', 'mode']}
    source_files[path] = descriptor
for entry in new_sources:
    assert entry['path'] not in baseline
    descriptor, object_id = git_descriptor(NEW, entry['path'])
    assert object_id == entry['blob'] and entry['mode'] == '100644'
    assert descriptor == {key: entry[key] for key in ['sha256', 'bytes']} | {'mode': 420}
    source_files[entry['path']] = descriptor
assert sha(canonical(source_files)) == SOURCE_MAP
source_receipt = json.loads((packet / 'SOURCE-RECEIPT.json').read_bytes())
assert source_receipt == json.loads((v2 / 'SOURCE-RECEIPT.json').read_bytes())
maps = json.loads((packet / 'MAPS.json').read_bytes())
assert maps['source']['files'] == source_files
support = {path: git_descriptor(BASE, path)[0] for path in ['package-lock.json', 'scripts/typecheck.mjs']}
assert maps['archive']['files'] == source_files | support


def inventory(raw, prefix):
    assert len(raw) <= 16 * 1024 * 1024 and len(raw) % 512 == 0
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
        for entry in archive:
            assert entry.isreg() and entry.type in [tarfile.REGTYPE, tarfile.AREGTYPE] and entry.mode == 420 and not entry.pax_headers
            assert entry.name.startswith(prefix)
            path = entry.name[len(prefix):]
            assert path and not path.startswith('/') and all(part not in ['', '.', '..', 'AGENTS.md', 'node_modules'] for part in path.split('/'))
            assert path not in files and len(files) < 2048 and entry.size <= 4 * 1024 * 1024
            payload = archive.extractfile(entry).read()
            assert len(payload) == entry.size
            files[path] = {'sha256': sha(payload), 'bytes': len(payload), 'mode': entry.mode}
    return files


archive_bytes = blob(authority['evidenceCommit'], authority['archive']['path'])
package_bytes = blob(authority['evidenceCommit'], authority['package']['path'])
assert sha(archive_bytes) == authority['archive']['sha256'] == 'e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc'
assert sha(package_bytes) == authority['package']['sha256'] == '2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d'
inflater = zlib.decompressobj(31)
package_tar = inflater.decompress(package_bytes, 16 * 1024 * 1024)
assert inflater.eof and not inflater.unconsumed_tail and not inflater.unused_data
assert inventory(archive_bytes, '') == maps['archive']['files']
assert inventory(package_tar, 'package/') == maps['fullPackage']['files']
baseline_package = json.loads((v1 / 'BASELINE-PACKAGE.json').read_bytes())
outputs = [entry['path'].replace('src/', 'dist/', 1)[:-3] + extension for entry in new_sources if entry['path'].endswith('.ts') for extension in ['.js', '.js.map', '.d.ts', '.d.ts.map']]
assert len(baseline_package) == 846 and len(outputs) == 24
assert set(maps['fullPackage']['files']) == set(baseline_package) | set(outputs)
assert all(maps['fullPackage']['files'][path] == descriptor for path, descriptor in baseline_package.items())
assert [len(source_files), len(maps['archive']['files']), len(maps['fullPackage']['files'])] == [271, 273, 870]
build = json.loads((packet / 'BOUND-AUTHOR-BUILD.json').read_bytes())
assert build['independentlyCompiled'] is False and build['rootTrustedBuildReceipt'] is False
assert build['sourceMapSha256'] == SOURCE_MAP
assert build['packageMapSha256'] == sha(canonical({key: maps['fullPackage'][key] for key in ['files', 'directories']}))


def source_body_mask(text):
    start = text.index('export function authorizeSources(')
    end = text.index('export function assertSourceMaterialization(', start)
    return text[:start] + 'AUTHORIZED_SOURCE_BODY\n' + text[end:]


old_guard = (v1 / 'guards.mjs').read_text()
expected_guard = old_guard.replace('export const preparationRoot', "import { fixtureRoot, verifyFrozenV1 } from './frozen-v1.mjs';\nexport { fixtureRoot } from './frozen-v1.mjs';\n\nexport const preparationRoot", 1).replace('join(preparationRoot, name)', 'join(fixtureRoot, name)', 1).replace('export function verifyPreseal() {', 'export function verifyPreseal() {\n  verifyFrozenV1();', 1).replace('join(preparationRoot, safePath(path))', 'join(fixtureRoot, safePath(path))', 1)
assert source_body_mask(expected_guard) == source_body_mask((v2 / 'guards.mjs').read_text())
expected_types = (v1 / 'type-worker.mjs').read_text().replace('copyRegularTree, inspectTree', 'copyRegularTree, fixtureRoot, inspectTree', 1).replace("join(preparationRoot, 'SELECTED.json')", "join(fixtureRoot, 'SELECTED.json')").replace("join(preparationRoot, 'JOBS.json')", "join(fixtureRoot, 'JOBS.json')").replace('join(preparationRoot, job.fixture)', 'join(fixtureRoot, job.fixture)')
assert expected_types == (v2 / 'type-worker.mjs').read_text()
expected_driver = (v1 / 'synthetic-check.mjs').read_text().replace('expectedPackage, preparationRoot', 'expectedPackage, fixtureRoot, preparationRoot', 1)
for name in ['NEGATIVE-CASES.json', 'JOBS.json', 'COVERAGE.json', 'SELECTED.json']:
    expected_driver = expected_driver.replace("join(preparationRoot, '" + name + "')", "join(fixtureRoot, '" + name + "')")
expected_driver = expected_driver.replace('join(preparationRoot, job.fixture)', 'join(fixtureRoot, job.fixture)').replace('sha256(readFileSync(join(preparationRoot, path)))', "sha256(readFileSync(join(['PRESEAL.json', 'PRETEST-CLARIFICATIONS.md'].includes(path) ? fixtureRoot : preparationRoot, path)))").replace("presealCommit: '21ad8c589d7f138064616e8f37e748e6a2e7c200'", "presealCommit: '61cec1d71bf1121234de8ee727da990ff29c54e8', originalV1Commit: '409449136ae1adc252ff6e205a6bb5785d113d0f', fixtureRoot")
assert expected_driver == (v2 / 'synthetic-check.mjs').read_text()
assert (v1 / 'verify-recipe.mjs').read_bytes() == (v2 / 'verify-recipe.mjs').read_bytes()
diff_parts = []
diff_statuses = []
for name in ['guards.mjs', 'type-worker.mjs', 'synthetic-check.mjs', 'verify-recipe.mjs']:
    diff = subprocess.run(['git', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--abbrev=8', '--', PREFIX + 'consumers/' + name, PREFIX + 'consumers-v2/' + name], cwd=repo_copy, env=ENV, capture_output=True, timeout=5)
    diff_statuses.append({'file': name, 'status': diff.returncode, 'stderr': diff.stderr.decode()})
    assert diff.returncode == (0 if name == 'verify-recipe.mjs' else 1) and diff.stderr == b''
    diff_parts.append(diff.stdout)
assert b''.join(diff_parts) == (v2 / 'V1-V2.diff').read_bytes()
assert diff_statuses == json.loads((v2 / 'DIFF-STATUS.json').read_bytes())['reports']

materialization = json.loads((packet / 'MATERIALIZATION.json').read_bytes())


def snapshot(path, expected):
    root = pathlib.Path(path)
    assert root.resolve() == root and root.is_dir()
    files = {}
    directories = {'': root.stat().st_mode & 0o7777}
    identities = {}
    for entry in sorted(root.rglob('*')):
        assert not entry.is_symlink()
        name = entry.relative_to(root).as_posix()
        stat = entry.stat()
        if entry.is_dir(): directories[name] = stat.st_mode & 0o7777
        else:
            assert entry.is_file() and stat.st_nlink == 1 and stat.st_size <= 16 * 1024 * 1024
            raw = entry.read_bytes()
            files[name] = {'sha256': sha(raw), 'bytes': len(raw), 'mode': stat.st_mode & 0o7777}
            identities[name] = {'ino': stat.st_ino, 'dev': stat.st_dev, 'links': stat.st_nlink}
    assert files == expected['files'] and directories == expected['directories'], str(root)
    return {'path': str(root), 'files': len(files), 'directories': len(directories), 'fileMapSha256': sha(canonical(files)), 'directoryMapSha256': sha(canonical(directories)), 'fileIdentityMapSha256': sha(canonical(identities)), 'directoryIdentity': {'ino': root.stat().st_ino, 'dev': root.stat().st_dev}}


def materialized_state():
    results = {'archive': snapshot(materialization['archive']['root'], maps['archive'])}
    for scope, map_name in [('source', 'source'), ('package', 'fullPackage')]:
        movement = materialization[scope]
        assert movement['before'] == movement['after'] and not pathlib.Path(movement['staging']).exists()
        for suffix in ['original', 'moved']: results[scope + '-' + suffix] = snapshot(movement[suffix], maps[map_name])
        assert results[scope + '-moved']['directoryIdentity'] == movement['directoryIdentity']
        assert pathlib.Path(movement['original'], 'README.md').stat().st_ino != pathlib.Path(movement['moved'], 'README.md').stat().st_ino
    artifacts = pathlib.Path(materialization['artifacts']['root'])
    for name, descriptor in materialization['artifacts']['before']['files'].items():
        path = artifacts / name
        assert path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1
        assert {'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size, 'mode': path.stat().st_mode & 0o7777} == descriptor
    assert set(path.name for path in artifacts.iterdir()) == set(materialization['artifacts']['before']['files'])
    return results


before = materialized_state()
save(output / 'AUTHENTICATION.json', {'preseal': preseal, 'v1': V1, 'v2': V2, 'packet': DATA, 'files': authenticated, 'scratch': str(scratch), 'objectDatabaseUse': 'Explicit immutable Git reads only; scratch .git points to repository object database; no source/module fallback', 'node': NODE, 'nodeSha256': sha(pathlib.Path(NODE).read_bytes())})
save(output / 'DATA-AUDIT.json', {'classification': 'DATA_NOT_PRODUCT_EXECUTION', 'origins': origins, 'sourceMapSha256': SOURCE_MAP, 'sourceFiles': 271, 'archiveFiles': 273, 'support': support, 'packageFiles': 870, 'baselinePackageFiles': 846, 'newOutputs': 24, 'archiveSha256': sha(archive_bytes), 'packageSha256': sha(package_bytes), 'packageMapSha256': build['packageMapSha256'], 'readme': baseline_package['README.md'], 'sourceReceiptsEqualMeaning': True, 'sourceReceiptHashes': [sha((v2 / 'SOURCE-RECEIPT.json').read_bytes()), expected_hashes['sourceReceipt']['sha256']], 'diff': {'nonAdmissionGuardsUnchangedAfterExplicitPlumbing': True, 'typeBehaviorUnchangedAfterExplicitPlumbing': True, 'all36DriverOperationsAndFixturesUnchanged': True, 'verifierIdentical': True}, 'before': before, 'independentlyCompiled': False, 'rootTrustedBuildReceipt': False})
config = {'v1': str(v1), 'v2': str(v2), 'packet': str(packet), 'scratch': str(scratch), 'output': str(output), 'materialization': materialization, 'v1Seal': V1_SEAL, 'v2Seal': V2_SEAL, 'v2SourceHash': sha((v2 / 'SOURCE-RECEIPT.json').read_bytes()), 'packetSourceHash': expected_hashes['sourceReceipt']['sha256'], 'packetFullHash': expected_hashes['fullReceipt']['sha256'], 'expectedSourceMap': SOURCE_MAP, 'driverHash': seal2['entries']['synthetic-check.mjs']['sha256']}
save(output / 'CONFIG.json', config)


def intact():
    for entry in authenticated:
        path = pathlib.Path(entry['copy'])
        assert path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == entry['sha256'] and path.stat().st_mode & 0o7777 == entry['mode']
    assert materialized_state() == before


def run(name, args):
    intact()
    started = time.monotonic()
    stdout_path = output / (name + '-stdout.bin')
    stderr_path = output / (name + '-stderr.bin')
    timed_out = False
    signals = []
    overflow = False
    with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
        child = subprocess.Popen([NODE, *args], cwd=REPO, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ, stdout)
        selector.register(child.stderr, selectors.EVENT_READ, stderr)
        deadline = started + 90
        while selector.get_map() and not overflow:
            if time.monotonic() >= deadline:
                timed_out = True
                break
            for key, mask in selector.select(min(0.1, deadline - time.monotonic())):
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                remaining = 2 * 1024 * 1024 - key.data.tell()
                key.data.write(chunk[:remaining])
                if len(chunk) > remaining:
                    overflow = True
                    break
        selector.close()
        try:
            if timed_out or overflow: raise subprocess.TimeoutExpired([NODE, *args], 90)
            status = child.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            if not overflow: timed_out = True
            os.killpg(child.pid, signal.SIGTERM); signals.append('SIGTERM')
            try: status = child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL); signals.append('SIGKILL')
                status = child.wait(timeout=1)
        finally:
            child.stdout.close()
            child.stderr.close()
    try: os.killpg(child.pid, 0); absent = False
    except ProcessLookupError: absent = True
    raw = {'argv': [NODE, *args], 'pid': child.pid, 'group': child.pid, 'status': status if status >= 0 else None, 'signal': -status if status < 0 else None, 'timedOut': timed_out, 'overflow': overflow, 'reaped': child.returncode is not None, 'groupAbsent': absent, 'signalsSent': signals, 'elapsedMs': round((time.monotonic() - started) * 1000), 'stdoutBytes': stdout_path.stat().st_size, 'stderrBytes': stderr_path.stat().st_size}
    save(output / (name + '-process.json'), raw)
    assert status == 0 and not timed_out and not overflow and absent and max(raw['stdoutBytes'], raw['stderrBytes']) <= 2 * 1024 * 1024, raw
    intact()
    return raw


admission = run('admission', [str(OWN / 'check.mjs'), str(output / 'CONFIG.json')])
replay_prefix = expected_driver.split('\nlet failure;\n')[0]
replay_prefix = replay_prefix.replace("'./guards.mjs'", json.dumps((v2 / 'guards.mjs').as_uri())).replace("'./type-worker.mjs'", json.dumps((v2 / 'type-worker.mjs').as_uri()))
replay_prefix = replay_prefix.replace("mkdtempSync(join(preparationRoot, '.synthetic-'))", 'mkdtempSync(join(' + json.dumps(str(scratch)) + ", '.synthetic-'))")
replay_prefix = replay_prefix.replace("join(preparationRoot, 'evidence')", json.dumps(str(output / 'replay-output')))
replay_tail = '''
let failure;
try {
  assert.deepEqual(Object.keys(operations).sort(), controls.map(control => control.id).sort());
  for (const control of controls) {
    const tree = fakeTree(control.id);
    let caught;
    let value;
    try { value = operations[control.id](tree); } catch (error) { caught = error; }
    const raw = { id: control.id, expected: control.outcome, value: value ?? null, error: caught ? { code: caught.code ?? null, message: caught.message, stack: caught.stack } : null };
    writeFileSync(join(evidence, control.id + '-raw.json'), JSON.stringify(raw, null, 2) + '\\n', { flag: 'wx' });
    const matched = control.outcome === 'accept' ? caught === undefined : caught?.code === control.outcome;
    observations.push({ id: control.id, expected: control.outcome, matched });
    requireFact(matched, 'SYNTHETIC_MISMATCH', control.id);
  }
  verifyPreseal();
  verifySelected();
} catch (error) { failure = { code: error.code ?? null, message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  rmSync(scratch, { recursive: true });
  const result = { observations, failure, count: observations.length, matched: observations.filter(row => row.matched).length, excluded: 'Original supplemental tool-tree audit not run', productImports: 0, compilerRuns: 0 };
  writeFileSync(join(evidence, 'RESULTS.json'), JSON.stringify(result, null, 2) + '\\n', { flag: 'wx' });
  console.log(JSON.stringify({ evidence, count: result.count, matched: result.matched, failure }));
}
'''
replay_path = scratch / 'replay.mjs'
write(replay_path, (replay_prefix + '\n' + replay_tail).encode())
save(output / 'REPLAY-BINDING.json', {'frozenDriverSha256': config['driverHash'], 'operationsBlockSha256': sha(expected_driver.split('const operations = {', 1)[1].split('\nlet failure;\n')[0].encode()), 'replaySha256': sha(replay_path.read_bytes()), 'plumbing': ['absolute authenticated helper imports', 'scratch/output outside recipe', 'capture-before-compare wrapper'], 'unchanged': 'All 36 operation bodies, helper fixtures, negative expected outcomes', 'omitted': 'Supplemental tool-tree inventory after the 36 controls; not a pass'})
replay = run('replay', [str(replay_path)])
replay_summary = json.loads((output / 'replay-stdout.bin').read_bytes())
assert [replay_summary['count'], replay_summary['matched'], replay_summary['failure']] == [36, 36, None]
after = materialized_state()
assert before == after
save(output / 'RESULTS.json', {'verdict': 'PASS_SELECTED_COMPOSITION_DATA_SYNTHETIC_ONLY', 'preseal': preseal, 'admissionObservations': 25, 'matchedAdmissionObservations': 25, 'replayedFrozenControls': 36, 'matchedFrozenControls': 36, 'knownOwnedProcesses': [admission, replay], 'after': after, 'sourceMapSha256': SOURCE_MAP, 'archiveMembers': 273, 'selectedSourceMembers': 271, 'packageMembers': 870, 'projectionMatchesOriginalPreseal': True, 'priorFindingsRescored': False, 'priorWildcardFailureRescored': False, 'productImports': 0, 'productRuns': 0, 'builds': 0, 'compilerRuns': 0, 'readiness': 'Composition correction/data packet only; runtime-v2, trusted build, compound recipe and product route pending'})
print(output)
