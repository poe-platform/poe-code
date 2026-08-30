from pathlib import Path
import base64
import hashlib
import json
import os
import stat
import subprocess
import sys
import time
import traceback
import zlib

ROOT = Path('/Users/kjopek/Workspace/safe-bash')
OWN = Path(__file__).parent
AUTHOR = 'tests/integration/git-public-20260829/'
HANDOFF = '4ade014242d6b6ceac254c41f53b46ca00102fbe'
GIT = '/usr/bin/git'
CAPTURE = OWN / 'capture-05-authenticate'
CAPTURE.mkdir()
STDOUT = open(CAPTURE / 'stdout.raw', 'xb')
STDERR = open(CAPTURE / 'stderr.raw', 'xb')
EVENTS = open(CAPTURE / 'events.jsonl', 'xb')


def event(value):
    EVENTS.write((json.dumps(value) + '\n').encode())
    EVENTS.flush()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def object_hash(kind, value):
    return hashlib.sha1(kind.encode() + b' ' + str(len(value)).encode() + b'\0' + value).hexdigest()


def local(name, maximum=20 * 1024 * 1024):
    target = ROOT / name
    metadata = target.lstat()
    assert stat.S_ISREG(metadata.st_mode) and metadata.st_size <= maximum
    assert target.name != 'AGENTS.md'
    value = target.read_bytes()
    event({'read': name, 'bytes': len(value), 'sha256': digest(value)})
    return value


