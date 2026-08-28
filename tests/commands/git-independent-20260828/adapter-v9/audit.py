import datetime
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[3]
COMMANDS = []

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    COMMANDS.append(['git', *args])
    return subprocess.check_output(['git', *args], cwd=REPO)

def census(directory):
    rows = []
    for path in sorted(directory.rglob('*')):
        assert not path.is_symlink(), str(path)
        rows.append({'path': str(path), 'directory': True, 'bytes': 0} if path.is_dir() else
                    {'path': str(path), 'sha256': digest(path.read_bytes()), 'bytes': path.stat().st_size})
    return rows

seal = json.loads((ROOT / 'PRESEAL.json').read_text())
for file in seal['files']:
    assert digest((ROOT / file['path']).read_bytes()) == file['sha256']
old_trees = []
for tree in seal['oldTrees']:
    actual = census(pathlib.Path(tree['root']))
    assert actual == tree['rows'], tree['root']
    old_trees.append({'root': tree['root'], 'entries': len(actual), 'directories': sum(row.get('directory', False) for row in actual),
                      'bytesAndCompleteDirectoryCensusUnchanged': True})
source = json.loads((ROOT / 'SOURCE-TRANSFORMS.json').read_text())
source_hashes = []
for item in source['sources']:
    if 'commit' not in item:
        data = (REPO / item['path']).read_bytes()
    else:
        data = git('show', item['commit'] + ':' + item['path'])
    assert digest(data) == item['sha256'], item['path']
    source_hashes.append({'path': item['path'], 'sha256': item['sha256'], 'transformedSha256': item.get('transformedSha256'), 'executed': False})
assert digest(pathlib.Path(seal['node']['path']).read_bytes()) == seal['node']['sha256']
receipt = json.loads((ROOT / 'RUN-01/RECEIPT.json').read_text())
clock = json.loads((ROOT / 'RUN-01/PUBLICATION-CLOCK.json').read_text())
raw = [json.loads(line) for line in (ROOT / 'RUN-01/worker.stdout.jsonl').read_text().splitlines()]
rows = [row for row in raw if row['kind'] == 'case']
controls = json.loads((ROOT / 'CONTROLS.json').read_text())
assert [row['id'] for row in rows] == [row['id'] for row in controls]
assert all(row['passed'] and not row['safety'] for row in rows)
assert receipt['summary']['passed'] == 12 and receipt['summary']['failed'] == 0
assert receipt['child']['cleanupSettled'] and receipt['child']['closeObserved']
assert receipt['child']['exit']['code'] == 0 and receipt['child']['exit']['signal'] is None
assert receipt['child']['signals'] == [] and not receipt['child']['unknownClosure']
assert (ROOT / 'RUN-01/worker.stderr.txt').stat().st_size == 0
assert git('diff', '--cached', '--name-status', '-z').decode() == seal['stagedBeforeSeal']
frozen = datetime.datetime.fromisoformat(seal['postAuthorRevisionAt'])
first = datetime.datetime.fromisoformat(seal['preparationFirstObservedWall'].replace('Z', '+00:00'))
audit = {'classification': 'POSTRUN SOURCE/DATA AUDIT; not another qualification execution',
 'presealCommit': git('rev-parse', '2ed1e2e6').decode().strip(),
 'presealSha256': digest((ROOT / 'PRESEAL.json').read_bytes()),
 'adapterSha256': digest((ROOT / 'adapter.mjs').read_bytes()),
 'transformManifestSha256': digest((ROOT / 'SOURCE-TRANSFORMS.json').read_bytes()),
 'continuationProposalSha256': digest((ROOT / 'CONTINUATION-PROPOSED.json').read_bytes()),
 'nodeBinding': seal['node'], 'oldTrees': old_trees, 'sources': source_hashes,
 'results': {'syntheticRows': 10, 'dataRows': 2, 'realZlibRows': 0, 'passed': 12, 'failed': 0, 'unrun': 0,
 'syntheticStreamInstances': 7, 'adapterInstances': sum(len(row['restoration']) for row in rows),
 'restoredInstances': sum(result['restored'] for row in rows for result in row['restoration']),
 'retainedUniqueEventCount': sum(result['count'] for row in rows for result in row['restoration']),
 'expectedInvalidAdapters': sum(not result['valid'] for row in rows for result in row['restoration']),
 'candidateExecutions': 0, 'priorQualificationExecutions': 0},
 'resources': {'qualificationNodeProcesses': 2, 'spawnedWorkerChildren': 1, 'syntaxChildren': 0,
 'otherControlChildren': 0, 'peak': 2, 'signalsSent': [], 'workerNaturalExit': 0,
 'coordinatorToolObservedExit': 0, 'childAndBothStdioClosed': True,
 'inclusiveBeforeReceiptMs': receipt['aggregateIncludingCleanupMs'], 'afterReceiptWriteMs': clock['afterReceiptWriteMs'],
 'finalClockWriteTailMeasured': False, 'captureBytesIncludingReceiptAndClock': sum(row['bytes'] for row in census(ROOT / 'RUN-01')),
 'ownedBytesBeforeAuditPublication': sum(row['bytes'] for row in census(ROOT)),
 'preparationObservedWallMs': (frozen - first).total_seconds() * 1000, 'preparationScriptMs': seal['preparationScriptMs']},
 'captures': census(ROOT / 'RUN-01'), 'metadataGitCommands': COMMANDS,
 'indexEntriesPreserved': True, 'candidateContinuation': 'HELD; new different review; no executable seal promotion',
 'scopeLimits': ['synthetic seams, not a runtime candidate proof', 'prepared TS overlays not parsed or loaded',
 'T01 exercises fulfillment identity/forwarding, not every rejected or synchronously throwing iterator overload',
 'one Shell window and primary definition dispatch only; other routes HOLD', 'full fixture capacity not proven',
 'writer-destroy/caller cancellation errors outside exact mapped primary or iterator cause remain unowned HOLD',
 'no native allocation/RSS/universal descendant or future late-error claim']}
content = json.dumps(audit, indent=2) + '\n'
patch = '*** Begin Patch\n*** Add File: ' + str((ROOT / 'AUDIT.json').relative_to(REPO)) + '\n'
patch += ''.join('+' + line + '\n' for line in content.splitlines()) + '*** End Patch\n'
subprocess.run(['apply_patch', patch], cwd=REPO, check=True)
print(json.dumps({key: audit[key] for key in ['presealCommit', 'adapterSha256', 'transformManifestSha256', 'results', 'resources']}, indent=2))
