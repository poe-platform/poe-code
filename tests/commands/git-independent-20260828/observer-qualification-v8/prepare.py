import datetime
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
V7 = ROOT.with_name('observer-qualification-v7')
START = time.monotonic_ns()
metadata = []


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*arguments):
    metadata.append(['git', *arguments])
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
            raw = path.read_bytes()
            rows.append({'path': str(path), 'sha256': sha(raw), 'bytes': len(raw)})
    return rows


assert REPO == Path('/Users/kjopek/Workspace/safe-bash')
assert not (ROOT / 'PRESEAL.json').exists()
index = git('diff', '--cached', '--raw', '-z')
live_status = git('status', '--porcelain=v1', '-z', '--untracked-files=no')
trees = []
for commit, name in [('655cb37b97521558c4c90581b5b23fc6c3ad9bf2', 'm1a-review-v5'),
                     ('0be0667e64510868f78c8a989fddcc3acfd10b94', 'observer-qualification-v6'),
                     ('2b5f9b6920ec045b60daca930b71a79d8ed59f9e', 'observer-qualification-v7')]:
    directory = ROOT.with_name(name)
    stored = []
    for entry in git('ls-tree', '-rz', commit, '--', str(directory.relative_to(REPO))).split(b'\0'):
        if not entry:
            continue
        header, raw_path = entry.split(b'\t', 1)
        mode, kind, oid = header.split()
        assert mode == b'100644' and kind == b'blob'
        path = REPO / raw_path.decode()
        raw = path.read_bytes()
        assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == oid.decode()
        stored.append(str(path))
    rows = inventory(directory)
    assert sorted(row['path'] for row in rows if not row.get('directory')) == sorted(stored)
    trees.append({'root': str(directory), 'commit': commit, 'rows': rows})
