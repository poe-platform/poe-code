import base64
import collections
import datetime
import gzip
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import subprocess

REPO = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN = 'tests/integration/full-gate-20260827/unified76-driver-independent/r3-diagnosis-v19/'
BASE = 'tests/integration/full-gate-20260827/unified76-driver/'
DIAG = 'cd9d08be0918ddc5bd59c40b088e06be2b5b2f54'
RUN = 'c23a8de855f4f51423ee21c35ef5bbcc4d2d56a5'
SOURCE = 'f03c260269dfd8ee10666f7fd2560655f8e14a38'
PRODUCT = 'f5e9fc49b6abb38e180cc9de16c95fced102ff75'
DP = BASE + 'r3-diagnosis-v1/'
RP = BASE + 'released-run-v3-qualified-h11/'
SP = BASE + 'launcher-v3/'
LIMIT = 64 * 1024 * 1024
CHUNK = 65536


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(['git', '--no-replace-objects', *args], cwd=REPO, timeout=30)


def blob(revision, name):
    assert pathlib.PurePosixPath(name).name.lower() != 'agents.md'
    size = int(git('cat-file', '-s', revision + ':' + name))
    assert size <= LIMIT
    return git('show', revision + ':' + name)


def load(revision, name):
    return json.loads(blob(revision, name))


