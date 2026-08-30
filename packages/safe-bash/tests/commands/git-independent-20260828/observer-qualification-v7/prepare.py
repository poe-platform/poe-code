import datetime
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
V6 = ROOT.with_name('observer-qualification-v6')
V5 = ROOT.with_name('m1a-review-v5')
SOURCE = '9885390fb11454fa194a3e60fdbef198dbfdf633'
V6_COMMIT = '0be0667e64510868f78c8a989fddcc3acfd10b94'
START = time.monotonic_ns()
metadata_commands = []


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*arguments):
    metadata_commands.append(['git', *arguments])
    return subprocess.check_output(['git', *arguments], cwd=REPO)


def put(name, value):
    with (ROOT / name).open('xb') as output:
        output.write((json.dumps(value, indent=2) + '\n').encode())


def inventory(directory):
    rows = []
    for path in sorted(directory.rglob('*')):
        assert not path.is_symlink()
        if path.is_dir():
            rows.append({'path': str(path), 'directory': True, 'bytes': 0})
        else:
            assert path.is_file()
            raw = path.read_bytes()
            rows.append({'path': str(path), 'sha256': sha(raw), 'bytes': len(raw)})
    return rows


assert REPO == Path('/Users/kjopek/Workspace/safe-bash')
assert not (ROOT / 'PRESEAL.json').exists()
index = git('diff', '--cached', '--raw', '-z')
trees = []
for commit, directory in [('655cb37b97521558c4c90581b5b23fc6c3ad9bf2', V5), (V6_COMMIT, V6)]:
    stored_paths = []
    for entry in git('ls-tree', '-rz', commit, '--', str(directory.relative_to(REPO))).split(b'\0'):
        if not entry:
            continue
        metadata, raw_path = entry.split(b'\t', 1)
        mode, kind, oid = metadata.split()
        assert kind == b'blob' and mode == b'100644'
        path = REPO / raw_path.decode()
        raw = path.read_bytes()
        assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == oid.decode()
        stored_paths.append(str(path))
    rows = inventory(directory)
    assert sorted(row['path'] for row in rows if not row.get('directory')) == sorted(stored_paths)
    trees.append({'root': str(directory), 'commit': commit, 'rows': rows})
source = json.loads((V6 / 'SOURCE-DATA.json').read_bytes())
codec = git('show', SOURCE + ':src/commands/git/codec.ts')
blob_oid = git('rev-parse', SOURCE + ':src/commands/git/codec.ts').decode().strip()
assert codec.decode() == source['codec']['text']
assert sha(codec) == source['codec']['sha256']
assert hashlib.sha1(b'blob ' + str(len(codec)).encode() + b'\0' + codec).hexdigest() == blob_oid
start = codec.index(b'  const writer = async (): Promise<void> => {')
end = codec.index(b'\n  };\n  try {\n    written = writer();', start) + len(b'\n  };')
writer = codec[start:end].decode()
changes = [
    {'from': ': Promise<void>', 'to': '', 'count': 1},
    {'from': 'new Promise<void>', 'to': 'new Promise', 'count': 1},
    {'from': ': void', 'to': '', 'count': 2},
    {'from': 'error?: unknown', 'to': 'error', 'count': 1},
]
transformed = writer
for change in changes:
    assert transformed.count(change['from']) == change['count']
    transformed = transformed.replace(change['from'], change['to'])
error_listener = 'stream.on("error", error => { if (!hasCodecError) { hasCodecError = true; codecError = error; } });'
assert error_listener in codec.decode()
prefix = 'export function createWriter(session, compressed, codec, GitFailure) {\n  let codecError;\n  let hasCodecError = false;\n  ' + error_listener.replace('stream.on', 'codec.on') + '\n'
suffix = '\n  return writer;\n}\n'
surrogate = prefix + transformed + suffix
patch = '*** Begin Patch\n*** Add File: ' + str((ROOT / 'writer-surrogate.mjs').relative_to(REPO)) + '\n' + ''.join('+' + line + '\n' for line in surrogate.splitlines()) + '*** End Patch\n'
subprocess.run(['apply_patch'], input=patch, text=True, check=True, cwd=REPO)
assert (ROOT / 'writer-surrogate.mjs').read_bytes() == surrogate.encode()
put('CORRESPONDENCE.json', {
    'classification': 'authorized exact isolated writer only; no product module import/transpile/evaluation',
    'sourceCommit': SOURCE, 'sourcePath': 'src/commands/git/codec.ts', 'fullBlobOid': blob_oid,
    'fullBlobSha256': sha(codec), 'fullBlobBytes': len(codec),
    'writerStartByte': start, 'writerEndByteExclusive': end,
    'writerStartLine': codec[:start].count(b'\n') + 1, 'writerEndLineInclusive': codec[:end].count(b'\n') + 1,
    'writerSha256': sha(writer.encode()), 'writerBytes': len(writer.encode()), 'writerExactSourceData': writer,
    'transformations': changes, 'transformedWriterSha256': sha(transformed.encode()),
    'wrapperPrefix': prefix, 'wrapperSuffix': suffix, 'surrogateSha256': sha(surrogate.encode()),
    'errorListenerSource': error_listener, 'errorListenerSha256': sha(error_listener.encode()),
    'errorListenerTransformation': 'parameter receiver stream -> codec only',
    'parameterBindings': {'session': 'local no-op check and async step, no candidate Session, cancellation/budgets not qualified',
        'compressed': 'fresh independent small constant builtin zlib data',
        'codec': 'owned stream facade preserving once/removeListener/write/destroy semantics with observation',
        'GitFailure': 'injected Error subclass, status=128; no candidate class import'},
    'correspondence': ['all four writer type-only edits counted exactly; remaining body byte exact',
        'error listener installed before writer starts and records first error including separate boolean',
        'close fallback registered before write; removed by finish; destroyed shortcut preserved',
        'finish rejects iff reason !== undefined; actual Promise idempotence unchanged',
        'write callback normalizes nullish error exactly as source; end called without invented callback',
        'raw callback route distinct from native Promise settlement recorded by then/rejection',
        'native pool or resource freedom not inferred from destroyed/closed/private handles'],
})
put('SOURCE-DATA.json', source)
diff = ''.join(''.join(difflib.unified_diff((V6 / name).read_text().splitlines(True), (ROOT / name).read_text().splitlines(True),
                    fromfile='immutable-v6/' + name, tofile='new-v7/' + name))
               for name in ['observer.mjs', 'worker.mjs', 'run.mjs', 'CONTROLS.json'])
