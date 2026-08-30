import base64
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OLD = ROOT.parent / 'm1a-review-v5'
CANDIDATE = '9885390fb11454fa194a3e60fdbef198dbfdf633'
OLD_SEAL = 'f38984ec68477a620792b5e899f7f29aa586bc9f'
OLD_EVIDENCE = '655cb37b97521558c4c90581b5b23fc6c3ad9bf2'
START = time.monotonic_ns()
metadata_children = 0


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*arguments):
    global metadata_children
    metadata_children += 1
    return subprocess.check_output(['git', *arguments], cwd=REPO)


def put(name, value):
    raw = (json.dumps(value, indent=2, ensure_ascii=True) + '\n').encode()
    with (ROOT / name).open('xb') as target:
        target.write(raw)


def source(commit, path):
    raw = git('show', commit + ':' + path)
    return {'commit': commit, 'path': path, 'sha256': sha(raw), 'bytes': len(raw), 'text': raw.decode()}


assert REPO == Path('/Users/kjopek/Workspace/safe-bash')
assert not (ROOT / 'PRESEAL.json').exists()
index = git('diff', '--cached', '--raw', '-z')
tracked_status = git('status', '--porcelain=v1', '-z', '--untracked-files=no')
old_inventory = []
records = git('ls-tree', '-rz', OLD_EVIDENCE, '--', str(OLD.relative_to(REPO))).split(b'\0')
for record in records:
    if not record:
        continue
    metadata, raw_path = record.split(b'\t', 1)
    mode, kind, oid = metadata.split()
    assert kind == b'blob' and mode == b'100644'
    relative = raw_path.decode('utf-8')
    raw = git('show', OLD_EVIDENCE + ':' + relative)
    assert (REPO / relative).read_bytes() == raw
    old_inventory.append({'path': str(REPO / relative), 'sha256': sha(raw), 'bytes': len(raw)})
assert sorted(str(path) for path in OLD.rglob('*') if path.is_file()) == sorted(row['path'] for row in old_inventory)
old_inventory.sort(key=lambda row: row['path'])
binding = json.loads((OLD / 'BINDING.json').read_bytes())
node = binding['node']
assert sha(Path(node['path']).read_bytes()) == node['sha256']
data = {
    'classification': 'SOURCE_AND_CAPTURE_DATA_ONLY_NO_CANDIDATE_EVALUATION',
    'codec': source(CANDIDATE, 'src/commands/git/codec.ts'),
    'output': source(CANDIDATE, 'src/contracts/output.ts'),
    'worker': source(OLD_SEAL, str((OLD / 'worker.mjs').relative_to(REPO))),
    'handoff': source(OLD_EVIDENCE, str((OLD / 'HANDOFF.md').relative_to(REPO))),
}
archive_bytes = gzip.decompress(base64.b64decode((OLD / 'RAW.json.gz.base64').read_bytes()))
assert len(archive_bytes) < 32 * 1024 * 1024
archive = json.loads(archive_bytes)
entry = next(entry for entry in archive['entries'] if entry['path'] == 'source/H09.json')
h09_bytes = base64.b64decode(entry['base64'])
assert sha(h09_bytes) == entry['sha256']
h09 = json.loads(h09_bytes)
assert h09['nativeZlib'] == {'created': 289, 'closed': 288, 'outstanding': 1, 'maxConcurrent': 2}
data['oldH09'] = {'captureSha256': entry['sha256'], 'archiveDecodedSha256': sha(archive_bytes),
                 'nativeZlib': h09['nativeZlib'], 'status': h09['status'], 'safety': h09['safety'],
                 'newStatesAbsent': True, 'noRescore': True}
put('SOURCE-DATA.json', data)
documents = []
for name, url in [
    ('stream.html', 'https://nodejs.org/download/release/v22.22.2/docs/api/stream.html'),
    ('zlib.html', 'https://nodejs.org/download/release/v22.22.2/docs/api/zlib.html'),
    ('destroy.js', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/streams/destroy.js'),
    ('zlib.js', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/zlib.js'),
    ('stream.md', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/stream.md'),
    ('zlib.md', 'https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/zlib.md'),
]:
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            raw = response.read(2 * 1024 * 1024)
            assert len(raw) < 2 * 1024 * 1024
            documents.append({'name': name, 'url': url, 'status': response.status,
                              'sha256': sha(raw), 'bytes': len(raw), 'text': raw.decode()})
    except Exception as error:
        documents.append({'name': name, 'url': url, 'unavailable': repr(error)})
put('NODE-SOURCES.json', {'classification': 'exact-tagged-primary-documents-source-data', 'documents': documents})
assert all('text' in document for document in documents), 'source availability stop before qualification'
files = [{'path': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
         for path in sorted(ROOT.iterdir()) if path.is_file()]
assert {row['path'] for row in files} == {'observer.mjs', 'worker.mjs', 'run.mjs', 'CONTROLS.json',
                                        'CRITERION.md', 'prepare.py', 'SOURCE-DATA.json', 'NODE-SOURCES.json'}
put('PRESEAL.json', {
    'schema': 'observer-v6-preseal', 'date': '2026-08-28', 'node': node, 'files': files,
    'oldPreseal': OLD_SEAL, 'oldEvidence': OLD_EVIDENCE, 'candidateSourceDataOnly': CANDIDATE,
    'oldInventory': old_inventory, 'indexBeforePreparationSha256': sha(index),
    'trackedStatusBeforePreparationSha256': sha(tracked_status),
    'firstReliablePreparationWall': '2026-08-28T18:33:14Z',
    'initialInspectionBeforeFirstClock': 'unmeasured; not claimed as measured work',
    'frozenWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'preparationScriptMonotonicMs': (time.monotonic_ns() - START) / 1000000,
    'preparationMetadataChildrenThisScript': metadata_children,
    'qualificationExecutedBeforeSeal': 0, 'syntaxChildrenBeforeSeal': 0,
    'command': 'env -i PATH=/Users/kjopek/.nvm/versions/node/v22.22.2/bin UV_THREADPOOL_SIZE=1 /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/git-independent-20260828/observer-qualification-v6/run.mjs',
    'cwd': str(REPO), 'aggregateInclusiveCleanupMs': 600000, 'directChildCap': 12,
    'plannedDirectQualificationChildren': 1, 'plannedSyntaxChildren': 0, 'plannedStandaloneControlChildren': 0,
    'plannedWorkerChildren': 1, 'plannedInWorkerCases': {'real': 6, 'synthetic': 10, 'sourceData': 2},
    'peakOwnedProcesses': 2, 'captureCapBytes': 33554432, 'scratchCapBytes': 134217728,
    'imports': {'observer.mjs': [], 'worker.mjs': ['node:assert/strict', 'node:fs/promises', 'node:zlib', './observer.mjs'],
                'run.mjs': ['node:assert/strict', 'node:child_process', 'node:crypto', 'node:fs', 'node:path', 'node:url']},
    'candidateImports': 0, 'builds': 0, 'nativeGitOracle': 0, 'networkDuringQualification': 0,
})
print(json.dumps({'frozen': True, 'files': len(files), 'nodeSha256': node['sha256'], 'metadataChildren': metadata_children}))
