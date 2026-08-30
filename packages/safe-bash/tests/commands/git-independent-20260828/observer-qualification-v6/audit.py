import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
PRESEAL_COMMIT = '65b73e44d5641b5472e2b96000d51d5b6f81f7ff'
START = time.monotonic_ns()
metadata_children = 0


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*arguments):
    global metadata_children
    metadata_children += 1
    return subprocess.check_output(['git', *arguments], cwd=REPO)


def put(name, value):
    with (ROOT / name).open('xb') as target:
        target.write((json.dumps(value, indent=2) + '\n').encode())


seal = json.loads((ROOT / 'PRESEAL.json').read_bytes())
old = ROOT.parent / 'm1a-review-v5'
old_seal = json.loads((old / 'PRESEAL.json').read_bytes())
for commit in [PRESEAL_COMMIT, seal['oldPreseal'], seal['oldEvidence']]:
    assert git('cat-file', '-t', commit).strip() == b'commit'
for entry in seal['files']:
    path = ROOT / entry['path']
    assert sha(path.read_bytes()) == entry['sha256']
    assert git('show', PRESEAL_COMMIT + ':' + str(path.relative_to(REPO))) == path.read_bytes()
assert git('show', PRESEAL_COMMIT + ':' + str((ROOT / 'PRESEAL.json').relative_to(REPO))) == (ROOT / 'PRESEAL.json').read_bytes()
actual_old = []
for path in sorted(old.rglob('*')):
    assert not path.is_symlink()
    if path.is_file():
        actual_old.append({'path': str(path), 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size})
