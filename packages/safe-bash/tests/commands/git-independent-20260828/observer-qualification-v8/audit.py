import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
PRESEAL = '1f03c93a0a857d7360bf8a418eff45bbcfa20942'
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
codec = git('show', '9885390fb11454fa194a3e60fdbef198dbfdf633:src/commands/git/codec.ts')
assert sha(codec) == correspondence['fullBlobSha256']
assert hashlib.sha1(b'blob ' + str(len(codec)).encode() + b'\0' + codec).hexdigest() == correspondence['fullBlobOid']
writer = codec[correspondence['writerStartByte']:correspondence['writerEndByteExclusive']]
assert sha(writer) == correspondence['writerSha256']
transformed = writer.decode()
for change in correspondence['transformations']:
    assert transformed.count(change['from']) == change['count']
    transformed = transformed.replace(change['from'], change['to'])
assert (correspondence['wrapperPrefix'] + transformed + correspondence['wrapperSuffix']).encode() == (ROOT / 'writer-surrogate.mjs').read_bytes()
candidate_entry = git('show', '9885390fb11454fa194a3e60fdbef198dbfdf633:src/commands/git/index.ts')
assert sha(candidate_entry) == '618f005b204c8f6e72059e83dcfe0a34cbddc1b8577907bef20ae2f05b107a1e'
receipt = json.loads((ROOT / 'RUN-01/RECEIPT.json').read_bytes())
clock = json.loads((ROOT / 'RUN-01/PUBLICATION-CLOCK.json').read_bytes())
rows = [json.loads(line) for line in (ROOT / 'RUN-01/worker.stdout.jsonl').read_text().splitlines()]
cases = [row for row in rows if row['kind'] == 'case']
assert [row['id'] for row in cases] == seal['membership']
assert len(cases) == 19 and all(row['passed'] and not row['safety'] for row in cases)
assert receipt['completed'] is True and receipt['safety'] is False and receipt['summary']['unexecuted'] == []
assert receipt['summary']['syntheticTimersPending'] == 0
assert receipt['child']['exit']['code'] == 0 and receipt['child']['exit']['signal'] is None
assert receipt['child']['closeObserved'] and receipt['child']['cleanupSettled'] and not receipt['child']['unknownClosure']
assert receipt['child']['stdoutCloseObserved'] and receipt['child']['stderrCloseObserved'] and receipt['child']['signals'] == []
assert (ROOT / 'RUN-01/worker.stderr.txt').read_bytes() == b''
assert clock['afterReceiptWriteMs'] < 600000
real = [row for row in cases if row['role'] == 'real']
assert len(real) == 6
for row in real:
    assert row['ownedCleanup']['settled'] and row['ownedCleanup']['ownedOperationPending'] == 0
    assert row['hooks']['destroyRestored'] and row['hooks']['callbacksRestored']
    assert row['comparison']['proposedTerminal'] == 'PASS'
fifth = next(row for row in cases if row['id'] == 'R05')
assert fifth['comparison']['atSettlement'] == 'NOTIFICATION_PENDING'
cause = fifth['horizon']['resources'][0]['causes'][0]
failure = fifth['horizon']['failures'][0]
assert cause['classification'] == 'source-linked-owned-iterator-return-observation' and cause['errorDelivered']
assert failure['acknowledged'] and failure['late'] and failure['reasonId'] == cause['reasonId'] and failure['causeId'] == cause['id']
assert cause['enrolledSequence'] < next(event['sequence'] for event in fifth['trace'] if event['event'] == 'stream-error')
negative = next(row for row in cases if row['id'] == 'S07')
assert len(negative['subcases']) == 3 and all(row['passed'] and row['comparison']['proposedTerminal'] == 'HOLD' for row in negative['subcases'])
for sub in negative['subcases']:
    assert sub['hooks']['destroyRestored'] and sub['hooks']['callbacksRestored']