with (ROOT / 'DIFF-V6.patch').open('x') as output:
    output.write(diff)
controls = json.loads((ROOT / 'CONTROLS.json').read_bytes())
prior = json.loads((V6 / 'CONTROLS.json').read_bytes())
assert controls['real'] == prior['real']
assert controls['synthetic'][:10] == prior['synthetic']
assert controls['data'] == prior['data']
assert len(controls['synthetic']) == 11
node = json.loads((V6 / 'PRESEAL.json').read_bytes())['node']
assert sha(Path(node['path']).read_bytes()) == node['sha256']
files = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
         for path in sorted(ROOT.iterdir()) if path.is_file()]
assert {entry['path'] for entry in files} == {'observer.mjs', 'worker.mjs', 'run.mjs', 'CONTROLS.json', 'prepare.py',
    'CRITERION.md', 'writer-surrogate.mjs', 'CORRESPONDENCE.json', 'SOURCE-DATA.json', 'DIFF-V6.patch'}
put('PRESEAL.json', {
    'schema': 'observer-v7-preseal', 'node': node, 'files': files, 'oldTrees': trees,
    'v6PresealCommit': '65b73e44d5641b5472e2b96000d51d5b6f81f7ff', 'v6EvidenceCommit': V6_COMMIT,
    'sourceCorrespondence': {'sourceCommit': SOURCE, 'blobOid': blob_oid, 'blobSha256': sha(codec), 'writerSha256': sha(writer.encode()), 'surrogateSha256': sha(surrogate.encode())},
    'firstReliablePreparationWall': '2026-08-28T18:54:16Z', 'frozenWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'preparationScriptMonotonicMs': (time.monotonic_ns() - START) / 1000000,
    'metadataGitCommands': metadata_commands, 'patchHelperChildrenThisScript': 1, 'indexSha256': sha(index),
    'qualificationExecutedBeforeSeal': 0, 'syntaxChildrenBeforeSeal': 0,
    'counts': {'real': 6, 'synthetic': 11, 'data': 2, 'total': 19, 'originalRows': 18, 'addedRows': 1},
    'originalRowExpectationsUnchanged': True, 'membership': [row['id'] for role in ['real', 'synthetic', 'data'] for row in controls[role]],
    'priorV6': {'R01': 'PASS unchanged historical repeat', 'R02': 'FAIL unchanged historical; repaired surrogate in v7', 'other16': 'UNEXECUTED unchanged historical'},
    'command': 'env -i PATH=/Users/kjopek/.nvm/versions/node/v22.22.2/bin UV_THREADPOOL_SIZE=1 /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/git-independent-20260828/observer-qualification-v7/run.mjs',
    'cwd': str(REPO), 'aggregateInclusiveCleanupPublicationMs': 600000, 'directChildCap': 6,
    'plannedDirectChildren': 1, 'plannedSyntaxChildren': 0, 'plannedStandaloneControlChildren': 0,
    'peakOwnedProcesses': 2, 'captureCapBytes': 33554432, 'scratchCapBytes': 134217728,
    'child': {'argv': [str(ROOT / 'worker.mjs')], 'env': {'PATH': str(Path(node['path']).parent), 'UV_THREADPOOL_SIZE': '1'}, 'stdio': ['ignore', 'pipe', 'pipe']},
    'imports': {'observer.mjs': [], 'writer-surrogate.mjs': [],
      'worker.mjs': ['node:assert/strict', 'node:fs/promises', 'node:zlib', './writer-surrogate.mjs', 'node:crypto', 'node:events', './observer.mjs'],
      'run.mjs': ['node:assert/strict', 'node:child_process', 'node:crypto', 'node:fs', 'node:path', 'node:url']},
    'candidateModuleImports': 0, 'wholeCodecExecutions': 0, 'builds': 0, 'nativeGitOracles': 0, 'network': 0,
    'priorNodeDocs': {'path': str(V6 / 'NODE-SOURCES.json'), 'sha256': sha((V6 / 'NODE-SOURCES.json').read_bytes()), 'newRequests': 0},
})
print(json.dumps({'frozen': True, 'files': len(files), 'metadataGitChildren': len(metadata_commands), 'writerSha256': sha(writer.encode()), 'surrogateSha256': sha(surrogate.encode())}))