def publish(name, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    with open(OWN / name, 'xb') as stream:
        stream.write(data)


def stream_hash(filename):
    result = hashlib.sha256()
    with open(filename, 'rb') as stream:
        while chunk := stream.read(65536):
            result.update(chunk)
    return result.hexdigest()


def tar_members(encoded, expected):
    archive = base64.b64decode(encoded.strip(), validate=True)
    assert digest(archive) == expected
    decoder = zlib.decompressobj(31)
    contents = decoder.decompress(archive, 64 * 1024 * 1024)
    assert decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail
    rows = []
    payloads = {}
    offset = 0
    while contents[offset:offset + 512] != bytes(512):
        header = contents[offset:offset + 512]
        assert len(header) == 512
        octal = lambda value: int(value.rstrip(b'\0 ').lstrip(b' ') or b'0', 8)
        expected_sum = octal(header[148:156])
        assert sum(header[:148]) + 256 + sum(header[156:]) == expected_sum
        name = header[:100].split(b'\0')[0].decode('utf-8')
        prefix = header[345:500].split(b'\0')[0]
        assert not prefix and header[156] in (0, 48)
        assert name.startswith('package/') and all(part not in ('', '.', '..', 'AGENTS.md') for part in name.split('/'))
        relative = name[8:]
        assert relative not in payloads
        size = octal(header[124:136])
        value = contents[offset + 512:offset + 512 + size]
        assert len(value) == size
        rows.append({'path': relative, 'mode': octal(header[100:108]), 'bytes': size, 'sha256': digest(value)})
        payloads[relative] = value
        offset += 512 + ((size + 511) // 512) * 512
        assert offset <= len(contents)
    assert len(contents) - offset >= 1024 and not any(contents[offset:])
    return rows, payloads


def main():
    event({'start': time.time_ns(), 'pid': os.getpid(), 'role': 'SOURCE_DATA_ONLY', 'reservedSlotsThroughThisHelper': 13})
    source_bytes = local(AUTHOR + 'SOURCE.json')
    assert digest(source_bytes) == '14a2a6a50d7748b677c4cc1261d6f69a411c1c21926c7acd884c86f2077e9450'
    source = json.loads(source_bytes)
    executor_bytes = local(AUTHOR + 'EXECUTOR.json')
    assert digest(executor_bytes) == '6ba1f4faedbd70e76d563147bfe4e1685e71e567b7f0a4f401cb73d0fbb791a5'
    executor = json.loads(executor_bytes)
    base_name = 'tests/integration/apply-patch-public-20260829/SOURCE-v2.json'
    base_bytes = local(base_name)
    baseline = json.loads(base_bytes)
    assert baseline['computedTree'] == '7fde32264d757ef856acf3ae92c8581b4a294341'
    module_name = 'tests/commands/git-pack-author-20260828/s01-v3/SOURCE.json'
    module_bytes = local(module_name)
    module = json.loads(module_bytes)
    extra_names = [AUTHOR + name for name in ['HANDOFF.md', 'SOURCE.json', 'EXECUTOR.json', 'run.mjs', 'prepare.mjs', 'PRESEAL.json', 'm1a.mjs', 'm1a-public-v2.mjs', 'results-v1/PACKAGE.tgz.base64']]
    extra_names += [base_name, module_name, 'tests/integration/apply-patch-public-independent-20260829/PACKAGE.tgz.base64']
    requests = {}
    for name in extra_names + [row['path'] for row in executor['files']]:
        requests[HANDOFF + ':' + name] = local(name)
    requests['2764c054:' + AUTHOR + 'm1a-public-v2.mjs'] = local(AUTHOR + 'm1a-public-v2.mjs')
    for row in source['inputs'] + source['fixtures'] + source['documentation']:
        assert row['mode'] == '100644' and row['path'].split('/')[-1] != 'AGENTS.md'
        requests[row['blob']] = None
        if row.get('revision'):
            requests[row['revision'] + ':' + row['path']] = None
    git_hash = stream_hash(GIT)
    assert git_hash == '12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba'
    args = [GIT, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', 'cat-file', '--batch']
    event({'enrollBeforeSpawn': True, 'role': 'development-metadata-only', 'args': args, 'gitSha256': git_hash})
    child = subprocess.Popen(args, cwd=ROOT, env={'PATH': '/usr/bin:/bin', 'GIT_OPTIONAL_LOCKS': '0'}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    event({'ownedPid': child.pid})
    try:
        output, errors = child.communicate(('\n'.join(requests) + '\n').encode(), timeout=30)
    except BaseException:
        child.kill()
        output, errors = child.communicate(timeout=5)
        raise
    finally:
        event({'childReturncode': child.returncode})
    with open(CAPTURE / 'git.stdout.raw', 'xb') as stream:
        stream.write(output)
    with open(CAPTURE / 'git.stderr.raw', 'xb') as stream:
        stream.write(errors)
    assert child.returncode == 0 and not errors and len(output) < 32 * 1024 * 1024
    offset = 0
    objects = {}
    for request, expected in requests.items():
        end = output.index(b'\n', offset)
        fields = output[offset:end].decode().split(' ')
        assert len(fields) == 3 and fields[1] == 'blob', (request, fields)
        oid, kind, size = fields[0], fields[1], int(fields[2])
        value = output[end + 1:end + 1 + size]
        assert output[end + 1 + size:end + 2 + size] == b'\n' and object_hash(kind, value) == oid
        if expected is not None:
            assert value == expected, request
        objects[request] = value
        offset = end + 2 + size
    assert offset == len(output)
    for row in source['inputs'] + source['fixtures'] + source['documentation']:
        value = objects[row['blob']]
        assert len(value) == row['bytes'] and digest(value) == row['sha256'], row['path']
        if row.get('revision'):
            assert value == objects[row['revision'] + ':' + row['path']]
    trees = {}
    for collection in [baseline, source]:
        for key in ['ancestorTrees', 'fetchedTrees', 'reconstructedTrees']:
            for row in collection.get(key, []):
                raw = base64.b64decode(row['base64'])
                assert object_hash('tree', raw) == row['oid']
                entries = {}
                position = 0
                while position < len(raw):
                    space = raw.index(b' ', position)
                    zero = raw.index(b'\0', space)
                    mode = raw[position:space].decode()
                    name = raw[space + 1:zero].decode()
                    assert name not in entries
                    entries[name] = (mode, raw[zero + 1:zero + 21].hex())
                    position = zero + 21
                trees[row['oid']] = entries
    def lookup(tree, pathname):
        parts = pathname.split('/')
        for component in parts[:-1]:
            mode, tree = trees[tree][component]
            assert mode == '40000'
        return trees[tree][parts[-1]]
    for row in source['inputs'] + source['fixtures'] + source['documentation']:
        assert lookup(source['computedTree'], row['path']) == (row['mode'], row['blob'])
    differences = []
    def compare(previous, current, prefix=''):
        if previous == current:
            return
        before = trees.get(previous, {}) if previous else {}
        after = trees.get(current, {}) if current else {}
        assert previous is None or previous in trees
        assert current is None or current in trees
        for name in sorted(set(before) | set(after)):
            left, right = before.get(name), after.get(name)
            if left == right:
                continue
            relative = prefix + name
            if (left and left[0] == '40000') or (right and right[0] == '40000'):
                compare(left[1] if left else None, right[1] if right else None, relative + '/')
            else:
                differences.append({'path': relative, 'before': left, 'after': right})
    compare(baseline['computedTree'], source['computedTree'])
    expected_changes = {row['path'] for row in source['module'] + source['publicRows'] + source['fixtures'] + source['documentation']}
    assert {row['path'] for row in differences} == expected_changes
    assert len(source['inputs']) == 292 and len(source['module']) == 14
    accepted_module = {row['path']: row for row in module['inputs']}
    for row in source['module']:
        for key in ['mode', 'blob', 'bytes', 'sha256']:
            assert row[key] == accepted_module[row['path']][key]
    baseline_inputs = {row['path']: row for row in baseline['inputs']}
    build_changes = [row['path'] for row in source['inputs'] if row['path'] in baseline_inputs and row['sha256'] != baseline_inputs[row['path']]['sha256']]
    assert sorted(build_changes) == ['README.md', 'package.json', 'src/index.ts', 'src/plugins/index.ts']
    old_rows, old_files = tar_members(requests[HANDOFF + ':tests/integration/apply-patch-public-independent-20260829/PACKAGE.tgz.base64'], '643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd')
    rows, files = tar_members(requests[HANDOFF + ':' + AUTHOR + 'results-v1/PACKAGE.tgz.base64'], '4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156')
    assert len(old_rows) == 898 and len(rows) == 950
    old_map, current_map = {row['path']: row for row in old_rows}, {row['path']: row for row in rows}
    added = sorted(set(current_map) - set(old_map))
    removed = sorted(set(old_map) - set(current_map))
    changed = sorted(name for name in set(old_map) & set(current_map) if old_map[name] != current_map[name])
    assert len(added) == 52 and all(name.startswith('dist/commands/git/') for name in added) and not removed
    assert changed == sorted(['README.md', 'package.json'] + [base + suffix for base in ['dist/index', 'dist/plugins/index'] for suffix in ['.js', '.js.map', '.d.ts', '.d.ts.map']])
    package = json.loads(files['package.json'])
    assert not package.get('dependencies')
    assert package['exports']['./commands/git'] == {'types': './dist/commands/git/index.d.ts', 'import': './dist/commands/git/index.js'}
    original = objects[HANDOFF + ':' + AUTHOR + 'm1a.mjs'].decode()
    revised = objects['2764c054:' + AUTHOR + 'm1a-public-v2.mjs'].decode()
    before = next(line for line in original.splitlines() if line.startswith("await record('PUBLIC-NEGATIVE'"))
    after = next(line for line in revised.splitlines() if line.startswith("await record('PUBLIC-REGISTERED'"))
    assert revised.replace(after, before) == original
    fixture_delta = {'before': before, 'after': after, 'originalSha256': digest(original.encode()), 'revisedSha256': digest(revised.encode()), 'onlyOneRowChanged': True, 'versionCommit': '2764c054', 'runtimeExecuted': False}
    publish('AUTHENTICATION.json', {'role': 'SOURCE_DATA_ONLY', 'candidate': source['computedTree'], 'sourceSha256': digest(source_bytes), 'requests': len(requests), 'inputs': 292, 'moduleMembersUnchanged': 14, 'treeDifferences': differences, 'buildChanges': build_changes, 'package': {'members': rows, 'sha256': '4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156', 'added': added, 'changed': changed, 'removed': removed, 'unchangedCommon': 888}, 'fixtureV2': fixture_delta, 'toolsReceived': source['toolBindings'], 'productExecutions': 0})
    result = {'sourceInputs': 292, 'packageMembers': 950, 'unchangedGitModuleMembers': 14, 'treeDifferences': len(differences), 'addedPackageMembers': 52, 'changedPackageMembers': 10, 'fixtureV2OneRow': True, 'productExecutions': 0}
    STDOUT.write((json.dumps(result) + '\n').encode())
    STDOUT.flush()
    print(json.dumps(result))
    event({'terminal': 'natural', 'result': result})


try:
    main()
except BaseException as error:
    message = traceback.format_exc()
    STDERR.write(message.encode())
    STDERR.flush()
    event({'terminal': 'failure', 'reasonPresent': True, 'type': type(error).__name__, 'reason': str(error)})
    print(message, file=sys.stderr)
    raise
finally:
    for stream in [STDOUT, STDERR, EVENTS]:
        stream.close()
