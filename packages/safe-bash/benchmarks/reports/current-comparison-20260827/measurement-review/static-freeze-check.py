import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile

repo = Path('/Users/kjopek/Workspace/safe-bash')
freeze = repo / 'benchmarks/reports/current-comparison-20260827/measurement-freeze'
candidate = 'e33974b8c643077453227a9679d8ceca8367998c'
primary = '010411eff3dd210b9575e061914efccd65c13547'
observed = {}
hashed_bytes = 0

def digest(data, algorithm='sha256'):
    return hashlib.new(algorithm, data).hexdigest()

def identity(metadata):
    return (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_nlink,
            metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)

def read(filename):
    global hashed_bytes
    filename = Path(filename)
    before = filename.lstat()
    assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1, str(filename)
    assert before.st_size <= 256 * 1024 * 1024, str(filename)
    data = filename.read_bytes()
    assert identity(filename.lstat()) == identity(before) and len(data) == before.st_size, str(filename)
    observed[filename] = before
    hashed_bytes += len(data)
    return data

def document(filename):
    return json.loads(read(filename))

def selected(root, name):
    parts = PurePosixPath(name).parts
    assert parts and not name.startswith('/') and all(part not in ('.', '..') for part in parts)
    root = Path(root)
    assert root.resolve() == root and root.is_dir(), str(root)
    filename = root.joinpath(*parts)
    assert filename.resolve() == filename and filename.is_relative_to(root), str(filename)
    return filename

def verify(record, root=None):
    filename = selected(root or record['root'], record['path'])
    data = read(filename)
    assert len(data) == record['bytes'] and digest(data) == record['sha256'], str(filename)
    if 'mode' in record:
        assert stat.S_IMODE(filename.stat().st_mode) == record['mode'], str(filename)
    return data

def mapping(records):
    result = {record['path']: (record['bytes'], record['sha256']) for record in records}
    assert len(result) == len(records)
    return result

def git(*arguments):
    return subprocess.check_output(['/usr/bin/git', *arguments], cwd=repo,
                                   env={'PATH': '/usr/bin:/bin'}, timeout=15)

def archive(record, prefix):
    filename = selected(record['root'], record['path'])
    verify(record)
    records = []
    total = 0
    with tarfile.open(filename, 'r|gz') as archive_file:
        for member in archive_file:
            assert len(records) < 8192
            parts = PurePosixPath(member.name).parts
            assert parts and not member.name.startswith('/') and '..' not in parts
            if member.isdir():
                continue
            assert member.isfile() and not member.issparse() and 0 <= member.size <= 256 * 1024 * 1024
            assert member.name.startswith(prefix), member.name
            name = member.name[len(prefix):]
            total += member.size
            assert total <= 1024 * 1024 * 1024
            data = archive_file.extractfile(member).read(member.size + 1)
            assert len(data) == member.size
            records.append({'path': name, 'bytes': len(data), 'sha256': digest(data),
                            'gitBlob': digest(b'blob ' + str(len(data)).encode() + b'\0' + data, 'sha1')})
    mapping(records)
    return records

ready = document(freeze / 'READY.json')
binding = json.loads(verify(ready['binding']))
receipt = json.loads(verify(ready['proposedRootReceipt']))
assert git('rev-parse', candidate + '^{commit}').decode().strip() == candidate == ready['candidate']
assert git('rev-parse', candidate + '^{tree}').decode().strip() == ready['gitTree'] == binding['candidate']['gitTree']
assert receipt['candidateCommit'] == candidate == binding['candidate']['commit']
assert receipt['bindingSha256'] == ready['binding']['sha256']
assert ready['sourceSha256'] == binding['candidate']['source']['sha256'] == receipt['exactSourceSha256']
assert ready['packageSha256'] == binding['candidate']['pack']['sha256'] == receipt['exactPackageSha256']
assert ready['sourceInventorySha256'] == binding['candidate']['sourceInventory']['sha256']
assert receipt['executionAuthorized'] and not receipt['timingAuthorized']
assert receipt['qualificationScope'] == 'COMMITTED_FROZEN_COMPARISON_ONLY'
assert receipt['qualifications']['rootAnnouncementRequiredBeforeProductImports']
assert binding['profiles'] == ['original', 'aligned', 'breadth']
inventory = json.loads(verify(binding['candidate']['sourceInventory']))
source = archive(binding['candidate']['source'], 'package/')
assert mapping(source) == mapping(inventory['files']) and len(source) == 220
tree = git('ls-tree', '-r', '-z', candidate, '--', *inventory['selections'])
git_files = {}
for line in tree.split(b'\0'):
    if line:
        metadata, name = line.decode().split('\t')
        mode, kind, blob = metadata.split()
        assert kind == 'blob'
        git_files[name] = (mode, blob)
