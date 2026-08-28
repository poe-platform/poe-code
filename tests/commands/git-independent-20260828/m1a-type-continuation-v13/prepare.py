import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile
import time

ROOT = Path(__file__).resolve().parent
REPO = Path('/Users/kjopek/Workspace/safe-bash')
PARENT = ROOT.parent
OLD = PARENT / 'm1a-continuation-v12'
DATA = PARENT / 'm1a-continuation-v11'
COMMIT = 'b94bd13b156320d713d692c11f85f655cda68690'
START = time.monotonic_ns()
metadata_commands = []


def digest(content):
    return hashlib.sha256(content).hexdigest()


def git(*args):
    metadata_commands.append(list(args))
    return subprocess.check_output(['git', *args], cwd=REPO)


def read_json(path):
    return json.loads(path.read_bytes())


def publish(name, data):
    with (ROOT / name).open('x') as output:
        output.write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def census(root):
    rows = []
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(directory) / name
            assert name != 'AGENTS.md'
            info = path.lstat()
            row = dict(path=str(path), mode=stat.S_IMODE(info.st_mode))
            assert not stat.S_ISLNK(info.st_mode), str(path)
            if stat.S_ISDIR(info.st_mode):
                row['type'] = 'directory'
            else:
                assert stat.S_ISREG(info.st_mode)
                row.update(type='file', bytes=info.st_size, sha256=digest(path.read_bytes()))
            rows.append(row)
    return sorted(rows, key=lambda row: row['path'].encode())


def canonical(rows):
    tuples = []
    for row in sorted(rows, key=lambda row: row['path'].encode()):
        value = [row['path'].encode().hex(), row['type'], row['mode']]
        if row['type'] == 'file':
            value.extend([row['bytes'], row['sha256']])
        tuples.append(value)
    return b'M1A-CENSUS-v12\0' + json.dumps(tuples, separators=(',', ':')).encode() + b'\n'


assert ROOT == REPO / 'tests/commands/git-independent-20260828/m1a-type-continuation-v13'
assert git('rev-parse', '--show-toplevel').decode().strip() == str(REPO)
index_before = git('diff', '--cached', '--raw', '-z')
old_seal = read_json(OLD / 'PRESEAL.json')
v5 = PARENT / 'm1a-review-v5'
package_path = Path(read_json(v5 / 'PRESEAL.json')['packagePath'])
candidate_path = package_path.parent / 'CANDIDATE.json'
base_path = REPO / 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'
protected_roots = [v5, DATA, OLD]
tracked = git('ls-tree', '-r', '-z', COMMIT, '--', *(str(path.relative_to(REPO)) for path in [*protected_roots, package_path, candidate_path, base_path]))
authenticated = []
for record in tracked.split(b'\0'):
    if not record:
        continue
    header, raw_path = record.split(b'\t', 1)
    mode, kind, object_id = header.split(b' ')
    assert kind == b'blob' and mode in [b'100644', b'100755']
    path = REPO / raw_path.decode('utf8')
    assert path.name != 'AGENTS.md' and not path.is_symlink()
    content = path.read_bytes()
    assert hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest() == object_id.decode()
    assert stat.S_IMODE(path.stat().st_mode) == int(mode, 8) & 4095
    authenticated.append(dict(path=str(path), gitBlob=object_id.decode(), bytes=len(content), sha256=digest(content)))
assert len(authenticated) > 100
assert {str(package_path), str(candidate_path), str(base_path)} <= {row['path'] for row in authenticated}
candidate = read_json(candidate_path)
base_encoded = base_path.read_bytes()
assert digest(base_encoded) == candidate['baseEvidenceEncodedSha256']
base_evidence = json.loads(gzip.decompress(base64.b64decode(base_encoded)))
assert base_evidence['source']['inputs'] == candidate['selectedBaseInputs']
trees = {}


def git_hash(kind, content):
    return hashlib.sha1(kind.encode() + b' ' + str(len(content)).encode() + b'\0' + content).hexdigest()


for row in base_evidence['source']['reachableTrees'] + base_evidence['source']['reconstructedTrees']:
    content = base64.b64decode(row['base64'])
    assert git_hash('tree', content) == row['oid']
    entries, offset = [], 0
    while offset < len(content):
        space = content.index(b' ', offset)
        zero = content.index(b'\0', space)
        entries.append(dict(mode=content[offset:space].decode(), name=content[space+1:zero].decode(), oid=content[zero+1:zero+21].hex()))
        offset = zero + 21
    assert entries == sorted(entries, key=lambda entry: (entry['name'] + ('/' if entry['mode'] == '40000' else '')).encode())
    trees[row['oid']] = entries


