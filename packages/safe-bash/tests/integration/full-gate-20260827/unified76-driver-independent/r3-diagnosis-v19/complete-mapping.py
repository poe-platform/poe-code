import base64
import collections
import gzip
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN = 'tests/integration/full-gate-20260827/unified76-driver-independent/r3-diagnosis-v19/'
BASE = 'tests/integration/full-gate-20260827/unified76-driver/'
RUN = 'c23a8de855f4f51423ee21c35ef5bbcc4d2d56a5'
PRODUCT = 'f5e9fc49b6abb38e180cc9de16c95fced102ff75'
SOURCE = 'f03c260269dfd8ee10666f7fd2560655f8e14a38'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git_blob(commit, path):
    assert pathlib.PurePosixPath(path).name.lower() != 'agents.md'
    size = int(subprocess.check_output(['git', '--no-replace-objects', 'cat-file', '-s', commit + ':' + path], timeout=30))
    assert size <= 64 * 1024 * 1024
    return subprocess.check_output(['git', '--no-replace-objects', 'show', commit + ':' + path], timeout=30)


def packed(commit, path, limit):
    compressed = base64.b64decode(b''.join(git_blob(commit, path).split()), validate=True)
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as decoder:
        raw = decoder.read(limit + 1)
    assert len(raw) <= limit
    return json.loads(raw)


def own(name):
    return json.loads((ROOT / OWN / name).read_text())


bindings = own('BINDINGS.json')
crosswalk = own('CROSSWALK.json')
filesystem = own('FILESYSTEM.json')
original = json.loads(git_blob(RUN, BASE + 'released-run-v3-qualified-h11/TAP-NONPASSING.json'))
details = {row['id']: row['detail'] for group in original['groups'] for row in group['cases']}
prior = json.loads(git_blob('e5ed3ecb87d0914e6967ece3da890ad8de7c844f',
    'tests/integration/full-gate-20260827/unified76-driver-independent/release-packet-v18/VERIFICATION.json'))
report = packed(RUN, BASE + 'released-run-v3-qualified-h11/raw-v1/inner/REPORT.json.gz.base64', 64 * 1024 * 1024)
external = packed(SOURCE, BASE + 'launcher-v3/EXTERNAL.json.gz.base64', 16 * 1024 * 1024)
profile = packed(SOURCE, BASE + 'launcher-v3/PROFILE.json.gz.base64', 32 * 1024 * 1024)
driver = json.loads(git_blob(SOURCE, BASE + 'launcher-v3/DRIVER.json'))
assert len(driver['files']) == 40
for name, expected in driver['files'].items():
    assert sha(git_blob(SOURCE, BASE + 'launcher-v3/' + name)) == expected
assert {row['path']: row['sha256'] for row in bindings['shipping']} == {row['path']: row['sha256'] for row in prior['shipping']}
assert prior['candidate'] == PRODUCT and prior['effectiveProfileSha256'] == report['profileSha256']
canonical = prior['canonicalRecords']
assert len(canonical) == 632
assert [row['path'] for row in canonical] == profile['canonicalFiles']
assert report['phases'][-1]['args'][-632:] == profile['canonicalFiles']
baseline = {row['path']: row for row in report['afterAuthorizedSetup']['entries']}
assert len(baseline) == len(report['afterAuthorizedSetup']['entries'])
for row in canonical:
    captured = report['archive']['files'][row['path']]
    assert captured['blob'] == row['blob'] and captured['sha256'] == row['sha256']
    assert captured['bytes'] == row['bytes'] and captured['mode'] == int(row['mode'], 8) & 511
    assert baseline[row['path']]['sha256'] == row['sha256']
    actual_blob = subprocess.check_output(['git', '--no-replace-objects', 'rev-parse', PRODUCT + ':' + row['path']], timeout=30).decode().strip()
    assert actual_blob == row['blob']
assert all(row['path'] not in baseline for row in filesystem['added'])