assert git_files == {record['path']: (record['gitMode'], record['gitBlob']) for record in inventory['files']}
assert {record['path']: record['gitBlob'] for record in source} == {name: value[1] for name, value in git_files.items()}
for record in inventory['files']:
    verify(record, ready['paths']['build'])
package = document(freeze / 'candidate-package.json')
packed = archive(binding['candidate']['pack'], 'package/')
assert len(packed) == 710 and mapping(packed) == mapping(package['archiveFiles'])
assert not Path(package['movedFromNowAbsent']).exists()
for record in packed:
    verify(record, package['movedRoot'])
    verify(record, package['buildRoot'])
    assert (Path(package['movedRoot']) / record['path']).stat().st_ino != (Path(package['buildRoot']) / record['path']).stat().st_ino
closures = {}
for name, engine in binding['engines'].items():
    closure = engine['closure']
    expected = mapping(closure['files'])
    found = set()
    for directory, directories, filenames in os.walk(closure['root'], followlinks=False):
        for dirname in directories:
            assert not (Path(directory) / dirname).is_symlink()
        for filename in filenames:
            found.add(str((Path(directory) / filename).relative_to(closure['root'])))
        assert len(found) <= 8192
    assert found == set(expected), name
    for record in closure['files']:
        verify(record, closure['root'])
    for filename in [engine['entry'], engine['packageJson'], *engine['assets'], *engine['locks']]:
        assert filename in expected
    assert engine['heapMiB'] == 256
    closures[name] = expected
assert len(closures['virtual-bash']) == 711 and len(closures['just-bash']) == 3844
authentication = document(freeze / 'baseline-authentication.json')
assert authentication['primaryCommit'] == primary
primary_docs = {}
for name, record in authentication['primaryRecords'].items():
    data = git('show', primary + ':' + record['path'])
    assert len(data) == record['bytes'] and digest(data) == record['sha256']
    assert read(Path(ready['paths']['tools']) / 'primary' / name) == data
    if name.endswith('.json'):
        primary_docs[name] = json.loads(data)
published = mapping(primary_docs['published-files.json']['files'])
assert len(published) == 955
baseline = archive(binding['baselineTar'], 'package/')
assert mapping(baseline) == published
prefix = 'benchmarks/node_modules/just-bash/'
assert {name[len(prefix):]: value for name, value in closures['just-bash'].items() if name.startswith(prefix)} == published
assert closures['just-bash'] == mapping(primary_docs['execution-post-run-check-attempt-1.json']['actualFiles'])
old_closure = mapping(primary_docs['execution-closure.json']['files'])
assert len(old_closure) == 3842
assert set(closures['just-bash']) - set(old_closure) == {'auth-observer/observe-load.mjs', 'auth-observer/observe-process.mjs'}
assert all(closures['just-bash'][name] == value for name, value in old_closure.items())
for record in primary_docs['execution-post-run-check-attempt-1.json']['actualFiles']:
    assert stat.S_IMODE(selected(binding['engines']['just-bash']['closure']['root'], record['path']).stat().st_mode) == record['mode']