def edit_tree(object_id, parts, replacement):
    entries = [dict(entry) for entry in trees[object_id]]
    entry = next(entry for entry in entries if entry['name'] == parts[0])
    if len(parts) == 1:
        entry.update(oid=replacement['blob'], mode=replacement['mode'])
    else:
        entry['oid'] = edit_tree(entry['oid'], parts[1:], replacement)
    content = b''.join((entry['mode'] + ' ' + entry['name']).encode() + b'\0' + bytes.fromhex(entry['oid']) for entry in entries)
    result = git_hash('tree', content)
    trees[result] = entries
    return result


composition = base_evidence['source']['commits'][0]['tree']
for row in base_evidence['source']['componentTable']:
    composition = edit_tree(composition, row['path'].split('/'), row)
assert composition == candidate['base'] == old_seal['base']

audit = read_json(OLD / 'AUDIT.json')
artifact = (OLD / 'WORKING.json.gz.base64').read_bytes()
assert digest(artifact) == audit['workingArchive']['artifactSha256']
compressed = base64.b64decode(artifact)
assert digest(compressed) == audit['workingArchive']['gzipSha256']
expanded = gzip.decompress(compressed)
assert digest(expanded) == audit['workingArchive']['jsonSha256']
assert len(expanded) == audit['workingArchive']['jsonBytes']
working = json.loads(expanded)
assert len(working['rows']) == audit['workingArchive']['entries'] == 5740
work_rows = {}
for row in working['rows']:
    path = PurePosixPath(row['path'])
    assert not path.is_absolute() and '..' not in path.parts and 'AGENTS.md' not in path.parts
    assert str(path) == row['path'] and row['path'] not in work_rows
    assert row['type'] in ['file', 'directory']
    if row['type'] == 'file':
        content = base64.b64decode(row['base64'], validate=True)
        assert len(content) == row['bytes'] and digest(content) == row['sha256']
    work_rows[row['path']] = row

archive = base64.b64decode(package_path.read_bytes())
assert digest(archive) == old_seal['packageSha256'] == '68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68'
members = read_json(DATA / 'PACKAGE-MEMBERS.json')
expected = {row['path']: row for row in members}
assert len(expected) == len(members) == 898
package_files = {}
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
    for member in package.getmembers():
        path = PurePosixPath(member.name)
        assert path.parts[0] == 'package' and '..' not in path.parts and 'AGENTS.md' not in path.parts
        assert member.isfile() and str(path) == member.name
        relative = str(PurePosixPath(*path.parts[1:]))
        assert relative not in package_files and relative in expected
        content = package.extractfile(member).read()
        entry = expected[relative]
        assert digest(content) == entry['sha256'] and len(content) == entry['bytes'] and member.mode == entry['mode']
        original = work_rows['physically moved app/node_modules/virtual-bash/' + relative]
        assert original['sha256'] == entry['sha256'] and original['mode'] == entry['mode']
        package_files[relative] = content
assert set(package_files) == set(expected)

tools = [tool for tool in read_json(DATA / 'TOOLS.json') if tool['name'] != 'npm']
assert [tool['version'] for tool in tools] == ['5.9.3', '22.20.1', '6.21.0']
for tool in tools:
    for row in tool['rows']:
        if row.get('directory'):
            assert Path(row['path']).is_dir()
        else:
            assert digest(Path(row['path']).read_bytes()) == row['sha256']
node = old_seal['node']
assert digest(Path(node['path']).read_bytes()) == node['sha256']

work = ROOT / 'work'
work.mkdir(exist_ok=True)
routes = []
logical_package = str(OLD / 'RUN-01/work/physically moved app/node_modules/virtual-bash')
logical_source = str(OLD / 'RUN-01/work/source')


def route(logical, physical, group, content=None, mode=None):
    if content is not None:
        physical.parent.mkdir(parents=True, exist_ok=True)
        if physical.exists():
            assert not physical.is_symlink() and physical.read_bytes() == content
            assert stat.S_IMODE(physical.stat().st_mode) == mode
        else:
            with physical.open('xb') as output:
                output.write(content)
            physical.chmod(mode)
    content = physical.read_bytes()
    routes.append(dict(logical=logical, physical=str(physical), group=group, bytes=len(content), sha256=digest(content), mode=stat.S_IMODE(physical.stat().st_mode)))


for relative, content in package_files.items():
    route(logical_package + '/' + relative, work / 'package' / relative, 'package', content, expected[relative]['mode'])
selected_work = []
for path, row in work_rows.items():
    if row['type'] == 'file' and (path.startswith('source/node_modules/') or path == 'source/package.json'):
        content = base64.b64decode(row['base64'])
        route(str(OLD / 'RUN-01/work' / path), work / path, 'type-scaffold', content, row['mode'])
        selected_work.append({key: value for key, value in row.items() if key != 'base64'})
