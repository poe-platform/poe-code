import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
PRESEAL = 'b83c2f27d2cd6d6a15c0b1570b1a067bac740e6b'
START = time.monotonic_ns()
metadata = []


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*arguments):
    metadata.append(['git', *arguments])
    return subprocess.check_output(['git', *arguments], cwd=REPO)


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


seal = json.loads((ROOT / 'PRESEAL.json').read_bytes())
assert git('cat-file', '-t', PRESEAL).strip() == b'commit'
for entry in [*seal['files'], {'path': 'PRESEAL.json', 'sha256': sha((ROOT / 'PRESEAL.json').read_bytes())}]:
    path = ROOT / entry['path']
    assert sha(path.read_bytes()) == entry['sha256']
    assert git('show', PRESEAL + ':' + str(path.relative_to(REPO))) == path.read_bytes()
for tree in seal['oldTrees']:
    assert inventory(Path(tree['root'])) == tree['rows']
assert sha(Path(seal['node']['path']).read_bytes()) == seal['node']['sha256']
correspondence = json.loads((ROOT / 'CORRESPONDENCE.json').read_bytes())
source = json.loads((ROOT / 'SOURCE-DATA.json').read_bytes())
codec = source['codec']['text'].encode()
assert sha(codec) == correspondence['fullBlobSha256']
assert hashlib.sha1(b'blob ' + str(len(codec)).encode() + b'\0' + codec).hexdigest() == correspondence['fullBlobOid']
writer = codec[correspondence['writerStartByte']:correspondence['writerEndByteExclusive']]
assert sha(writer) == correspondence['writerSha256']
transformed = writer.decode()
for change in correspondence['transformations']:
    assert transformed.count(change['from']) == change['count']
    transformed = transformed.replace(change['from'], change['to'])
assert (correspondence['wrapperPrefix'] + transformed + correspondence['wrapperSuffix']).encode() == (ROOT / 'writer-surrogate.mjs').read_bytes()
receipt = json.loads((ROOT / 'RUN-01/RECEIPT.json').read_bytes())
clock = json.loads((ROOT / 'RUN-01/PUBLICATION-CLOCK.json').read_bytes())
rows = [json.loads(line) for line in (ROOT / 'RUN-01/worker.stdout.jsonl').read_text().splitlines()]
cases = [row for row in rows if row['kind'] == 'case']
assert [row['id'] for row in cases] == ['R01', 'R02', 'R03', 'R04', 'R05']
assert [row['passed'] for row in cases] == [True, True, True, True, False]
assert all(row['safety'] is False for row in cases)
assert receipt['summary']['executed'] == 5 and len(receipt['summary']['unexecuted']) == 14
assert receipt['child']['exit']['code'] == 1 and receipt['child']['exit']['signal'] is None
assert receipt['child']['closeObserved'] and receipt['child']['cleanupSettled'] and not receipt['child']['unknownClosure']
assert receipt['child']['stdoutCloseObserved'] and receipt['child']['stderrCloseObserved'] and receipt['child']['signals'] == []
assert (ROOT / 'RUN-01/worker.stderr.txt').read_bytes() == b''
assert clock['afterReceiptWriteMs'] < 600000
for row in cases:
    assert row['ownedCleanup']['settled'] and row['ownedCleanup']['ownedOperationPending'] == 0
second = cases[1]
assert second['horizon']['resources'][0]['operations'][0]['route'] == 'close-fallback'
assert second['ownedCleanup']['writePending'] == 1
fifth = cases[4]
assert fifth['comparison'] == {'oldNotificationPredicate': 'HOLD', 'atSettlement': 'NOTIFICATION_PENDING', 'atHorizon': 'HOLD', 'proposedTerminal': 'HOLD'}
assert fifth['settlement']['hasFailure'] is False
assert fifth['horizon']['failures'] == [{'reason': {'type': 'Error', 'name': 'AbortError', 'message': 'The operation was aborted', 'code': 'ABORT_ERR'}, 'channel': 'stream-error', 'late': True, 'acknowledged': False}]
files = [{'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
         for path in sorted(ROOT.rglob('*')) if path.is_file()]
result = {
    'schema': 'v7-data-only-postcohort-audit', 'presealCommit': PRESEAL,
    'classification': 'source/data/hash checks only; no observer/candidate replay; not D01/D02 execution',
    'result': 'PARTIAL_HOLD_R05_LATE_UNACKNOWLEDGED_ABORT_ERROR',
    'counts': {'frozenReal': 6, 'executedReal': 5, 'passedReal': 4, 'failedReal': 1, 'syntheticFrozen': 11,
               'syntheticExecuted': 0, 'dataFrozen': 2, 'dataExecuted': 0},
    'unexecuted': receipt['summary']['unexecuted'],
    'membership': seal['membership'], 'priorV6Preserved': True, 'priorV5Preserved': True,
    'sourceCorrespondenceVerifiedAsData': True, 'fullBlobOid': correspondence['fullBlobOid'],
    'writerSha256': correspondence['writerSha256'], 'surrogateSha256': correspondence['surrogateSha256'],
    'observerSha256': sha((ROOT / 'observer.mjs').read_bytes()),
    'children': {'qualification': 1, 'worker': 1, 'syntax': 0, 'standaloneControls': 0, 'candidate': 0, 'peakOwnedProcesses': 2},
    'workerExit': 1, 'workerSignal': None, 'naturalKnownWorkerClosure': True, 'allKnownChildCleanupSettled': True,
    'allFiveRealKnownOwnedCleanupSettled': True, 'nativeAllocationLifetimeMeasured': False,
    'cohortPreReceiptMs': receipt['aggregateIncludingCleanupMs'], 'postReceiptPublicationMs': clock['afterReceiptWriteMs'],
    'clockFileOwnFinalWriteUnsampled': True,
    'captureBytesIncludingReceipts': sum(path.stat().st_size for path in (ROOT / 'RUN-01').iterdir()),
    'publicationBytesExcludingThisAudit': sum(entry['bytes'] for entry in files),
    'filesExcludingThisAudit': files, 'oldFileAndDirectoryCensusIncludingAdditions': True,
    'firstPreparationWall': seal['firstReliablePreparationWall'], 'frozenWall': seal['frozenWall'],
    'indexAtAuditSha256': sha(git('diff', '--cached', '--raw', '-z')), 'metadataGitCommands': metadata,
    'auditMonotonicMs': (time.monotonic_ns() - START) / 1000000,
    'auditedWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'candidateContinuationAuthorized': False, 'newContinuationSealPrepared': False,
    'reasonNoContinuationSeal': 'ROOT success condition unmet; no self-authorized continuation',
}
with (ROOT / 'AUDIT.json').open('xb') as output:
    output.write((json.dumps(result, indent=2) + '\n').encode())
print(json.dumps({'audited': True, 'result': result['result'], 'metadataChildren': len(metadata),
                  'ownedBytes': sum(path.stat().st_size for path in ROOT.rglob('*') if path.is_file())}))