metadata = primary_docs['registry-metadata.raw.json']
tar_bytes = verify(binding['baselineTar'])
assert metadata['name'] == 'just-bash' and metadata['version'] == '3.4.2'
assert digest(tar_bytes, 'sha1') == metadata['dist']['shasum']
assert 'sha512-' + base64.b64encode(hashlib.sha512(tar_bytes).digest()).decode() == metadata['dist']['integrity']
runner = document(freeze / 'runner-cohort-bindings.json')
assert runner['candidate'] == candidate and runner['runner'] == binding['runner']
for group in ('runner', 'cohorts'):
    assert len(runner[group]['files']) == 15
    directory = 'execution' if group == 'runner' else 'cohorts'
    for record in runner[group]['files']:
        data = verify(record, runner[group]['root'])
        assert data == git('show', candidate + ':benchmarks/reports/current-comparison-20260827/' + directory + '/' + record['path'])
assert runner['seals'] == binding['seals']
for name, sha256 in binding['seals'].items():
    assert digest(read(Path(runner['cohorts']['root']) / name)) == sha256
manifest = document(freeze / 'FREEZE_MANIFEST.json')
for record in manifest['files'] + manifest['authoredScripts']:
    verify(record, freeze)
node_bytes = verify(binding['node'])
assert digest(node_bytes) == ready['nodeSha256']
host = binding['host']
assert host['env'] == {'PATH': '/usr/bin:/bin', 'HOME': host['root'] + '/home', 'TMPDIR': host['root'] + '/tmp', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}
assert host['cwd'] == host['root'] + '/cwd'
targets = []
for name, engine in binding['engines'].items():
    root = engine['closure']['root']
    package_json = selected(root, engine['packageJson'])
    package_data = document(package_json)
    assert package_data['name'] == name
    assert package_data['version'] == ('3.4.2' if name == 'just-bash' else '0.0.0')
    if name == 'virtual-bash':
        assert not package_data.get('dependencies')
    targets.append({'name': name, 'packageJson': str(package_json), 'entry': str(selected(root, engine['entry']))})
program = "import{pathToFileURL}from'node:url';const targets=JSON.parse(process.argv[1]);console.log(JSON.stringify(targets.map(target=>({...target,resolved:import.meta.resolve(target.name,pathToFileURL(target.packageJson).href)}))));"
with subprocess.Popen([str(selected(binding['node']['root'], binding['node']['path'])), '--experimental-import-meta-resolve', '--input-type=module', '-e', program, json.dumps(targets)], env=host['env'], cwd=host['cwd'], stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
    try:
        stdout, stderr = child.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.communicate()
        raise
    assert child.returncode == 0 and not stderr and len(stdout) < 16384
    resolutions = json.loads(stdout)
    for result in resolutions:
        assert result['resolved'] == Path(result['entry']).as_uri()
    resolution_pid = child.pid
assert not Path(ready['outputDirectoryMustNotExist']).exists()
for filename, previous in observed.items():
    assert identity(filename.lstat()) == identity(previous), str(filename)
verify(binding['node'])
verify(ready['binding'])
verify(ready['proposedRootReceipt'])
print(json.dumps({'status': 'GO_STATIC_IDENTITY_ONLY_ROOT_ANNOUNCEMENT_STILL_REQUIRED', 'candidate': candidate, 'tree': ready['gitTree'], 'sourceSha256': ready['sourceSha256'], 'sourceInventorySha256': ready['sourceInventorySha256'], 'packageSha256': ready['packageSha256'], 'bindingSha256': ready['binding']['sha256'], 'proposedRootReceiptSha256': ready['proposedRootReceipt']['sha256'], 'baselineTarSha256': binding['baselineTar']['sha256'], 'nodeSha256': ready['nodeSha256'], 'sourceFiles': len(source), 'candidateArchiveFiles': len(packed), 'baselinePublishedFiles': len(published), 'candidateClosureFiles': len(closures['virtual-bash']), 'baselineClosureFiles': len(closures['just-bash']), 'runtimeFiles': 15, 'cohortFiles': 15, 'reportRecords': len(manifest['files']), 'primaryRecords': len(primary_docs) + 1, 'selectedFilesUnchangedThroughEnd': len(observed), 'hashedBytes': hashed_bytes, 'metadataResolution': resolutions, 'metadataChild': {'pid': resolution_pid, 'exit': 0, 'closed': True, 'forcedCleanup': False}, 'productImports': 0, 'engineCalls': 0, 'measurementCalls': 0, 'nativeOracleCalls': 0, 'downloads': 0, 'installs': 0}, indent=2))
