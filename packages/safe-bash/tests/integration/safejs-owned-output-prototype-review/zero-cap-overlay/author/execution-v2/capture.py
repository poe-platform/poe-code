import base64
import gzip
import json
from pathlib import Path
import sys


REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
OWNER = Path(__file__).resolve().parent
BINDING = OWNER.parent / 'status-binding-v2'
sys.path.insert(0, str(BINDING))
import shared
from binding import expected_private_profile, historical_schema


def read(path):
    return shared.load(path)


def optional(path):
    return read(path) if Path(path).is_file() else None


def wrapped_base64(value):
    encoded = base64.b64encode(value).decode()
    return ''.join(encoded[offset:offset + 76] + '\n' for offset in range(0, len(encoded), 76))


def copy_raw(root_name, source_root, entry):
    source = source_root / entry['path']
    value = shared.regular(source)
    assert shared.sha(value) == entry['sha256'] and len(value) == entry['bytes']
    assert source.suffix in ['.json', '.log', '.txt', '.ndjson']
    relative = Path('attempt-02/raw') / root_name / entry['path']
    encoding = 'identity'
    try:
        text = value.decode('utf-8')
        patch_exact = ''.join(line + '\n' for line in text.splitlines()) == text
    except UnicodeDecodeError:
        patch_exact = False
    if len(value) > 131072:
        relative = Path(str(relative) + '.gz.base64-data')
        text = wrapped_base64(gzip.compress(value, mtime=0))
        encoding = 'gzip+base64'
    elif not patch_exact:
        relative = Path(str(relative) + '.base64-data')
        text = wrapped_base64(value)
        encoding = 'base64'
    shared.put(OWNER / relative, text)
    stored = shared.regular(OWNER / relative)
    decoded = stored if encoding == 'identity' else base64.b64decode(stored)
    if encoding == 'gzip+base64':
        decoded = gzip.decompress(decoded)
    assert decoded == value
    return {'root': root_name, 'source': str(source), 'original': entry, 'storedPath': relative.as_posix(), 'encoding': encoding, 'stored': shared.record(OWNER / relative), 'decodedMatchesOriginal': True}