rules = [
 ('G01', r'/editflows/oracles\.test\.ts$', r'spawnSync /usr/bin/git EPERM', 'OBSERVED_ROUTE_FAILURE', 'Explicit forbidden selector at helpers.ts:50; raw EPERM identifies attempted pathname, not kernel denial-layer telemetry.', ['tests/commands/diff-patch-stress/editflows/helpers.ts:49', 'tests/commands/diff-patch-stress/editflows/oracles.test.ts:8']),
 ('G02', r'/diff-patch-stress/(gnu-auxiliary|gnu-target-followup|path-regressions|safety)/', r'/tmp/pp', 'OBSERVED_ORACLE_SCRATCH_FAILURE', 'Native patch temporary-file denial is in this row; fixed child env omits TMPDIR. Some product calls ran; valid native equivalence not established.', ['tests/commands/diff-patch-stress/gnu-auxiliary/helpers.ts:101', 'tests/commands/diff-patch-stress/gnu-target-followup/helpers.ts:60', 'tests/commands/diff-patch-stress/formats/helpers.ts:61']),
 ('G03', r'/gnu-target/calibration\.test\.ts$', r'/tmp/patcho', 'OBSERVED_ORACLE_IDENTITY_PROBE_FAILURE', 'Apple alternate version probe fails before calibration replay; not five GNU product results. Identity probe env omits TMPDIR.', ['tests/commands/diff-patch-stress/gnu-target/oracle.ts:37', 'tests/commands/diff-patch-stress/gnu-target/calibration.test.ts:40']),
 ('G04', r'/expr/inactive-prefix\.test\.ts$', r'signals\[0\].*AbortSignal.*StructuralSignal', 'UNRESOLVED_SIGNAL_CONTRACT_BOUNDARY', 'Branded AbortSignal.any rejects StructuralSignal before callback/checkpoint; six reason values do not establish native AbortController failure or Shell regression.', ['tests/commands/expr/inactive-prefix.test.ts:179', 'src/commands/regex-execution/client.ts:270', 'src/commands/expr/index.ts:16']),
 ('G05', r'/metadata-stress/(chmod-controls|permission-profile/qualification)\.test\.ts$', r'cannot establish initial mode for directory', 'UNRESOLVED_DIRECTORY_PRECONDITION', 'setMode wrapper loses underlying cause from TAP; chmod syscall versus exact-mode/identity assertion not distinguished. Not historical FILE eligibility.', ['tests/commands/metadata-stress/permission-profile/fixtures.ts:52', 'tests/commands/metadata-stress/permission-profile/fixtures.ts:69']),
 ('G06', r'/metadata-stress/native-differential\.test\.ts$', r"actualMode: '6051'", 'OBSERVED_DIFFERENTIAL_UNRESOLVED_RESPONSIBILITY', 'One aggregate 384-transition test records 32 distinct directory mismatch rows; native status1/virtual0 and modes differ. Native stderr/layer absent; no NA waiver.', ['tests/commands/metadata-stress/native-differential.test.ts:22', 'tests/commands/metadata-stress/native-differential.test.ts:34']),
 ('G07', r'/permission-profile/darwin-profile\.test\.ts$', r'exact Node version required', 'OBSERVED_FROZEN_VERSION_PREREQUISITE', 'Node22.22.2 predicate rejects Node24.11.1 before semantic controls; not fresh setid evidence.', ['tests/commands/metadata-stress/permission-profile/darwin-profile.test.ts:1']),
 ('G08', r'/search-stress/pipelines\.test\.ts$', r'command not found', 'OBSERVED_NATIVE_PIPELINE_ROUTE_FAILURE', 'Exact native Bash diagnostic lacks required pipeline command route; finite inherited PATH is not full oracle closure.', ['tests/commands/search-stress/harness.ts:25', 'tests/commands/search-stress/harness.ts:64', 'tests/commands/search-stress/pipelines.test.ts:9']),
 ('G09', r'/search-stress/(safety|streaming)\.test\.ts$', r'ℹ fail 0', 'OBSERVED_REPORTER_FIXTURE_MISMATCH', 'Children printed non-TAP summaries but wrappers require # pass10/6. Keep two wrapper failures and child summaries separate.', ['tests/commands/search-stress/safety.test.ts:7', 'tests/commands/search-stress/streaming.test.ts:7']),
 ('G10', r'/stream-inspection/native\.test\.ts$', r'7461633a206661696c656420746f20637265617465', 'OBSERVED_NATIVE_TAC_SCRATCH_FAILURE', 'Hex-encoded native tac error names /var/tmp/cutmp and Operation not permitted; one aggregate observation-array test, not every contained observation a failure.', ['tests/commands/stream-inspection/oracle.ts:1', 'tests/commands/stream-inspection/native.test.ts:1']),
 ('G11', r'/fs/real/adversarial\.test\.ts$', r'listen EINVAL', 'UNRESOLVED_SOCKET_SETUP_BOUNDARY', '110-byte path and EINVAL precede FS assertions. Path length plausible, not proved; socket listen lies before close-finally. No socket/network retry authorized.', ['tests/fs/real/adversarial.test.ts:220', 'tests/fs/real/adversarial.test.ts:223', 'tests/fs/real/adversarial.test.ts:227']),
 ('G12', r'/s3-http-exports/exports\.test\.ts$', r'spawnSync git EPERM', 'OBSERVED_NESTED_GIT_ROUTE_FAILURE', 'Verifier replaces verified PATH with NodeDir:/usr/bin:/bin then bare Git rev-parse. Attempted bare name captured, actual resolved executable not traced. Old prerequisite adapter does not wrap this invocation.', ['tests/integration/s3-http-exports/verify.mjs:19', 'tests/integration/s3-http-exports/verify.mjs:43', 'tests/integration/s3-http-exports/verify.mjs:62']),
 ('G13', r'/qualified-current-release-native-data/controls\.test\.ts$', r'spawnSync npm ENOENT', 'OBSERVED_MISSING_BARE_NPM_ROUTE', 'Bare npm dispatch fails before positional TAP assertion; explicit admitted npm CLI elsewhere does not supply alias.', ['tests/plugins/qualified-current-release-native-data/helpers.ts:26', 'tests/plugins/qualified-current-release-native-data/controls.test.ts:197']),
 ('G14', r'/script-entrypoint/holdout\.test\.ts$', r'0 !== 126', 'SOURCE_DERIVED_STALE_EXPECTATION_CONFLICT', 'Raw loop omits header identity; source accepts env -S branch while preceding three headers reject. Most precise source-derived attribution, not a newly measured per-header probe.', ['tests/shell-stress/script-entrypoint/cases.ts:131', 'src/shell/runtime.ts:1392', 'src/shell/runtime.ts:1407']),
 ('G15', r'/shell/(heredoc|inline-input-fatal-scope)\.test\.ts$', r'sh-thd-\d+', 'OBSERVED_NATIVE_SNAPSHOT_CONTAMINATION', 'TMPDIR equals native cwd, native-first file comparison sees sh-thd. Both native and virtual ran; earlier exit checks reached, later product file assertions not reached. Bash retention cause unproved.', ['tests/shell-stress/helpers.ts:39', 'tests/shell-stress/helpers.ts:74', 'tests/shell/heredoc.test.ts:143', 'tests/shell/inline-input-fatal-scope.test.ts:23'])
]
skip_rules = [
 (r'Python standard-library', 'PATH_ACCESS_DISCOVERY_UNAVAILABLE', 'PATH-only python3 access discovery false; three native/virtual oracle bodies not run; no machine-wide absence.', 'tests/commands/bytes-stress/helpers.ts:56'),
 (r'xxd tiny-width', 'PATH_ACCESS_DISCOVERY_UNAVAILABLE', 'PATH-only xxd access discovery false; no machine-wide absence.', 'tests/commands/bytes-stress/helpers.ts:56'),
 (r'^cksum:', 'DECLARED_DISCOVERY_ROUTES_EXHAUSTED', 'discover only swallows ENOENT; source plus skip supports exhausted declared routes, not machine-wide cksum absence.', 'tests/commands/bytes/checksums/native.test.ts:23'),
 (r'^native Vim xxd:', 'ANY_SPAWN_ERROR_COLLAPSED_TO_SKIP', 'xxd -v error becomes skip regardless errno; exact underlying error unavailable.', 'tests/commands/bytes/encoding/oracle.test.ts:35'),
 (r'^optional GNU replay', 'OPT_IN_PROFILE_DISABLED', 'Replay flag absent/not1; GNU additionally requires independently frozen capture; no parity credit.', 'tests/commands/grep-aliases/native.test.ts:28'),
 (r'^optional BSD replay', 'OPT_IN_PROFILE_DISABLED', 'Replay flag absent/not1; fixed BSD profile not replayed.', 'tests/commands/grep-aliases/native.test.ts:46')
]
for row in crosswalk:
    if row['status'] == 'fail':
        matches = [rule for rule in rules if re.search(rule[1], row['sourcePath']) and re.search(rule[2], details[row['id']])]
        assert len(matches) == 1, row['id']
        group, _, _, label, reason, anchors = matches[0]
        assert group == row['authorGroup']
        row.update(independentGroup=group, classification=label, reason=reason, sourceAnchors=anchors,
                   confidence='raw symptom + pinned static callpath; causal limits stated', noPassCredit=True)
    else:
        matches = [rule for rule in skip_rules if re.search(rule[0], row['name'])]
        assert len(matches) == 1
        _, label, reason, anchor = matches[0]
        row.update(independentGroup='SKIP', classification=label, reason=reason, sourceAnchors=[anchor],
                   confidence='recorded skip + pinned predicate; no new availability probe', noPassCredit=True)
