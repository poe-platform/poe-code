import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
import time

ROOT = Path(__file__).resolve().parent
OLD = ROOT.parent / 'm1a-type-continuation-v13'
REPO = Path('/Users/kjopek/Workspace/safe-bash')
START = time.monotonic_ns()
sha = lambda value: hashlib.sha256(value).hexdigest()
read = lambda path: json.loads(path.read_bytes())
seal = read(OLD / 'PRESEAL.json')
bindings = read(OLD / 'INPUT-BINDINGS.json')
old_work = seal['work']
new_work = str(ROOT / 'work')
assert not (ROOT / 'PRESEAL.json').exists()
records = subprocess.check_output(['git', 'ls-tree', '-r', '-z', 'dc380b18d38e72afa7083adcb139fc6f4a28e293', '--', str(OLD.relative_to(REPO))], cwd=REPO)
for record in records.split(b'\0'):
    if not record:
        continue
    head, path = record.split(b'\t', 1)
    mode, kind, oid = head.split()
    physical = REPO / path.decode()
    assert kind == b'blob' and not physical.is_symlink()
    body = physical.read_bytes()
    assert hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest().encode() == oid
    assert stat.S_IMODE(physical.stat().st_mode) == int(mode, 8) & 4095
for entry in seal['files']:
    assert sha(Path(entry['path']).read_bytes()) == entry['sha256']

package_path = Path(read(ROOT.parent / 'm1a-review-v5/PRESEAL.json')['packagePath'])
package_bytes = base64.b64decode(package_path.read_bytes(), validate=False)
assert sha(package_bytes) == seal['packageSha256']
contents = {}
with tarfile.open(fileobj=io.BytesIO(package_bytes), mode='r:gz') as archive:
    entries = archive.getmembers()
    assert len(entries) == 898
    for entry in entries:
        assert entry.isfile() and entry.name.startswith('package/')
        name = entry.name.removeprefix('package/')
        assert name not in contents and '..' not in Path(name).parts and not name.startswith('/')
        body = archive.extractfile(entry).read()
        witness = next(row for row in bindings['packageMembers'] if row['path'] == name)
        assert sha(body) == witness['sha256'] and len(body) == witness['bytes'] and entry.mode == witness['mode']
        contents['package/' + name] = body

archive_path = ROOT.parent / 'm1a-continuation-v12/WORKING.json.gz.base64'
archive_artifact = archive_path.read_bytes()
assert sha(archive_artifact) == bindings['workingArchive']['artifactSha256']
compressed = base64.b64decode(archive_artifact)
assert sha(compressed) == bindings['workingArchive']['gzipSha256']
decoded = gzip.decompress(compressed)
assert sha(decoded) == bindings['workingArchive']['jsonSha256']
archive_rows = {row['path']: row for row in json.loads(decoded)['rows']}
for entry in bindings['selectedWorking']:
    source = archive_rows[entry['path']]
    assert all(source[key] == entry[key] for key in ['type', 'mode', 'bytes', 'sha256'])
    body = base64.b64decode(source['base64'])
    assert sha(body) == entry['sha256'] and len(body) == entry['bytes']
    contents[entry['path']] = body

expected_work = next(row for row in bindings['censuses'] if row['root'] == old_work)
work_rows = [{**row, 'path': new_work + row['path'][len(old_work):]} for row in expected_work['rows']]
Path(new_work).mkdir(exist_ok=True)
for row in sorted(work_rows, key=lambda row: (len(Path(row['path']).parts), row['path'])):
    path = Path(row['path'])
    assert path.is_relative_to(new_work) and path.name != 'AGENTS.md'
    if path.exists():
        assert not path.is_symlink() and stat.S_IMODE(path.stat().st_mode) == row['mode']
        if row['type'] == 'directory':
            assert path.is_dir()
        else:
            assert path.is_file() and sha(path.read_bytes()) == row['sha256'] and path.stat().st_size == row['bytes']
        continue
    if row['type'] == 'directory':
        path.mkdir(exist_ok=False)
    else:
        relative = str(path.relative_to(new_work))
        body = contents[relative]
        assert sha(body) == row['sha256'] and len(body) == row['bytes']
        with path.open('xb') as handle:
            handle.write(body)
    os.chmod(path, row['mode'])

def census(directory):
    rows = []
    for path in directory.rglob('*'):
        assert not path.is_symlink()
        info = path.stat()
        row = {'path': str(path), 'type': 'directory' if path.is_dir() else 'file', 'mode': stat.S_IMODE(info.st_mode)}
        if row['type'] == 'file':
            row.update(bytes=info.st_size, sha256=sha(path.read_bytes()))
        rows.append(row)
    return sorted(rows, key=lambda row: row['path'].encode('utf8'))

def canonical(rows):
    tuples = [[row['path'].encode('utf8').hex(), row['type'], row['mode']] + ([row['bytes'], row['sha256']] if row['type'] == 'file' else []) for row in sorted(rows, key=lambda row: row['path'].encode('utf8'))]
    return b'M1A-CENSUS-v12\0' + json.dumps(tuples, separators=(',', ':')).encode() + b'\n'