def main():
    preparation = read(BINDING / 'PREPARATION.json')
    profile = read(OWNER / 'RUN-PROFILE.json')
    temporary = Path(profile['temporary'])
    attempt = Path(profile['attemptRoot'])
    controller = Path(profile['controllerCapture'])
    replay = read(attempt / 'REPLAY.json')
    completion = read(controller / 'COMPLETION.json')
    expected = expected_private_profile()
    roots = {'controller': controller, 'outer': attempt, **{entry['cohort']: Path(entry['rawRoot']) for entry in replay['cohorts'] if entry.get('rawRoot')}}
    before = {name: {'files': shared.inventory(root, True), 'shape': shared.shape(root)} for name, root in roots.items()}
    copies = [copy_raw(name, root, entry) for name, root in roots.items() for entry in before[name]['files']]
    after = {name: {'files': shared.inventory(root, True), 'shape': shared.shape(root)} for name, root in roots.items()}
    assert after == before
    capture_manifest = {'at': shared.now(), 'role': 'AUTHOR_EXACT_RAW_BYTE_CAPTURE_NOT_REPLAY', 'sourceRoots': {name: str(root) for name, root in roots.items()},
        'files': copies, 'fileCount': len(copies), 'originalBytes': sum(entry['original']['bytes'] for entry in copies),
        'storedBytes': sum(entry['stored']['bytes'] for entry in copies), 'sourceInventoryBeforeAfterExact': True,
        'sourceInventories': before, 'captureManifestSha256': shared.sha(shared.encoded(copies)),
        'encodingRule': 'Exact UTF-8/LF files kept directly; files over128KiB gzip(mtime0)+base64; other non-patch-exact bytes base64. Every decoded copy compared byte-for-byte.',
        'privateSourceContentsCopied': False, 'sourceSelection': 'Only explicit controller/outer/per-cohort result directories; never copied product, engine, node_modules or private checkout trees.', 'noPromotion': True}
    shared.put(OWNER / 'attempt-02/CAPTURE-MANIFEST.json', capture_manifest)
    assessments = {entry['cohort']: read(attempt / entry['cohort'] / 'assessment.json') for entry in replay['cohorts'] if (attempt / entry['cohort'] / 'assessment.json').is_file()}
    counts = {key: sum(value['counts'][key] for value in assessments.values()) for key in ['total', 'launched', 'engineRuns', 'pass', 'failed', 'blocked', 'invalid', 'unproved']}
    count_report = {'at': shared.now(), 'role': 'AUTHOR_RESULT_NOT_INDEPENDENT_ACCEPTANCE', 'scheduled': {'surface': 8, 'lifecycle': 11, 'controls': 6},
        'cohorts': {name: {'status': value['status'], 'counts': value['counts'], 'inputOrFixtureBindingBlocker': value['inputOrFixtureBindingBlocker']} for name, value in assessments.items()},
        'observed': counts, 'wrapperInvocations': 1, 'nodeParentControllers': sum(bool(entry.get('launched')) for entry in replay['cohorts']),
        'newActualAttempts': 1, 'automaticReruns': 0, 'stopReason': replay['stopReason'], 'wrapperExitCode': completion['wrapperExitCode'],
        'priorRefusal': {'commit': '06426bb62b6cc79f0be04dbf208efd17cfb84082', 'nodeExecutions': 0, 'guestExecutions': 0, 'blocked': 25, 'unchanged': True}, 'noPromotion': True}
    shared.put(OWNER / 'COUNTS.json', count_report)
    closures = []
    imports = []
    critical = []
    special_profiles = []
    parent_summaries = []
    for entry in replay['cohorts']:
        cohort = entry['cohort']
        directory = attempt / cohort
        raw_root = Path(entry['rawRoot'])
        first = read(directory / 'private-before.json')
        last = read(directory / 'private-after.json')
        parent_first = read(raw_root / 'private-before.json')
        parent_last = read(raw_root / 'private-after.json')
        parent_comparable = lambda value: {key: item for key, item in value.items() if key != 'at'}
        parent_expected = lambda value: {key: value[key] for key in expected}
        journal = read(raw_root / ('journal.json' if cohort == 'surface' else 'report.json'))
        closure = {'cohort': cohort, 'outerPrivateBeforeAfterExact': first == last, 'outerHistoricalProfileExact': historical_schema(first) == expected and historical_schema(last) == expected,
            'outerPrivateBefore': shared.record(directory / 'private-before.json'), 'outerPrivateAfter': shared.record(directory / 'private-after.json'),
            'privateHead': first['head'], 'privateTree': first['tree'], 'privateIndex': first['index'], 'privateStaging': first['staged'], 'expectedFullStatus': first['status'],
            'metadataFiles': len(first['metadata']), 'engineFiles': len(first['engine']), 'engineShapeEntries': len(first['engineShape']),
            'outerQueryQualification': first['qualification'], 'parentBeforeAfterExactExceptSurfaceObservationTimestamp': parent_comparable(parent_first) == parent_comparable(parent_last),
            'parentHistoricalFieldsExact': parent_expected(parent_first) == expected and parent_expected(parent_last) == expected,
            'parentBefore': shared.record(raw_root / 'private-before.json'), 'parentAfter': shared.record(raw_root / 'private-after.json'),
            'outerSharedUnchanged': entry['sharedUnchanged'], 'outerInputsUnchanged': entry['inputsUnchanged'],
            'parentDriverExitCode': entry['exitCode'], 'parentControllerReaped': entry['knownControllerReaped'], 'containment': entry['containment'],
            'parentChildren': journal['children'], 'parentClosure': journal.get('cleanup', journal.get('parentAfter')),
            'parentFailures': journal.get('failures', []), 'parentAfterGuardFailure': journal.get('afterGuardFailure'), 'parentPrivateAfterFailure': journal.get('privateAfterFailure')}
        closures.append(closure)
        parent_summaries.append({'cohort': cohort, 'pid': entry['pid'], 'reaped': entry['knownControllerReaped'], 'exitCode': entry['exitCode'], 'containment': entry['containment'], 'children': len(journal['children']), 'closure': closure['parentClosure']})
        for row in assessments[cohort]['rows']:
            imports.append({'cohort': cohort, 'id': row['id'], **row['imports']})
            finding = row.get('critical') or {}
            if 'network' in finding:
                network = finding['network']
                state = finding['atSettlement']
                policy = finding.get('zeroPolicy') or {}
                critical.append({'cohort': cohort, 'id': row['id'], 'classification': row['classification'], 'curlStatus': state['curlStatus'],
                    'authorizationEntries': len(network['authorizationJournal']), 'transportEntries': len(network['transportJournal']),
                    'network': network, 'positions': finding['positions'], 'atSettlement': state, 'zeroPolicy': policy, 'files': finding['files'],
                    'public': row['public'], 'checks': row['checks'], 'rawEvidenceRoot': str(raw_root)})
            if row['id'].startswith(('07-', '08-')) or row['id'] == 'L05-execution-error':
                special_profiles.append({'cohort': cohort, **row})
    assert shared.snapshot(preparation['immutableRoots']) == read(BINDING / 'PREPARATION-INPUTS.json')
    assert shared.snapshot(preparation['sharedRoots']) == read(BINDING / 'PREPARATION-SHARED.json')
    assert shared.verify_freeze() == profile['bindingPreparationCommit']
    release_commit = shared.git('log', '-1', '--format=%H', '--', (OWNER / 'ROOT-RELEASE.json').relative_to(REPOSITORY).as_posix()).decode().strip()
    assert release_commit == 'e9a30aa7995e4b29ba179d0aea552c36a5ded51f'
    assert shared.sha(shared.regular(OWNER / 'ROOT-RELEASE.json')) == profile['rootDescriptorSha256']
    closure_report = {'at': shared.now(), 'role': 'AUTHOR_CAPTURED_CLOSURE_NOT_PRIVATE_REQUERY', 'cohorts': closures,
        'outerFreshPrivatePairs': len(closures), 'parentFreshPrivatePairs': len(closures), 'privateQueriesDuringCapture': 0,
        'postCaptureImmutableInputsMatchFreeze': True, 'postCaptureSharedInputsMatchFreeze': True, 'bindingFreezeAndRootDescriptorUnchanged': True,
        'parentControllers': parent_summaries, 'allParentControllersReaped': all(entry['reaped'] for entry in parent_summaries),
        'queryDiscipline': 'All three outer before/after snapshots use GIT_OPTIONAL_LOCKS=0 and per-command core.fsmonitor=false. Parent guard functions remain exactly reviewed; no fresh capture-time private query.',
        'scopeLimit': 'Full recorded before/after status/index/metadata/eligible engine files and directory shape; no atime, excluded-subtree append proof or atomic/intervening-state claim.', 'noPromotion': True}
    shared.put(OWNER / 'CLOSURE.json', closure_report)
    shared.put(OWNER / 'CRITICAL-EVENTS.json', {'at': shared.now(), 'curlRows': critical, 'specialProfiles': special_profiles,
        'interpretation': 'Observed data and frozen checks, not new or repaired assertions; Surface07 dialect only, Surface08 awaited rejection, L05 NEW selected rejection, L06 NEW source profile of original workflow.', 'noPromotion': True})
    shared.put(OWNER / 'IMPORT-AUTHENTICATION.json', {'rows': imports, 'totalProfiles': len(imports), 'totalImportRecords': sum(row['entries'] for row in imports),
        'importFailures': sum(len(row['failures']) for row in imports), 'inputInventories': 'Exact original88/runtime38 plus source213/compiled708/full940/package709 and authenticated copied engine264/tools.',
        'runtimeProfile': 'Actual private source-hook imports from authenticated regular copies; not private barrel/CLI or installed private package.', 'noPromotion': True})
    shared.put(OWNER / 'PROVENANCE.json', {'at': shared.now(), 'authorFreezeCommit': shared.AUTHOR_COMMIT, 'sourceAdmissionCommit': shared.ADMISSION_COMMIT,
        'bindingPreparationCommit': profile['bindingPreparationCommit'], 'bindingReviewCommit': profile['bindingReviewCommit'], 'bindingReviewPath': profile['bindingReviewPath'],
        'bindingReviewSha256': profile['bindingReviewSha256'], 'releaseCommit': release_commit, 'rootDescriptorSha256': profile['rootDescriptorSha256'],
        'bindingFreezeSha256': shared.sha(shared.regular(BINDING / 'EXECUTION-FREEZE.json')), 'privateStatusProfileSha256': shared.sha(shared.regular(BINDING / 'PRIVATE-STATUS.json')),
        'node': profile['node'], 'sourceIdentities': profile['sourceIdentities'], 'wrapperStarted': replay['started'], 'wrapperFinished': replay['finished'],
        'rawRoots': {name: str(root) for name, root in roots.items()}, 'captureCount': len(copies), 'captureOriginalBytes': capture_manifest['originalBytes'],
        'captureManifestSha256': shared.sha(shared.regular(OWNER / 'attempt-02/CAPTURE-MANIFEST.json')), 'independentActualResultsConsulted': False,
        'sourceFixtureAssertionChanges': 0, 'privateSourceContentsCommitted': False, 'noPromotion': True})
    shared.put(OWNER / 'DIAGNOSTICS.json', {'authorWrapperPreparationFailures': [], 'launcherFailure': completion['launcherFailure'],
        'wrapperExitCode': completion['wrapperExitCode'], 'wrapperStderrBytes': completion['stderr']['bytes'],
        'runtimeContainments': [entry['containment'] for entry in replay['cohorts']], 'runtimeGuardFailures': [],
        'postRunInspectionOnly': [{'error': "KeyError: 'network'", 'context': 'A host-only summary query assumed every lifecycle critical object was a curl network object; non-curl critical objects have different keys.',
            'action': 'Narrowed the data-summary selection to objects with a network field. No runtime/source/fixture/scorer/assertion changed; no replay.', 'rawTranscript': 'postprocessing-diagnostics/query-01.txt'}],
        'priorRefusalUnchanged': '06426bb62b6cc79f0be04dbf208efd17cfb84082 preserves both primary historical-status refusal and secondary missing-before-snapshot reporting failure.', 'noPromotion': True})
    print(json.dumps({'captureFiles': len(copies), 'originalBytes': capture_manifest['originalBytes'], 'storedBytes': capture_manifest['storedBytes'],
        'counts': counts, 'criticalCurlRows': len(critical), 'outerPrivatePairs': len(closures), 'parentPrivatePairs': len(closures),
        'allParentControllersReaped': closure_report['allParentControllersReaped'], 'privateCaptureQueries': 0}))


if __name__ == '__main__':
    main()