group_members = {rule[0]: [row['id'] for row in crosswalk if row.get('independentGroup') == rule[0]] for rule in rules}
assert len(set(identifier for members in group_members.values() for identifier in members)) == 132
g06 = details[group_members['G06'][0]]
mismatch_iterations = [int(value) for value in re.findall(r'\+\s+iteration: (\d+)', g06)]
assert len(mismatch_iterations) == len(set(mismatch_iterations)) == 32
g10 = details[group_members['G10'][0]]
tac_messages = sorted(set(bytes.fromhex(value).decode() for value in re.findall(r"stderrHex: '([0-9a-f]+)'", g10) if value.startswith('7461633a')))
assert tac_messages and all('/var/tmp/cutmp' in text and 'Operation not permitted' in text for text in tac_messages)
for row in filesystem['added']:
    if '/.native-' in row['path']:
        row['originChain'] = ['tests/commands/table-text-stress/corpus.test.ts:27', 'tests/commands/table-text-stress/support.ts:52']
        row['ownership'] = 'Node fixture creates directory/left/right/sentinel; native child executes there; native() has no finally/removal.'
    elif row['path'].endswith('/.runtime'):
        row['originChain'] = ['tests/commands/table-text-stress/shared-stdin-fix/support.ts:49', 'tests/commands/table-text-stress/shared-stdin-fix/support.ts:77']
        row['ownership'] = 'verifyOracle parent survives; child-only finally disposal does not remove parent.'
    else:
        assert row['path'].endswith('/.runs')
        row['originChain'] = ['tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts:37']
        row['ownership'] = 'Node test parent survives; context.after owns only mkdtemp child.'
    row['absentInCapturedPostSetupBaseline'] = True
    row['writerPidOrSyscallNotCaptured'] = True