for tool in tools:
    for entry in tool['rows']:
        if not entry.get('directory'):
            route(entry['path'], Path(entry['path']), 'pinned-tool')
for name in ['positive.ts', 'negative-public-root.ts', 'package.json']:
    route(str(OLD / 'types' / name), OLD / 'types' / name, 'frozen-consumer')
assert len({entry['logical'] for entry in routes}) == len(routes)

source_inputs = read_json(DATA / 'INPUTS.json')
for row in source_inputs:
    assert digest(base64.b64decode(row['base64'])) == row['sha256']
source_proof = read_json(DATA / 'SOURCE-PROOF.json')
assert source_proof['candidate'] == old_seal['candidate'] == '9885390fb11454fa194a3e60fdbef198dbfdf633'
assert source_proof['base'] == old_seal['base'] == '8437e4eda904e1248c25eeef0d9d455b1d251495'
objects = [COMMIT, 'c5af63a2f6b9053ccd1d4b7b0fa2e99f4f74175a', old_seal['candidate'], *(row['revision'] for row in base_evidence['source']['commits'])]
commit_objects = len(objects)
objects.extend(row['blob'] for row in source_proof['exactSourceIdentities'])
metadata_commands.append(['cat-file', '--batch-check'])
object_checks = subprocess.check_output(['git', 'cat-file', '--batch-check'], cwd=REPO, input=('\n'.join(objects) + '\n').encode()).decode().splitlines()
assert len(object_checks) == len(objects)
for index, line in enumerate(object_checks):
    object_id, object_type, size = line.split()
    assert object_id == objects[index] and object_type == ('commit' if index < commit_objects else 'blob') and int(size) > 0
for row in base_evidence['source']['commits']:
    assert git_hash('commit', base64.b64decode(row['base64'])) == row['revision']
selected = read_json(v5 / 'BINDING.json')['selected']
assert len(selected) == len(source_inputs) == 279
revision_trees = {}
for row in selected:
    revision = row.get('revision', old_seal['candidate'])
    if revision not in revision_trees:
        records = git('ls-tree', '-r', '-z', revision).split(b'\0')
        revision_trees[revision] = {record.split(b'\t', 1)[1]: record.split(b'\t', 1)[0] for record in records if record}
    mode = row['mode'] if isinstance(row['mode'], str) else '100' + format(row['mode'], 'o')
    assert revision_trees[revision][row['path'].encode()] == (mode + ' blob ' + row['blob']).encode()
    source = next(entry for entry in source_inputs if entry['path'] == row['path'])
    assert source['sha256'] == row['sha256']
    assert git_hash('blob', base64.b64decode(source['base64'])) == row['blob']
for row in source_proof['exactSourceIdentities']:
    content = base64.b64decode(next(entry for entry in source_inputs if entry['path'] == row['path'])['base64'])
    assert digest(content) == row['sha256']
    assert hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest() == row['blob']

censuses = []
for directory in [*protected_roots, *(Path(tool['root']) for tool in tools), work]:
    rows = census(directory)
    value = digest(canonical(rows))
    historical = next((entry for entry in old_seal['censuses'] if entry['root'] == str(directory)), None)
    if historical:
        assert historical['canonicalSha256'] == value
    censuses.append(dict(root=str(directory), entries=len(rows), canonicalSha256=value, rows=rows))

negative_packet = read_json(OLD / 'RUN-01/capture/11-types-negative-public-root.packet.json')
positive_packet = read_json(OLD / 'RUN-01/capture/7-types-positive.packet.json')
raw_negative = (OLD / 'RUN-01/capture/11-types-negative-public-root.stdout.jsonl').read_text().splitlines()
prefix = '../../../types/negative-public-root.ts(1,9): error TS2724: '
assert len(raw_negative) == 2 and raw_negative[1].startswith(prefix)
message = raw_negative[1][len(prefix):]
assert message == "'\"" + logical_package + '/dist/index.js' + "\"' has no exported member named 'createGitCommand'. Did you mean 'createTarCommand'?"
declaration = package_files['dist/commands/archive/index.d.ts'].decode()
suggestion_start = declaration.index('createTarCommand')
suggestion_line = declaration[:suggestion_start].count('\n') + 1
suggestion_column = suggestion_start - declaration.rfind('\n', 0, suggestion_start)
related = dict(code=2728, category=3, file=logical_package + '/dist/commands/archive/index.d.ts', start=suggestion_start, length=16, line=suggestion_line, column=suggestion_column, message="'createTarCommand' is declared here.", related=[])
expectation = dict(code=2724, category=1, file=str(OLD / 'types/negative-public-root.ts'), start=8, length=16, line=1, column=9, message=message, related=[related])
roles = []
for role, packet, consumer_hash in [('positive', positive_packet, '864908fc03222fbed3631a103dce49eda597c28ac00ad3074696f711895e8648'), ('negative-public-root', negative_packet, 'ed9ef7fc39f5d9d2c926d21fabd850fdeb8393a47b9ef37b48876b30b38f1b55')]:
    consumer = str(OLD / 'types' / (role + '.ts'))
    assert digest(Path(consumer).read_bytes()) == consumer_hash
    roles.append(dict(id=role, args=packet['args'], consumer=consumer, consumerSha256=consumer_hash, exitCode=0 if role == 'positive' else 2, diagnostics=[] if role == 'positive' else [expectation], formatted='' if role == 'positive' else raw_negative[1] + '\n'))

