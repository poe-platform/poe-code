import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
HERE = Path(__file__).resolve().parent
TEMPORARY = Path('/private/tmp/safe-bash-zero-overlay-independent-v3-7tzzo6fn')
RAW = TEMPORARY / 'raw'
DESTINATION = HERE / 'attempt-01'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


def add(path, data):
    assert path.is_relative_to(HERE) and not path.exists()
    if not isinstance(data, bytes):
        data = (json.dumps(data, indent=2) + '\n').encode()
    assert not data or data.endswith(b'\n')
    text = data.decode('utf8')
    patch = f'*** Begin Patch\n*** Add File: {path.relative_to(REPOSITORY)}\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), cwd=REPOSITORY, stdout=subprocess.DEVNULL, check=True)
    assert path.read_bytes() == data


def main():
    assert Path.cwd() == REPOSITORY
    summary = load(RAW / 'independent-summary.json')
    assert summary['allPass'] and len(summary['runs']) == 3
    bindings = load(HERE / 'execution/BINDINGS.json')
    source_assessor = (HERE / 'execution/assess.py').read_bytes()
    assert sha(source_assessor) == load(HERE / 'execution/LOCATION-PROOF.json')['assessorUnchangedSha256']
    sys.path.insert(0, str(HERE / 'execution'))
    from assess import CONTROLS, LIFECYCLE, SURFACE, lifecycle_check, surface_check
    surface_root = list(RAW.glob('surface-zero-overlay-*/results'))
    assert len(surface_root) == 1
    roots = {'surface': surface_root[0], 'lifecycle': RAW / 'lifecycle-raw', 'controls': RAW / 'controls-raw'}
    selected = {'surface': [row for row in SURFACE['cases'] if not row.get('conditional')], 'lifecycle': LIFECYCLE['rows'], 'controls': CONTROLS['rows']}
    rows = []
    network_rows = []
    private_pairs = []
    parents = []
    for cohort in ['surface', 'lifecycle', 'controls']:
        assessment = load(RAW / f'independent-{cohort}/independent-assessment.json')
        run = load(RAW / f'independent-{cohort}/run.json')
        assert run['status'] == 'PASS' and run['parentExitCode'] == 0
        assert run['privateUnchanged'] and run['inputsUnchanged']
        parent = load(roots[cohort] / ('journal.json' if cohort == 'surface' else 'report.json'))
        assert [entry['id'] for entry in parent['children']] == [row['id'] for row in selected[cohort]]
        assert all(entry['closed'] and entry['code'] == 0 and not entry.get('signal') and not entry.get('containment') for entry in parent['children'])
        parents.append({'cohort': cohort, 'command': run['command'], 'started': run['parentStarted'], 'closed': run['parentClosed'], 'exitCode': run['parentExitCode'],
            'children': [{'id': child['id'], 'pid': child['pid'], 'code': child['code'], 'closed': child['closed']} for child in parent['children']],
            'importJournals': len(assessment['imports']), 'importEntries': sum(entry['entries'] for entry in assessment['imports']),
            'engineFilesPerChild': sorted(set(entry['engineFiles'] for entry in assessment['imports'])),
            'cleanup': parent.get('cleanup'), 'innerGuardInputUnchanged': parent.get('inputTreesUnchanged', parent.get('sharedUnchanged'))})
        for layer, location in [('outer', RAW / f'independent-{cohort}'), ('inner', roots[cohort])]:
            before = load(location / 'private-before.json')
            after = load(location / 'private-after.json')
            comparable = lambda value: {key: item for key, item in value.items() if key != 'at'}
            assert comparable(before) == comparable(after)
            assert before['head'] == 'bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e'
            assert len(before['metadata']) == 6 and len(before['engine']) == 264
            assert before['status'] == load(Path(bindings['statusAuthorRoot']) / 'PRIVATE-STATUS.json')['expectedStatus']
            private_pairs.append({'cohort': cohort, 'layer': layer, 'beforeSha256': sha((location / 'private-before.json').read_bytes()),
                'afterSha256': sha((location / 'private-after.json').read_bytes()), 'freshStateExact': True, 'observationTimestampExcludedOnlyIfPresent': 'at' in before,
                'head': before['head'], 'tree': before['tree'], 'statusSha256': sha(before['status'].encode()), 'indexSha256': before['index']['sha256'],
                'metadataFiles': 6, 'engineFiles': 264})
        for selected_row in selected[cohort]:
            path = roots[cohort] / selected_row['id'] / 'actual.json' if cohort == 'surface' else roots[cohort] / (selected_row['id'] + '.json')
            raw = load(path)
            (surface_check if cohort == 'surface' else lifecycle_check)(raw, selected_row)
            rows.append({'cohort': cohort, 'id': selected_row['id'], 'rawSha256': sha(path.read_bytes()), 'independentPredicate': 'PASS', 'actualEngineRuns': raw.get('runtimeCalls', raw.get('engineRuns')),
                'qualification': 'DIALECT_ONLY' if selected_row['id'].startswith('07-') else 'OBSERVED_AWAIT_REJECTION' if selected_row['id'].startswith('08-') else 'EXACT_FROZEN_PROFILE'})
            if cohort != 'surface' and selected_row['workflow'] == 'L06':
                names = ['transport-cleanup-registered', 'transport-upload-received', 'upload-eof', 'transport-response-created', 'transport-cleanup-done', 'response-disposed', 'curl-invoke-settled', 'safejs-invoke-settled', 'public-exec-settled']
                network_rows.append({'cohort': cohort, 'id': raw['id'], 'network': raw['network'], 'zeroPolicy': raw.get('zeroPolicy'),
                    'publicOutcome': raw['publicOutcome'], 'files': raw['files'], 'curlInputs': selected_row.get('curlInputs', LIFECYCLE['curlInputs']),
                    'streamingState': {key: raw['atSettlement'][key] for key in ['uploadBeforeEof', 'uploadEof', 'transportClosed', 'responseDisposed', 'transportAbortedByConsumer']},
                    'events': [event for event in raw['events'] if event['event'] in names]})
    assert len(rows) == 25 and sum(row['actualEngineRuns'] for row in rows) == 25
    assert len(network_rows) == 8
    precedence = load(roots['lifecycle'] / 'L05-execution-error.json')
    surface08 = load(roots['surface'] / '08-function-spread-profile/actual.json')
    host = load(RAW / 'finite-host-controls/RESULT.json')
    assert host['pass'] == host['controls'] == 9 and host['guestExecutions'] == 0
    negatives = load(RAW / 'data-negatives.json')
    assert negatives['allRejected'] and len(negatives['controls']) == 7
    sources = []
    for cohort, root in roots.items():
        for path in sorted(root.rglob('*')):
            if path.is_file():
                sources.append((path, Path('raw') / cohort / path.relative_to(root)))
    for name in ['independent-surface', 'independent-lifecycle', 'independent-controls', 'finite-host-controls']:
        for path in sorted((RAW / name).rglob('*')):
            if path.is_file():
                sources.append((path, Path('raw') / name / path.relative_to(RAW / name)))
    for path in sorted(RAW.iterdir()):
        if path.is_file():
            sources.append((path, Path('raw') / path.name))
    for name in ['outer.stdout.txt', 'outer.stderr.txt']:
        sources.append((TEMPORARY / name, Path('raw') / name))
    captures = []
    for source, target in sources:
        assert source.resolve() == source and not source.is_symlink()
        assert source.suffix in ['.json', '.txt', '.log', '.ndjson']
        data = source.read_bytes()
        add(DESTINATION / target, data)
        captures.append({'path': target.as_posix(), 'source': str(source), 'bytes': len(data), 'sha256': sha(data)})
    add(DESTINATION / 'CAPTURE-MANIFEST.json', {'rawFiles': len(captures), 'rawBytes': sum(entry['bytes'] for entry in captures), 'files': captures,
        'rawCopyMethod': 'apply_patch exact UTF-8 bytes, verified after write; zero normalization', 'privateSourceBytesVendored': False,
        'excludedScratch': 'Actual engine/product/tool/input trees retained in regular TMP or removed naturally by frozen parents, never copied as source into repository.'})
    add(DESTINATION / 'RESULTS.json', {'reviewerIdentity': 'Codex Independent Leaf Verifier', 'thread': '01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4',
        'statusAdmissionCommit': '758880944964ed1bb9f9cbb524dfeb14e88b3047', 'executionFreezeCommit': '63d730a48ab0048fc16561164d6eeedb5f6cf1d1',
        'hostControlFreezeCommit': 'd05932474728a93e416ecb23eb2a1c925571dfa9', 'attemptClass': 'ONE_NEW_AUTHORIZED_ATTEMPT_AFTER_TWO_PRESERVED_ZERO_RUNTIME_REFUSALS',
        'scheduled': 25, 'actualEngineRuns': 25, 'pass': 25, 'fail': 0, 'blocked': 0, 'runtimeRetries': 0,
        'cohorts': [run['counts'] | {'cohort': run['cohort']} for run in summary['runs']], 'rows': rows, 'networkRows': network_rows,
        'surface08': {'engineOutcome': surface08['engineOutcome'], 'engineFieldPresent': 'engine' in surface08, 'shell': surface08['shell'], 'events': surface08['events'],
            'reasonCaptureLimit': 'Only typeof and null tag captured, exact rethrow established by frozen observer code and finite reference controls; no raw reason object exposure/serialization.'},
        'L05': {key: precedence[key] for key in ['variantId', 'publicSource', 'publicSourceBytes', 'selector', 'publicOutcome', 'events']},
        'privatePairs': private_pairs, 'parents': parents, 'knownLiveCaseChildren': 0, 'knownLiveCohortParents': 0, 'knownLiveFiniteHostChildren': 0,
        'closureBasis': 'All spawned case children close/exit0 in exact raw parent journals; all three Python-supervised parents return0 naturally, plus finite host process return0. No global/opaque-host handle claim.',
        'hostControls': host, 'dataOnlyNegatives': negatives, 'privateQueriesForHostAndRawAssessment': 0,
        'source': {key: bindings[key] for key in ['authorFreezeCommit', 'sourceManifestSha256', 'candidateManifestSha256', 'compiledManifestSha256', 'packageManifestSha256', 'privateStatusProfileSha256']},
        'noPromotion': True})
    print(json.dumps({'rawFiles': len(captures), 'rawBytes': sum(entry['bytes'] for entry in captures), 'actualRows': 25, 'networkRows': 8, 'freshPrivatePairs': len(private_pairs), 'hostControls': 9, 'dataOnlyNegatives': 7}))


if __name__ == '__main__':
    main()