compiler = next(row for row in external['directories']['main']['entries'] if row['path'] == 'typescript/bin/tsc')
compiler_impl = next(row for row in external['directories']['main']['entries'] if row['path'] == 'typescript/lib/_tsc.js')
benchmark_ts = [row for row in external['directories']['benchmarks']['entries'] if row['path'] == 'typescript' or row['path'].startswith('typescript/')]
assert not benchmark_ts
benchmark_lock = json.loads(git_blob(PRODUCT, 'benchmarks/package-lock.json'))
assert not any(name.endswith('/typescript') for name in benchmark_lock['packages'])
root_lock = json.loads(git_blob(PRODUCT, 'package-lock.json'))
assert root_lock['packages']['node_modules/typescript']['version'] == '5.9.3'
assert report['driverProductionBuilds'] == 1
assert report['phases'][3]['label'] == 'benchmark-types' and report['phases'][3]['status'] == 1
assert report['phases'][3]['args'] == [str(pathlib.PurePosixPath(report['temporary']) / 'source/benchmarks/node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json']
source_hashes = {row['path']: row for row in bindings['sourceBindings']}
extra_source = []
for path in ['src/commands/execution.ts', 'src/commands/env-split.ts', 'tests/commands/metadata-stress/helpers.ts']:
    raw = git_blob(PRODUCT, path)
    extra_source.append({'path': path, 'commit': PRODUCT, 'bytes': len(raw), 'sha256': sha(raw)})
for row in crosswalk:
    row['anchorBindings'] = []
    for anchor in row['sourceAnchors']:
        path = anchor.rsplit(':', 1)[0]
        info = source_hashes[path]
        row['anchorBindings'].append({'path': path, 'sha256': info['sha256'], 'blob': info['blob']})

supplement = {
 'schema': 1, 'method': 'independent exact raw-pattern and frozen-source attribution, no subject execution',
 'groups': [{'id': rule[0], 'count': len(group_members[rule[0]]), 'members': group_members[rule[0]], 'classification': rule[3], 'qualification': rule[4], 'sourceAnchors': rule[5]} for rule in rules],
 'requestedRollups': {'nativePatchTemporary': group_members['G02'] + group_members['G03'], 'nativeShellTemporary': group_members['G15'], 'gitRoutes': group_members['G01'] + group_members['G12'], 'searchPathReporter': group_members['G08'] + group_members['G09']},
 'noGroupOverlap': True, 'remainingFailures': [row['id'] for row in crosswalk if row['status'] == 'fail' and row['independentGroup'] not in ['G01','G02','G03','G08','G09','G12','G15']],
 'directoryAggregate': {'testId': group_members['G06'][0], 'staticLoopBound': 384, 'recordedMismatchRows': 32, 'iterations': mismatch_iterations, 'independentTapFailures': 1, 'noNativeStderrCauseAvailable': True},
 'tacDiagnosticsDecoded': tac_messages,
 'canonical': {'exactArgMembership': 632, 'archiveAndBaselineBodyMetadataMatches': 632, 'gitBlobsMatched': 632, 'previousBodyProof': 'e5ed3ecb87d0914e6967ece3da890ad8de7c844f', 'membershipBodySha256': prior['canonicalMembershipBodySha256'], 'notRerun': True},
 'sourceGuard': {'baselineEntryCount': len(baseline), 'baselineSha256': report['afterAuthorizedSetup']['sha256'], 'all286AbsentBefore': True, 'capturedErrorEnumeratesExactly286Added': True, 'noAfterTreeRescanOrPrivateRead': True},
 'shipping': {'count': 41, 'all40DriverMembersMatch': True, 'byteIdenticalToAcceptedMetadataReview': True, 'actualOsFenceModuleSha256': next(row['sha256'] for row in bindings['shipping'] if row['path'].endswith('/os-instruction-fence.mjs')), 'renderedAttemptFenceSha256': report['osInstructionFence']['profileSha256'], 'effectiveProfileSha256': report['profileSha256'], 'strictProfileSha256': prior['strictProfileSha256'], 'historicalEligibilitySha256': prior['historicalEligibilitySha256']},
 'benchmark': {'phaseStarted': True, 'phaseStatus': 1, 'compilerExecuted': False, 'measuredMissingRouteFailureNotProspectiveOnly': True, 'rootCompilerVersion': '5.9.3', 'rootCompilerEntry': compiler, 'rootCompilerImplementation': compiler_impl, 'benchmarkCompilerEntries': 0, 'benchmarkLockCompilerEntries': 0, 'requiredRepair': 'new maintained execute.mjs explicit authenticated root compiler with benchmark cwd, --noEmit -p tsconfig.json; preserve audit and dependencies; not authored or executed'},
 'private': {'capturedComparisonUnchanged': report['privateUnchanged'], 'capturedChangedFiles': report['privateFileChanges'], 'capturedCopyCount': bindings['privateCapturedOnly']['copiedFiles'], 'noPrivateSourceInspected': True, 'noFreshCheck': True, 'noGlobalCleanClaim': True},
 'metadataQueryCorrections': ['Readonly source filename query instruction-fence.mjs did not exist; actual bound os-instruction-fence.mjs located; no writes or execution.', 'Ad-hoc metadata query indexed report.external.directories as dict; it is a list (TypeError). Authenticated EXTERNAL manifest used for compiler membership. No subject execution/retry or artifact output from failed query.'],
 'extraSourceBindings': extra_source,
 'noNewGateOrRepairAuthorization': True, 'allRawFailuresAndSkipsRetained': True,
 'scriptSha256': sha((ROOT / OWN / 'complete-mapping.py').read_bytes())}
patch = '*** Begin Patch\n'
for name, value in [('CROSSWALK.json', crosswalk), ('FILESYSTEM.json', filesystem)]:
    previous = (ROOT / OWN / name).read_text()
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'
    patch += '*** Update File: ' + OWN + name + '\n@@\n-' + previous.rstrip('\n') + '\n+' + text
assert not (ROOT / OWN / 'ASSESSMENT.json').exists()
patch += '*** Add File: ' + OWN + 'ASSESSMENT.json\n+' + json.dumps(supplement, ensure_ascii=False, separators=(',', ':')) + '\n*** End Patch\n'
subprocess.run(['apply_patch'], input=patch.encode(), check=True, timeout=30)
print(json.dumps({'classified': len(crosswalk), 'rollups': {key:len(value) for key,value in supplement['requestedRollups'].items()}, 'remaining': len(supplement['remainingFailures']), 'canonicalBindings': 632, 'directoryMismatchRowsNotTestCount': 32}))