def normalized(value):
    return sha(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def stream_hash(file):
    digest = hashlib.sha256()
    size = 0
    while chunk := file.read(CHUNK):
        size += len(chunk)
        assert size <= LIMIT
        digest.update(chunk)
    return size, digest.hexdigest()


def safe_path(root, relative):
    parts = pathlib.PurePosixPath(relative).parts
    assert parts and not relative.startswith('/') and '..' not in parts
    assert all(part.lower() != 'agents.md' for part in parts)
    current = pathlib.Path(root)
    for part in parts:
        current /= part
        assert not current.is_symlink(), str(current)
    return current


def metadata(revision, name):
    raw = blob(revision, name)
    info = git('ls-tree', revision, '--', name).decode().split()
    return {'path': name, 'commit': revision, 'mode': info[0], 'blob': info[2],
            'bytes': len(raw), 'sha256': sha(raw)}


evidence = load(RUN, RP + 'EVIDENCE.json')
summary = load(RUN, RP + 'SUMMARY.json')
seal = load(RUN, RP + 'RESULT-SEAL.json')
observations = load(DIAG, DP + 'OBSERVATIONS.json')
author_fail = load(DIAG, DP + 'FAILURES.json')
author_skip = load(DIAG, DP + 'SKIPS.json')
author_groups = load(DIAG, DP + 'GROUPS.json')
author_bindings = load(DIAG, DP + 'BINDINGS.json')
prior_tap = load(RUN, RP + 'TAP-NONPASSING.json')
assert len(evidence['artifacts']) == 928
assert len({row['artifact'] for row in evidence['artifacts']}) == 928
assert sum(row['rawBytes'] for row in evidence['artifacts']) == 114734734
assert sum(row['rawBytes'] for row in evidence['artifacts']) <= 128 * 1024 * 1024
assert sum(row['gzipBytes'] for row in evidence['artifacts']) <= 32 * 1024 * 1024
assert evidence['rawRoots'] == {
    'inner': '/tmp/full-gate-unified76-f5-historical-h11-20260828-r3',
    'outer': '/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-KRlFdr'}
selected = {}
capture_checks = []
select = {'inner/REPORT.json', 'inner/SETUP-COMPLETE.json', 'inner/canonical.stdout',
          'inner/benchmark-types.stderr', 'outer/REPORT.json'}
for entry in evidence['artifacts']:
    assert entry['artifact'].startswith(RP + 'raw-v1/')
    encoded = blob(RUN, entry['artifact'])
    assert sha(encoded) == entry['encodedSha256']
    compressed = base64.b64decode(b''.join(encoded.split()), validate=True)
    assert len(compressed) == entry['gzipBytes']
    assert sha(compressed) == entry['compressedSha256']
    key = entry['role'] + '/' + entry['path']
    kept = bytearray() if key in select else None
    digest = hashlib.sha256()
    size = 0
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as decoder:
        while chunk := decoder.read(CHUNK):
            size += len(chunk)
            assert size <= entry['rawBytes'] <= LIMIT
            digest.update(chunk)
            if kept is not None:
                kept.extend(chunk)
    assert size == entry['rawBytes'] and digest.hexdigest() == entry['sha256']
    original = safe_path(evidence['rawRoots'][entry['role']], entry['path'])
    observed = original.lstat()
    assert stat.S_ISREG(observed.st_mode) and stat.S_IMODE(observed.st_mode) == entry['mode']
    with original.open('rb') as file:
        assert stream_hash(file) == (entry['rawBytes'], entry['sha256'])
    capture_checks.append({'key': key, 'artifact': entry['artifact'], 'bytes': size,
                           'sha256': digest.hexdigest(), 'encodedSha256': sha(encoded),
                           'gzipSha256': sha(compressed), 'retainedBytesMatch': True})
    if kept is not None:
        selected[key] = bytes(kept)
for entry in seal['files']:
    raw = blob(RUN, entry['path'])
    assert len(raw) == entry['bytes'] and sha(raw) == entry['sha256']
for entry in author_bindings['files']:
    raw = blob(DIAG, entry['path'])
    assert sha(raw) == entry['sha256']

report = json.loads(selected['inner/REPORT.json'])
outer = json.loads(selected['outer/REPORT.json'])
packet = load('69f5cc1b05484c9d0836edf77bfbbbfb46145383', BASE + 'release-packet-v4-qualified-h11/PACKET.json')
receipt = load(RUN, RP + 'ROOT-RECEIPT.json')
authorization = git('rev-parse', summary['authorizationCommit']).decode().strip()
assert blob(authorization, RP + 'ROOT-RECEIPT.json') == blob(RUN, RP + 'ROOT-RECEIPT.json')
driver = load(SOURCE, SP + 'DRIVER.json')
assert normalized(driver) == report['driverSha256'] == summary['driverSha256']
assert report['candidate'] == PRODUCT == receipt['candidate']
assert normalized(packet) == receipt['packetSha256']
shipping = []
for entry in author_bindings['shipping']:
    info = metadata(SOURCE, entry['path'])
    assert info['sha256'] == entry['sha256'] and info['mode'] == '100644'
    shipping.append(info)
assert len(shipping) == 41
source_bindings = []
for entry in observations['sourceBindings']:
    info = metadata(PRODUCT, entry['path'])
    assert info['sha256'] == entry['sha256'] and info['bytes'] == entry['bytes']
    assert info['blob'] == entry['gitBlob'] and int(info['mode'], 8) & 511 == entry['mode']
    source_bindings.append(info)

raw_tap = selected['inner/canonical.stdout']
lines = raw_tap.decode('utf-8', errors='strict').split('\n')
positions = []
offset = 0
for line in lines:
    positions.append(offset)
    offset += len(line.encode()) + 1
parsed = []
pending_names = {}
diagnostic_until = -1
footer = {}
for index, text in enumerate(lines):
    text = text.removesuffix('\r')
    if index <= diagnostic_until:
        continue
    footer_match = re.fullmatch(r'# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)', text)
    if footer_match:
        footer[footer_match[1]] = float(footer_match[2]) if '.' in footer_match[2] else int(footer_match[2])
    subtest = re.fullmatch(r'( *)# Subtest: (.*)', text)
    if subtest:
        depth = len(subtest[1])
        pending_names = {indent: name for indent, name in pending_names.items() if indent < depth}
        pending_names[depth] = subtest[2]
    match = re.fullmatch(r'( *)(ok|not ok) (\d+) - (.*)', text)
    if not match:
        continue
    indent = len(match[1])
    end = index + 1
    while end < len(lines) and (not lines[end].strip() or len(lines[end]) - len(lines[end].lstrip(' ')) > indent):
        end += 1
    detail = '\n'.join(line.removesuffix('\r') for line in lines[index + 1:end])
    fields = {}
    for field in ['type', 'location', 'failureType', 'error', 'code']:
        field_match = re.search(r'^\s+' + field + r': (.*)$', detail, re.MULTILINE)
        fields[field] = field_match[1].strip("'\"") if field_match else None
    status = 'pass' if match[2] == 'ok' else 'fail'
    directive = re.search(r' # (SKIP|TODO)\b(.*)$', match[4], re.IGNORECASE)
    if directive:
        status = 'skipped' if directive[1].upper() == 'SKIP' else 'todo'
    elif fields['failureType'] in ['cancelledByParent', 'testTimeoutFailure', 'testAborted']:
        status = 'cancelled'
    if index + 1 < len(lines) and lines[index + 1].strip() == '---':
        diagnostic_until = end - 1
    parsed.append({'id': 'tap-line-' + str(index + 1), 'line': index + 1,
                   'byteOffset': positions[index], 'indent': indent, 'ordinal': int(match[3]),
                   'name': match[4], 'parents': [name for depth, name in sorted(pending_names.items()) if depth < indent],
                   'status': status, 'detail': detail, **fields})
counts = collections.Counter(row['status'] for row in parsed if row['type'] != 'suite')
assert len(parsed) == footer['tests'] == 19564
assert counts == collections.Counter({'pass': 19425, 'fail': 132, 'skipped': 7})
assert all(counts[key] == footer[key] for key in ['pass', 'fail', 'skipped', 'todo', 'cancelled'])
original = {row['id']: row for group in prior_tap['groups'] for row in group['cases']}
author = {row['id']: row for row in author_fail + author_skip}
assert len(author) == len(original) == 139
crosswalk = []
for row in parsed:
    if row['status'] == 'pass':
        continue
    old = original[row['id']]
    declared = author[row['id']]
    assert row['name'] == old['name'] == declared['name']
    assert row['status'] == old['status'] == declared['status']
    assert row['line'] == declared['tapLine'] and row['ordinal'] == old['ordinal']
    assert row['detail'] == old['detail']
    assert sha(row['detail'].encode()) == declared['originalDetailSha256']
    assert row['location'] == old['location']
    crosswalk.append({key: value for key, value in row.items() if key != 'detail'} | {
        'sourcePath': declared['sourcePath'], 'sourceCommit': PRODUCT,
        'detailSha256': sha(row['detail'].encode()), 'rawArtifact': RP + 'raw-v1/inner/canonical.stdout.gz.base64',
        'rawSha256': sha(raw_tap), 'authorGroup': declared.get('group'),
        'sourceHash': next(info['sha256'] for info in source_bindings if info['path'] == declared['sourcePath']),
        'classification': 'PENDING_SOURCE_REVIEW', 'reason': 'Exact raw/index match; root cause assessed separately.'})
assert set(author) == {row['id'] for row in crosswalk}
group_counts = collections.Counter(row['authorGroup'] for row in crosswalk if row['status'] == 'fail')
assert group_counts == {row['id']: row['expectedFailures'] for row in author_groups}

added = observations['addedEntries']
assert len(added) == len({row['path'] for row in added}) == 286
assert sorted(row['path'] for row in added) == sorted(summary['integrityHalt']['paths'])
error_paths = re.findall(r"\+\s+path: '([^']+)'", report['error']['message'])
assert sorted(error_paths) == sorted(row['path'] for row in added)
root = observations['retainedRoot']
assert root == '/private/tmp/unified76-os-write-9hZxpj/tmp/unified76-execution-FQM0aw/source'
fs_rows = []
for entry in added:
    assert entry['path'].startswith(('tests/commands/table-text-stress/', 'tests/fs/mount/identity-authority-review/implementation/'))
    target = safe_path(root, entry['path'])
    info = target.lstat()
    assert stat.S_IMODE(info.st_mode) == entry['mode']
    if entry['kind'] == 'directory':
        assert stat.S_ISDIR(info.st_mode) and sorted(os.listdir(target)) == entry['children']
    else:
        assert entry['kind'] == 'file' and stat.S_ISREG(info.st_mode)
        assert info.st_size == entry['bytes']
        assert target.name in ['left', 'right', 'sentinel']
        with target.open('rb') as file:
            assert stream_hash(file) == (entry['bytes'], entry['sha256'])
    fs_rows.append(entry | {'independentMetadataMatch': True})
assert collections.Counter(row['kind'] for row in added) == {'directory': 73, 'file': 213}
native_roots = [row for row in added if row['kind'] == 'directory' and '/.native-' in row['path']]
assert len(native_roots) == 71 and all(row['children'] == ['left', 'right', 'sentinel'] for row in native_roots)
corpus = load(PRODUCT, 'tests/commands/table-text-stress/frozen-corpus.json')
assert len(corpus) == 71
compatibilities = []
for entry in native_roots:
    directory = safe_path(root, entry['path'])
    assert (directory / 'sentinel').read_bytes() == b'independent-table-text-owned'
    contents = {name: (directory / name).read_bytes().hex() for name in ['left', 'right']}
    matches = [index for index, case in enumerate(corpus) if case['fixture']['files'] == contents]
    assert matches
    declared = next(row for row in observations['nativeRoots'] if row['path'] == entry['path'])
    assert matches == [row['index'] for row in declared['compatibleInputRows']]
    compatibilities.append({'path': entry['path'], 'compatibleCorpusRows': matches,
                            'uniqueInvocationOrPidProved': False})

record = {
    'schema': 1, 'scope': 'SOURCE_DATA_ONLY_NO_SUBJECT_EXECUTION',
    'recordedAt': datetime.datetime.now().astimezone().isoformat(),
    'diagnosis': DIAG, 'run': RUN, 'authorization': authorization, 'authorizationConsumed': True,
    'shippingSource': SOURCE, 'candidate': PRODUCT, 'packet': seal['packet'],
    'driverSha256': normalized(driver), 'profileSha256': report['profileSha256'],
    'expectedPackageSha256': receipt['packageSha256'], 'receipt': metadata(RUN, RP + 'ROOT-RECEIPT.json'),
    'captureIndex': metadata(RUN, RP + 'EVIDENCE.json'), 'resultSeal': metadata(RUN, RP + 'RESULT-SEAL.json'),
    'captures': capture_checks, 'rawBytes': sum(row['bytes'] for row in capture_checks),
    'shipping': shipping, 'sourceBindings': source_bindings,
    'tapFooter': footer, 'parsedStatuses': dict(counts), 'resultRecords': len(parsed),
    'topLevelRecords': sum(row['indent'] == 0 for row in parsed),
    'nestedRecords': sum(row['indent'] != 0 for row in parsed),
    'groupCounts': dict(group_counts), 'phaseOutcomes': summary['phaseOutcomes'],
    'closure': summary['closure'], 'privateCapturedOnly': summary['private'],
    'benchmarkStderrSha256': sha(selected['inner/benchmark-types.stderr']),
    'benchmarkCheckerExecuted': False, 'benchmarkPhaseStartedStatus1': True,
    'noPrivateSourceRead': True, 'retainedRootsModified': False, 'newExecutionCount': 0,
    'limits': {'chunkBytes': CHUNK, 'fileBytes': LIMIT, 'totalRawBytes': 134217728, 'captures': 928},
    'parserSha256': sha((REPO / OWN / 'verify-data.py').read_bytes())}
files = {'BINDINGS.json': record, 'CROSSWALK.json': crosswalk,
         'FILESYSTEM.json': {'added': fs_rows, 'counts': {'entries': 286, 'directories': 73, 'files': 213, 'symlinks': 0},
                             'nativeRoots': compatibilities, 'noCleanupAuthorizedOrPerformed': True}}
patch = '*** Begin Patch\n'
for name, value in files.items():
    assert not (REPO / OWN / name).exists()
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'
    patch += '*** Add File: ' + OWN + name + '\n+' + text
patch += '*** End Patch\n'
subprocess.run(['apply_patch'], input=patch.encode(), cwd=REPO, check=True, timeout=30)
print(json.dumps({'captures': len(capture_checks), 'rawBytes': record['rawBytes'], 'statuses': dict(counts),
                  'crosswalk': len(crosswalk), 'sourceBindings': len(source_bindings), 'shipping': len(shipping),
                  'addedEntries': len(fs_rows), 'groupCounts': dict(group_counts)}))