assert actual_old == seal['oldInventory']
assert sha(Path(seal['node']['path']).read_bytes()) == seal['node']['sha256']
receipt = json.loads((ROOT / 'RUN-01/RECEIPT.json').read_bytes())
rows = [json.loads(line) for line in (ROOT / 'RUN-01/worker.stdout.jsonl').read_text().splitlines()]
cases = [row for row in rows if row['kind'] == 'case']
assert [row['id'] for row in cases] == ['R01', 'R02']
assert cases[0]['passed'] is True and cases[1]['passed'] is False and cases[1]['safety'] is True
assert receipt['child']['exit']['code'] == 1 and receipt['child']['closeObserved'] is True
assert receipt['child']['cleanupSettled'] is True and receipt['child']['signals'] == []
assert receipt['child']['unknownClosure'] is False
assert receipt['summary']['executed'] == 2 and len(receipt['summary']['unexecuted']) == 16
assert receipt['qualificationDirectChildren'] == 1 and receipt['peakOwnedProcesses'] == 2
assert (ROOT / 'RUN-01/worker.stderr.txt').read_bytes() == b''
assert cases[1]['ownedCleanup']['writePending'] == 1 and cases[1]['ownedCleanup']['settled'] is False
assert cases[1]['comparison'] == {'oldNotificationPredicate': 'CLEAR', 'atSettlement': 'HOLD', 'atHorizon': 'HOLD', 'proposedTerminal': 'HOLD'}
observer_hash = sha((ROOT / 'observer.mjs').read_bytes())
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
    'schema': 'observer-v6-proposed-continuation-seal',
    'status': 'INVALID_UNAPPROVED_OBSERVER_UNQUALIFIED_NOT_EXECUTABLE',
    'rootGo': False, 'executionAuthorized': False, 'executionCommand': None,
    'observer': {'version': 'observer-qualification-v6.1', 'path': 'observer.mjs', 'sha256': observer_hash,
                 'qualificationPresealCommit': PRESEAL_COMMIT, 'qualification': 'PARTIAL_HOLD_R02'},
    'minimalWorkerAdapterDelta': {'path': 'WORKER-ADAPTER-PROPOSAL.md', 'sha256': adapter_hash,
                                'format': 'source-data proposal only', 'executableAdapterExists': False},
    'blockers': ['R02 callback-only surrogate omitted codec close-fallback',
                 '16 presealed controls unexecuted after safety stop',
                 'raw callback retirement versus pending owned-operation boundary unqualified',
                 'per-command versus direct-host registered-cleanup settlement instrumentation unqualified',
                 'fresh independently sealed successor qualification and fresh ROOT candidate GO required'],
    'historicalBindingsOnlyNotNewCandidateAcceptance': {
        'source': old_seal['source'], 'authorEvidence': old_seal['evidence'], 'derivedBase': old_seal['base'],
        'originalPreseal': seal['oldPreseal'], 'originalEvidence': seal['oldEvidence'],
        'oldPresealFileSha256': sha((old / 'PRESEAL.json').read_bytes()),
        'oldBindingFileSha256': sha((old / 'BINDING.json').read_bytes()),
        'oldInputFileSha256': sha((old / 'INPUTS.json').read_bytes()),
        'oldWorkerSha256': sha((old / 'worker.mjs').read_bytes()),
        'unchangedCaseModuleSha256': sha((old / 'cases.mjs').read_bytes()),
        'unchangedFixtureModuleSha256': sha((old / 'fixtures.mjs').read_bytes()),
        'oldRunModuleSha256': sha((old / 'run.mjs').read_bytes()),
        'fullPackageSha256': old_seal['packageSha256'], 'mutants': old_seal['mutants']},
    'node': seal['node'],
    'preservedOriginal': {'sourceGroups': 71, 'completedSemanticGroups': 69, 'sourceUnrun': ['H10', 'H11'],
                          'compiledUnrun': 71, 'stagedUnrun': 71, 'movedUnrun': 71, 'remainingLayoutGroups': 215,
                          'created': 289, 'deliveredCloseEvents': 288, 'H09': 'SAFETY_STOP_NO_RESCORE'},
    'recommendation': 'after blockers resolved and fresh GO, all71 fresh source in original order; not H09-only',
    'sourceGroupOrder': [case['id'] for case in old_seal['cases']],
    'exactFiniteProposedSequence': roles,
    'originalOtherChildrenRetained': {'total': 14, 'layouts': 3, 'typesPositive': 1, 'typesNegative': 4,
                                    'mutants': 3, 'bindingNegative': 3},
    'proposedFreshLayoutGroups': 284, 'repeatPriorSourceGroups': 69, 'originalRemainingGroupsCovered': 215,
    'proposedFreshBudgetRequiringSeparateApproval': {'aggregateInclusiveCleanupMs': 600000,
        'directChildren': 15, 'peakOwnedProcesses': 2, 'perChildMs': 120000, 'perGroupMs': 30000,
        'cleanupReserveMs': 5000, 'capturesBytes': 33554432, 'scratchBytes': 134217728,
        'admission': 'sequential; refuse when child maximum plus cleanup cannot fit remaining aggregate',
        'inheritsOld110MinuteBudget': False, 'enlargesCurrentQualificationAuthority': False},
    'prerequisites': ['authenticate immutable candidate source/archive and all original binding inputs before admission',
                      'verify archives before and after; do not overlay live product source',
                      'freeze executable successor observer and adapter bytes under fresh preseal',
                      'preserve original assertions and fixture/matrix bytes',
                      'new entries checked with explicitly declared directory/file coverage',
                      'any safety/capture/unknown-closure stop ends dependent work without retry'],
    'nativeGit': {'workflows': 6, 'status': 'HELD_UNRUN_UNCHANGED'}, 'productFix': None,
})
files = [{'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
         for path in sorted(ROOT.rglob('*')) if path.is_file()]
put('AUDIT.json', {
    'schema': 'v6-data-only-postcohort-audit', 'presealCommit': PRESEAL_COMMIT,
    'classification': 'data/hash authentication only; no observer or candidate imports or qualification replay',
    'observedResult': 'PARTIAL_HOLD', 'executedReal': 2, 'passedReal': 1, 'failedReal': 1,
    'executedSynthetic': 0, 'executedDataControls': 0, 'unexecuted': receipt['summary']['unexecuted'],
    'qualificationChildren': {'worker': 1, 'syntax': 0, 'standaloneControls': 0, 'candidate': 0, 'peakOwnedProcesses': 2},
    'naturalWorkerClosure': True, 'workerExit': 1, 'workerSignal': None,
    'knownChildCleanupSettled': True, 'realR02WriterCleanupSettled': False,
    'oldRegularFileInventoryPreserved': True, 'oldRegularFiles': len(actual_old),
    'newRegularFilesDetected': True, 'emptyNestedDirectoryAdditionsDetectedByCohortGuard': False,
    'newPresealInputsPreserved': True, 'nodeExecutableHashPreserved': True,
    'sourcePreparationFirstReliableWall': seal['firstReliablePreparationWall'], 'frozenWall': seal['frozenWall'],
    'cohortMonotonicThroughPreReceiptMs': receipt['aggregateIncludingCleanupMs'],
    'receiptFileMtimeNs': (ROOT / 'RUN-01/RECEIPT.json').stat().st_mtime_ns,
    'captureBytesIncludingReceipt': sum(path.stat().st_size for path in (ROOT / 'RUN-01').iterdir()),
    'publicationContentBytesExcludingThisAudit': sum(entry['bytes'] for entry in files),
    'filesExcludingThisAudit': files,
    'indexAtAuditSha256': sha(git('diff', '--cached', '--raw', '-z')),
    'metadataChildrenThisAudit': metadata_children,
    'auditMonotonicElapsedMs': (time.monotonic_ns() - START) / 1000000,
    'auditedWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'candidateContinuationAuthorized': False,
})
print(json.dumps({'audited': True, 'result': 'PARTIAL_HOLD', 'oldFiles': len(actual_old), 'metadataChildren': metadata_children,
                  'ownedBytes': sum(path.stat().st_size for path in ROOT.rglob('*') if path.is_file())}))