assert census(Path(new_work)) == sorted(work_rows, key=lambda row: row['path'].encode('utf8'))
for row in bindings['routes']:
    if row['physical'].startswith(old_work + '/'):
        row['physical'] = new_work + row['physical'][len(old_work):]
for row in bindings['censuses']:
    if row['root'] == old_work:
        row.update(root=new_work, rows=work_rows, entries=len(work_rows), canonicalSha256=sha(canonical(work_rows)))
    else:
        assert sha(canonical(census(Path(row['root'])))) == row['canonicalSha256']
old_rows = census(OLD)
bindings['censuses'].append(dict(root=str(OLD), rows=old_rows, entries=len(old_rows), canonicalSha256=sha(canonical(old_rows))))

compiler = (OLD / 'compiler.mjs').read_text()
assert compiler.count('  assert.equal(emitted.emitSkipped, true);\n') == 1
compiler = compiler.replace('  assert.equal(emitted.emitSkipped, true);\n', '')
assert compiler.count('networkAttempts, noEmit: true') == 1
compiler = compiler.replace('networkAttempts, noEmit: true', 'networkAttempts, noEmit: true, emitSkipped: emitted.emitSkipped')
outer = (OLD / 'outer.mjs').read_text()
assert outer.count('    const report = JSON.parse(output.stdout);') == 1
outer = outer.replace('    const report = JSON.parse(output.stdout);', '''    let report;
    try { report = JSON.parse(output.stdout); }
    catch (error) {
      failure = { message: 'compiler wrapper did not publish a valid report', primary: { role: role.id, exit: output.row.close, stderr: output.stderr }, secondary: { message: error.message } };
      event({ kind: 'secondary-report-parse-failure', failure });
      throw error;
    }''')
outer = outer.replace('  failure = { message: error.message, stack: error.stack };', '  failure ??= { message: error.message, stack: error.stack };')
updates = {'compiler.mjs': compiler, 'outer.mjs': outer, 'guard.mjs': (OLD / 'guard.mjs').read_text(), 'EXPECTATION.json': (OLD / 'EXPECTATION.json').read_text(), 'INPUT-BINDINGS.json': json.dumps(bindings, indent=2) + '\n'}
updates['CHANGE.json'] = json.dumps({'priorPreseal': '1d981b9f0c4874bc129691d8ef0c2781b341da40', 'priorEvidence': 'dc380b18d38e72afa7083adcb139fc6f4a28e293', 'candidate': seal['candidate'], 'changes': ['remove only emitSkipped acceptance assertion', 'record actual emitSkipped without accepting/rejecting its value', 'retain raw wrapper failure as primary and empty/invalid JSON as secondary'], 'unchanged': ['compiler/options/noEmit=true', 'both consumer bytes and logical paths', 'exact TS2724 diagnostic and related information', 'source/package/declarations', 'guard implementation'], 'scratchRelocation': {'from': old_work, 'to': new_work}, 'proof': 'CompilerHost refuses output writes; complete work/source/tool censuses verify no emitted files, membership or content changes', 'startedPreparation': '2026-08-28T22:09:49Z', 'preparationScriptMs': (time.monotonic_ns()-START)/1e6, 'execution': 'one positive plus negative, no retry/build/npm/runtime'}, indent=2) + '\n'
patch = '*** Begin Patch\n'
for name, text in updates.items():
    patch += '*** Add File: ' + str(ROOT / name) + '\n' + ''.join('+' + line + '\n' for line in text.splitlines())
patch += '*** End Patch\n'
subprocess.run(['apply_patch'], input=patch, text=True, check=True)
seal.update(schema='M1A-v14-exact-negative-compiler', priorEvidence='dc380b18d38e72afa7083adcb139fc6f4a28e293', priorPreseal='1d981b9f0c4874bc129691d8ef0c2781b341da40', work=new_work, command=[seal['node']['path'], str(ROOT/'outer.mjs')])
seal['files'] = [dict(path=str(path), bytes=path.stat().st_size, sha256=sha(path.read_bytes())) for path in sorted(ROOT.iterdir()) if path.is_file()]
seal['versionedOnlyPredicate'] = 'emitSkipped is observation only; noEmit/options/diagnostics and no-output integrity remain strict'
text = json.dumps(seal, indent=2) + '\n'
subprocess.run(['apply_patch'], input='*** Begin Patch\n*** Add File: ' + str(ROOT/'PRESEAL.json') + '\n' + ''.join('+'+line+'\n' for line in text.splitlines()) + '*** End Patch\n', text=True, check=True)
print(json.dumps({'presealSha256': sha((ROOT/'PRESEAL.json').read_bytes()), 'files': len(seal['files']), 'roles': [role['id'] for role in seal['roles']], 'workingEntries': len(work_rows), 'scriptMs': (time.monotonic_ns()-START)/1e6}))