source = json.loads((V7 / 'SOURCE-DATA.json').read_bytes())
correspondence = json.loads((V7 / 'CORRESPONDENCE.json').read_bytes())
codec = git('show', '9885390fb11454fa194a3e60fdbef198dbfdf633:src/commands/git/codec.ts')
assert sha(codec) == correspondence['fullBlobSha256'] and codec.decode() == source['codec']['text']
assert hashlib.sha1(b'blob ' + str(len(codec)).encode() + b'\0' + codec).hexdigest() == correspondence['fullBlobOid']
assert (ROOT / 'writer-surrogate.mjs').read_bytes() == (V7 / 'writer-surrogate.mjs').read_bytes()
assert sha((ROOT / 'writer-surrogate.mjs').read_bytes()) == correspondence['surrogateSha256']
put('SOURCE-DATA.json', source)
put('CORRESPONDENCE.json', correspondence)
documents = []
for name, url in [
    ('readable.js', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/streams/readable.js'),
    ('destroy.js', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/streams/destroy.js'),
    ('end-of-stream.js', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/streams/end-of-stream.js'),
    ('README.md', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/README.md'),
    ('stream.html', 'https://nodejs.org/download/release/v22.22.2/docs/api/stream.html'),
    ('zlib.html', 'https://nodejs.org/download/release/v22.22.2/docs/api/zlib.html'),
]:
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            raw = response.read(2 * 1024 * 1024)
            assert len(raw) < 2 * 1024 * 1024
            documents.append({'name': name, 'url': url, 'status': response.status, 'bytes': len(raw), 'sha256': sha(raw), 'text': raw.decode()})
    except Exception as error:
        documents.append({'name': name, 'url': url, 'unavailable': repr(error)})
put('NODE-PRIMARY.json', {'classification': 'exact tagged official primary SOURCE/DATA only; never imported',
    'webFetchedBeforePreparation': True, 'directRetrievalDocuments': documents,
    'async_iterator.js': 'not separately requested: readable.js contains createAsyncIterator and does not reference this module'})
assert all('text' in document for document in documents), 'source availability stop before qualification'
by_name = {document['name']: document for document in documents}
scopes = []
for name, begin, stop, meaning in [
    ('readable.js', 'async function* createAsyncIterator(stream, options) {', '// Making it explicit', 'finalizer delegates to destroyImpl.destroyer(stream, null)'),
    ('destroy.js', 'function destroyer(stream, err) {', '\nmodule.exports =', 'unfinished stream gets a new AbortError then public stream.destroy(err)'),
    ('destroy.js', 'function _destroy(self, err, cb) {', '\nfunction emitCloseNT', 'closed state before nextTick error/close; error precedes close notification'),
    ('end-of-stream.js', '  const onerror = (err) => {', '\n  const onrequest =', 'EOS observes error/close separately, not authority for callback or native lifetime'),
]:
    text = by_name[name]['text']
    start = text.index(begin)
    end = text.index(stop, start)
    scopes.append({'name': name, 'documentSha256': by_name[name]['sha256'], 'firstLine': text[:start].count('\n') + 1,
                   'lastLineInclusive': text[:end].count('\n'), 'scopeSha256': sha(text[start:end].encode()), 'meaning': meaning,
                   'scopeSourceData': text[start:end]})
put('NODE-PROVENANCE.json', {'scopes': scopes,
    'publicObservation': 'exact argument object enters owned instance destroy wrapper before forwarding',
    'iteratorClassification': 'source-linked destruction observed during a known owned iterator.return promise; not authenticated caller origin',
    'directClassification': 'exact argument predesignated by direct owned destroy call',
    'limit': 'public hook cannot authenticate hostile/reentrant JavaScript origin; no stack/private/native hooks used',
    'docsCaution': 'public docs advise implementors not to override destroy; reversible fixture instrumentation is not an advertised production extension point',
    'profile': 'Node22.22.2 exact binary plus tagged source interpretation; not embedded-source byte authentication'})
old_controls = json.loads((V7 / 'CONTROLS.json').read_bytes())
controls = json.loads((ROOT / 'CONTROLS.json').read_bytes())
assert controls['real'] == old_controls['real'] and controls['data'] == old_controls['data']
for row, old_row in zip(controls['synthetic'], old_controls['synthetic'], strict=True):
    assert {key: value for key, value in row.items() if key != 'variants'} == old_row
assert [row['id'] for role in ['real', 'synthetic', 'data'] for row in controls[role]] == [row['id'] for role in ['real', 'synthetic', 'data'] for row in old_controls[role]]
diff = ''.join(''.join(difflib.unified_diff((V7 / name).read_text().splitlines(True), (ROOT / name).read_text().splitlines(True),
                    fromfile='immutable-v7/' + name, tofile='new-v8/' + name))
               for name in ['observer.mjs', 'worker.mjs', 'run.mjs', 'CONTROLS.json'])
put('DELTA-V7.json', {'format': 'unified diff as DATA string', 'diff': diff,
    'addedModule': {'path': 'retirement.mjs', 'sha256': sha((ROOT / 'retirement.mjs').read_bytes())},
    'writerUnchangedSha256': correspondence['surrogateSha256'],
    'changes': ['owned iterator wrapper enrolls before actual return; one destruction cause per quiescent return token',
                'destroy exact argument identity enrolled BEFORE forwarding; no error name/code/window whitelist',
                'remove v7 pre-settlement AbortError name/code acknowledgment clause',
                'await known close notification then fixed two-turn horizon; preserve true operation/cleanup HOLD',
                'restore descriptors and check tampering; S07 strengthened with three bounded synthetic variants']})
node = json.loads((V7 / 'PRESEAL.json').read_bytes())['node']
assert sha(Path(node['path']).read_bytes()) == node['sha256']
files = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())} for path in sorted(ROOT.iterdir()) if path.is_file()]
assert {entry['path'] for entry in files} == {'observer.mjs', 'retirement.mjs', 'worker.mjs', 'run.mjs', 'writer-surrogate.mjs',
    'CONTROLS.json', 'CRITERION.md', 'prepare.py', 'SOURCE-DATA.json', 'CORRESPONDENCE.json', 'NODE-PRIMARY.json', 'NODE-PROVENANCE.json', 'DELTA-V7.json'}
put('PRESEAL.json', {
    'schema': 'observer-v8-preseal', 'node': node, 'files': files, 'oldTrees': trees,
    'v7Preseal': 'b83c2f27d2cd6d6a15c0b1570b1a067bac740e6b', 'v7Evidence': '2b5f9b6920ec045b60daca930b71a79d8ed59f9e',
    'observerHash': sha((ROOT / 'observer.mjs').read_bytes()), 'retirementHash': sha((ROOT / 'retirement.mjs').read_bytes()),
    'writerHash': correspondence['surrogateSha256'], 'sourceWriterHash': correspondence['writerSha256'],
    'sourceBlobOid': correspondence['fullBlobOid'], 'sourceBlobSha256': correspondence['fullBlobSha256'],
    'firstReliablePreparationWall': '2026-08-28T19:14:36Z', 'frozenWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'preparationScriptMonotonicMs': (time.monotonic_ns() - START) / 1000000,
    'metadataGitCommands': metadata, 'indexSha256': sha(index), 'trackedStatusSha256': sha(live_status),
    'liveProductEdits': 'observed src/commands/git codec/index/io/repository edits excluded; not inputs and not modified',
    'qualificationExecutedBeforeSeal': 0, 'syntaxChildrenBeforeSeal': 0,
    'counts': {'outerRows': 19, 'real': 6, 'synthetic': 11, 'data': 2, 'S07InnerVariants': 3,
               'plannedObservedInflateStreams': 6, 'plannedSyntheticFacadeObjects': 4, 'extraOuterRows': 0},
    'membership': [row['id'] for role in ['real', 'synthetic', 'data'] for row in controls[role]],
    'oldOutcomesPreserved': True, 'expectationsUnchanged': True,
    'command': 'env -i PATH=/Users/kjopek/.nvm/versions/node/v22.22.2/bin UV_THREADPOOL_SIZE=1 /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/git-independent-20260828/observer-qualification-v8/run.mjs',
    'cwd': str(REPO), 'aggregateInclusiveCleanupPublicationMs': 600000, 'directChildCap': 6,
    'plannedDirectChildren': 1, 'plannedSyntaxChildren': 0, 'plannedStandaloneControlChildren': 0,
    'peakOwnedProcesses': 2, 'captureCapBytes': 33554432, 'scratchCapBytes': 134217728,
    'child': {'argv': [str(ROOT / 'worker.mjs')], 'env': {'PATH': str(Path(node['path']).parent), 'UV_THREADPOOL_SIZE': '1'}, 'stdio': ['ignore', 'pipe', 'pipe']},
    'imports': {'observer.mjs': ['./retirement.mjs'], 'retirement.mjs': [], 'writer-surrogate.mjs': [],
      'worker.mjs': ['node:assert/strict', 'node:fs/promises', 'node:zlib', './writer-surrogate.mjs', 'node:crypto', 'node:events', './observer.mjs'],
      'run.mjs': ['node:assert/strict', 'node:child_process', 'node:crypto', 'node:fs', 'node:path', 'node:url']},
    'candidateModuleImports': 0, 'wholeCodecExecutions': 0, 'builds': 0, 'nativeGitOracles': 0,
    'qualificationNetwork': 0, 'newPrimaryDocumentRetrievalsInPreparation': 6,
})
print(json.dumps({'frozen': True, 'files': len(files), 'metadataGitChildren': len(metadata), 'sourceWriterHash': correspondence['writerSha256'],
                  'observerHash': sha((ROOT / 'observer.mjs').read_bytes()), 'retirementHash': sha((ROOT / 'retirement.mjs').read_bytes())}))