unowned = negative['subcases'][0]['horizon']['failures'][0]
assert unowned['late'] and not unowned['acknowledged'] and unowned['causeId'] is None
owned, secondary = negative['subcases'][1]['horizon']['failures']
assert owned['acknowledged'] and owned['causeId'] is not None and not secondary['acknowledged'] and secondary['causeId'] is None
assert owned['reasonId'] != secondary['reasonId']
fallback = next(row for row in cases if row['id'] == 'S11')
assert fallback['hooks']['destroyRestored'] and fallback['hooks']['callbacksRestored']
old = ROOT.with_name('m1a-review-v5')
old_seal = json.loads((old / 'PRESEAL.json').read_bytes())
observer_hash = sha((ROOT / 'observer.mjs').read_bytes())
retirement_hash = sha((ROOT / 'retirement.mjs').read_bytes())
adapter_hash = sha((ROOT / 'WORKER-ADAPTER-PROPOSAL.md').read_bytes())
roles = [
    {'ordinal': 1, 'role': 'source-fresh-all71', 'groups': 71},
    {'ordinal': 2, 'role': 'compiled', 'groups': 71},
    {'ordinal': 3, 'role': 'manual-staged', 'groups': 71},
    {'ordinal': 4, 'role': 'physically-moved', 'groups': 71},
    {'ordinal': 5, 'role': 'types-positive', 'expectedExit': 0},
    {'ordinal': 6, 'role': 'types-negative-limits', 'expectedExit': 2, 'diagnostic': 'TS2353'},
    {'ordinal': 7, 'role': 'types-negative-native', 'expectedExit': 2, 'diagnostic': 'TS2353'},
    {'ordinal': 8, 'role': 'types-negative-boundary', 'expectedExit': 2, 'diagnostic': 'TS2322'},
    {'ordinal': 9, 'role': 'types-negative-public-root', 'expectedExit': 2, 'diagnostic': 'TS2305'},
    {'ordinal': 10, 'role': 'mutant-wrong-raw', 'groups': ['A04']},
    {'ordinal': 11, 'role': 'mutant-guessed-mode', 'groups': ['H06']},
    {'ordinal': 12, 'role': 'mutant-unmerged-diff', 'groups': ['A26']},
    {'ordinal': 13, 'role': 'binding-entry', 'requiresBeforeLoadRefusal': True},
    {'ordinal': 14, 'role': 'binding-hash', 'requiresBeforeLoadRefusal': True},
    {'ordinal': 15, 'role': 'binding-import', 'requiresBeforeLoadRefusal': True},
]
put('CONTINUATION-PROPOSED.json', {
    'schema': 'v8-qualified-observer-UNAPPROVED-continuation-proposal',
    'status': 'NOT_AN_EXECUTABLE_SEAL_DIFFERENT_REVIEW_AND_FRESH_ROOT_GO_REQUIRED',
    'rootGo': False, 'executionAuthorized': False, 'executionCommand': None,
    'qualification': {'presealCommit': PRESEAL, 'outerPassed': 19, 'real': 6, 'synthetic': 11, 'data': 2, 'S07NegativeSubcases': 3,
                      'receiptSha256': sha((ROOT / 'RUN-01/RECEIPT.json').read_bytes()), 'candidateAcceptance': False},
    'observerModules': [{'path': 'observer.mjs', 'sha256': observer_hash}, {'path': 'retirement.mjs', 'sha256': retirement_hash}],
    'minimalWorkerAdapterProposal': {'path': 'WORKER-ADAPTER-PROPOSAL.md', 'sha256': adapter_hash, 'executableAdapterExists': False},
    'reviewPrerequisites': ['different agent reviews causal identity, bounded-notification and negative controls',
        'freeze a concrete minimal adapter and exact forwarding/iterator-factory behavior',
        'directly observe or explicitly approve source-linked candidate writer-promise evidence; no fabricated direct observation',
        'bind per-invocation direct-host/root-cleanup settlement boundaries, not only row-end state',
        'authenticate frozen source/package/consumer/archive inputs before admission; no live overlay',
        'preserve semantic assertions/matrix/fixtures; disclose all helper instrumentation byte changes',
        'fresh ROOT GO for the exact executable seal and future budget'],
    'frozenCandidateBindings': {'source': old_seal['source'], 'authorEvidence': old_seal['evidence'], 'derivedBase': old_seal['base'],
        'entry': 'src/commands/git/index.ts', 'entrySha256': sha(candidate_entry),
        'sourceCodecBlobOid': correspondence['fullBlobOid'], 'sourceCodecSha256': correspondence['fullBlobSha256'],
        'isolatedSourceWriterSha256': correspondence['writerSha256'], 'isolatedWriterSurrogateSha256': correspondence['surrogateSha256'],
        'fullPackageSha256HistoricalBinding': old_seal['packageSha256'],
        'packageAuthentication': 'unchanged historical declaration, must authenticate immutable payload before future admission',
        'originalPreseal': 'f38984ec68477a620792b5e899f7f29aa586bc9f', 'originalEvidence': '655cb37b97521558c4c90581b5b23fc6c3ad9bf2',
        'oldPresealSha256': sha((old / 'PRESEAL.json').read_bytes()), 'oldBindingSha256': sha((old / 'BINDING.json').read_bytes()),
        'oldInputsSha256': sha((old / 'INPUTS.json').read_bytes()), 'oldWorkerSha256': sha((old / 'worker.mjs').read_bytes()),
        'unchangedCasesSha256': sha((old / 'cases.mjs').read_bytes()), 'unchangedFixturesSha256': sha((old / 'fixtures.mjs').read_bytes()),
        'mutants': old_seal['mutants']},
    'node': seal['node'], 'sourceGroupOrder': [row['id'] for row in old_seal['cases']],
    'exactProposedSequence': roles,
    'layoutArithmetic': {'freshSource': 71, 'compiled': 71, 'staged': 71, 'moved': 71, 'freshTotal': 284,
        'repeatedPriorSourceGroups': 69, 'sourceOriginallyUnexecuted': ['H10', 'H11'], 'originallyUnexecutedTotal': 215,
        'originallyUnexecutedStillUnexecutedNow': 215},
    'futureChildren': {'sourceFresh': 1, 'originalOther14': {'layouts': 3, 'typePositive': 1, 'typeNegative': 4, 'mutants': 3, 'bindingNegative': 3}, 'total': 15},
    'futureBudgetProposalOnly': {'aggregateIncludingCleanupMs': 600000, 'directChildren': 15, 'peakOwnedProcesses': 2,
        'perChildMs': 120000, 'perGroupMs': 30000, 'cleanupReserveMs': 5000, 'captureCapBytes': 33554432, 'scratchCapBytes': 134217728,
        'admission': 'one sequential child; refuse when full child/cleanup or capture reservation cannot fit; preserve unexecuted rows',
        'inheritsOld110MinuteBudget': False, 'enlargesCurrentAuthority': False},
    'preservedOldH09': {'created': 289, 'closeEventsDelivered': 288, 'semanticPasses': 69, 'safetyStop': True, 'rescore': False},
    'preservedOldObserverFailures': ['v6 R02 FAIL', 'v7 R05 FAIL'],
    'nativeGit': {'workflows': 6, 'state': 'HELD_UNRUN'}, 'candidateExecutionsNow': 0, 'productFix': None,
})
files = [{'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
         for path in sorted(ROOT.rglob('*')) if path.is_file()]
put('AUDIT.json', {
    'schema': 'v8-postcohort-DATA-audit', 'presealCommit': PRESEAL,
    'classification': 'data/hash/record authentication only; no additional qualification, candidate or native execution',
    'outerRows': 19, 'outerPassed': 19, 'failed': 0, 'unexecuted': [], 'roles': {'real': 6, 'synthetic': 11, 'data': 2},
    'S07NegativeSubcases': 3, 'S07AllExpectedHold': True, 'actualObservedInflateStreams': 6, 'syntheticFacadeObjects': 4,
    'realRawWriteCallbacks': sum(row['horizon']['resources'][0]['writeCallbacks'] for row in real),
    'realRawWriteNotificationsPending': sum(row['horizon']['resources'][0]['writePending'] for row in real),
    'realEndRequests': sum(row['horizon']['resources'][0]['endRequests'] for row in real),
    'realEndCallbacks': sum(row['horizon']['resources'][0]['endCallbacks'] for row in real),
    'actualOwnedOperationsPending': 0, 'allRealKnownCleanupSettled': True, 'allTenHookDescriptorsRestored': True,
    'causalR05': {'causeEnrollmentSequence': cause['enrolledSequence'], 'token': cause['tokenId'], 'operation': cause['operationId'],
        'reasonId': cause['reasonId'], 'classification': cause['classification'], 'sameIdentityLateErrorAcknowledged': True},
    'unownedLateAbortAndDistinctSecondaryRejected': True, 'hookTamperRejected': True,
    'observerHash': observer_hash, 'retirementHash': retirement_hash, 'writerHash': correspondence['surrogateSha256'],
    'sourceCorrespondenceUnchanged': True, 'oldFixturesUnchanged': True, 'oldFileAndDirectoryCensusesUnchanged': True,
    'newFileAndEmptyDirectoryEntriesChecked': True, 'oldFailuresAndUnexecutedGroupsPreserved': True,
    'children': {'qualificationDirect': 1, 'worker': 1, 'syntax': 0, 'standaloneControls': 0, 'candidate': 0, 'peakOwnedProcesses': 2},
    'workerExit': 0, 'workerSignal': None, 'naturalKnownProcessClosure': True, 'knownChildAndPipeCleanupSettled': True,
    'cohortPreReceiptMs': receipt['aggregateIncludingCleanupMs'], 'postReceiptMs': clock['afterReceiptWriteMs'],
    'finalClockFileOwnWriteUnsampled': True,
    'capturesIncludingReceiptsBytes': sum(path.stat().st_size for path in (ROOT / 'RUN-01').iterdir()),
    'publicationBytesExcludingThisAudit': sum(entry['bytes'] for entry in files), 'filesExcludingThisAudit': files,
    'indexAtAuditSha256': sha(git('diff', '--cached', '--raw', '-z')), 'metadataGitCommands': metadata,
    'auditMonotonicMs': (time.monotonic_ns() - START) / 1000000, 'auditedWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'continuationProposalCreated': True, 'continuationAuthorized': False,
})
print(json.dumps({'audited': True, 'outerPassed': 19, 'metadataChildren': len(metadata),
                  'ownedBytes': sum(path.stat().st_size for path in ROOT.rglob('*') if path.is_file()), 'continuationAuthorized': False}))