publish('INPUT-BINDINGS.json', dict(commit=COMMIT, tracked=authenticated, gitObjectChecks=object_checks, derivedBase=dict(identity=composition, storedObjectClaim=False, canonicalTrees=len(trees), components=len(base_evidence['source']['componentTable']), baseEvidenceSha256=digest(base_encoded), selectedSourceMembership=279, revisionTrees=list(revision_trees)), workingArchive=audit['workingArchive'], selectedWorking=selected_work, sourceInputsSha256=digest((DATA / 'INPUTS.json').read_bytes()), sourceInputsEntries=len(source_inputs), sourceProof=source_proof, packageMembers=members, routes=routes, censuses=censuses))
publish('EXPECTATION.json', dict(original='TS2305 expectation remains FAIL in v12', corrected=expectation, exactFormatted=raw_negative[1] + '\n', noOtherPrimaryDiagnostics=True, positiveNoDiagnostics=True))
publish('PREPARATION.json', dict(role='DATA_ONLY_NO_COMPILER_EXECUTION', startedMonotonicNs=str(START), elapsedMs=(time.monotonic_ns()-START)/1e6, metadataCommands=metadata_commands, childProcesses=len(metadata_commands), currentPythonOwner=1, priorDataPreparation=[dict(outcome='IsADirectoryError reading TypeScript bin directory as tool file', elapsedToolSeconds=0.6152, knownProcesses=4, writes=0, compilerExecutions=0, correction='Honor directory records in authenticated TOOLS manifest'), dict(outcome='Incorrectly requested stored commit for historical derived base; batch-check missing row failed unpack', elapsedToolSeconds=None, knownProcesses=5, writes='Only owned archive rehydration; subsequently reread and byte/mode verified without overwrite', compilerExecutions=0, correction='Recompute exact canonical five-component derived base; retain no stored-object claim')], priorInteractiveInspection='Separate terminal metadata/read-only inspections, including one failed lookup of nonexistent m1a-coherent-v5/PRESEAL.json and failed verify of derived base abbreviation; no subject execution or writes there. Not a universal helper census.', foreignIndexRawBase64=base64.b64encode(index_before).decode()))
sealed_files = [dict(path=str(path), bytes=path.stat().st_size, sha256=digest(path.read_bytes())) for path in sorted(ROOT.iterdir()) if path.is_file()]
ts_root = Path(tools[0]['root'])
seal = dict(schema='M1A-v13-exact-negative-compiler', candidate=old_seal['candidate'], base=old_seal['base'], priorEvidence=COMMIT, priorPreseal='c5af63a2f6b9053ccd1d4b7b0fa2e99f4f74175a', node=node, compiler=dict(version='5.9.3', entry=str(ts_root/'lib/typescript.js'), sha256=digest((ts_root/'lib/typescript.js').read_bytes()), originalEntry=negative_packet['entry'], originalEntrySha256=negative_packet['entrySha256']), logicalCwd=logical_source, logicalPackage=logical_package, packageSha256=old_seal['packageSha256'], packageMembers=898, work=str(work), files=sealed_files, roles=roles, limits=dict(milliseconds=300000, admissionMilliseconds=270000, childMilliseconds=60000, controlledProcesses=6, peak=2, captureBytes=16*1024*1024, workBytes=128*1024*1024), command=[node['path'], str(ROOT/'outer.mjs')], censusModule=dict(path=str(OLD/'census.mjs'), sha256=digest((OLD/'census.mjs').read_bytes())), immutableConsumerBytes=True, compilerEntryDelta='Public CompilerHost/API rather than CLI; original parseCommandLine arguments and logical paths unchanged', runtimeReplay=False)
publish('PRESEAL.json', seal)
print(json.dumps(dict(prepared=True, packageFiles=len(package_files), selectedWorkingFiles=len(selected_work), routes=len(routes), sealedFiles=len(sealed_files), elapsedMs=(time.monotonic_ns()-START)/1e6)))
