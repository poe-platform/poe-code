import base64
import copy
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BINDINGS = json.loads((HERE / 'BINDINGS.json').read_bytes())
INPUTS = Path(BINDINGS['authorRoot'])
SURFACE = json.loads((INPUTS / 'surface/CASES.json').read_bytes())
LIFECYCLE = json.loads((INPUTS / 'lifecycle/CASES.json').read_bytes())
CONTROLS = json.loads((INPUTS / 'controls/CASES.json').read_bytes())
REVISION = json.loads((INPUTS / 'lifecycle/REVISION.json').read_bytes())


def equal(actual, expected):
    assert actual == expected, (actual, expected)


def surface_check(raw, selected):
    expected = selected['expected']
    equal(raw['id'], selected['id'])
    equal(raw['runtimeCalls'], 1)
    equal(raw['premise']['actualMetadata'], True)
    equal(raw['premise']['metadataSignalSameAsPublicPipe'], True)
    equal(raw['hostCounters'], expected['hostCounters'])
    assert not raw.get('failure')
    equal(raw['hostFindings'], [])
    equal(raw['cleanupFailures'], [])
    for key in ['rejected', 'exitCode', 'stdout', 'stderr']:
        equal(raw['shell'][key], expected[key])
    equal(raw['collectedStdout'], expected['stdout'])
    equal(raw['source']['actualSha256'], selected['source']['sha256'])
    equal(hashlib.sha256(raw['source']['exactText'].encode()).hexdigest(), selected['source']['sha256'])
    if selected['id'].startswith('08-'):
        equal(raw['engineOutcome'], {'kind': 'await-rejected', 'reasonType': 'object', 'reasonIsNull': False})
        assert 'engine' not in raw
        for name, count in {'actual-engine-run-start': 1, 'actual-engine-run-rejected': 1, 'actual-engine-run-threw': 0, 'actual-engine-run-settled': 0}.items():
            equal(raw['events'].count(name), count)
        order = [raw['events'].index(name) for name in ['actual-engine-run-start', 'actual-engine-run-rejected', 'operation-close-settled', 'shell-exec-settled']]
        equal(order, sorted(set(order)))
    else:
        equal(raw['engine']['ok'], expected['engine']['ok'])
        if 'returnValue' in expected['engine']:
            equal(raw['engine']['returnValue'], expected['engine']['returnValue'])
        if 'errorMessage' in expected['engine']:
            equal(raw['engine']['error']['message'], expected['engine']['errorMessage'])
    if 'shapeRows' in expected:
        value = raw['engine']['returnValue']
        equal(sorted(value), sorted([*expected['shapeRows'], *expected['otherReturnFields']]))
        for key, shape in expected['shapeRows'].items():
            equal(value[key], SURFACE['expectedShapes'][shape])
        for key, value_expected in expected['otherReturnFields'].items():
            equal(value[key], value_expected)
    vfs = copy.deepcopy(raw['vfsBefore'])
    effect = expected['vfsEffect']
    if effect != 'unchanged':
        data = effect['utf8'].encode()
        vfs.append({'path': effect['createFile'], 'type': 'file', 'bytes': len(data), 'base64': base64.b64encode(data).decode(), 'sha256': hashlib.sha256(data).hexdigest()})
        vfs.sort(key=lambda entry: entry['path'])
    equal(raw['vfsAfter'], vfs)


def lifecycle_check(raw, row):
    expected = row['expect']
    equal(raw['id'], row['id'])
    equal(raw['selected'], row)
    equal(raw['engineRuns'], 1)
    equal(raw['containment'], False)
    expected_guard = {'failures': [], 'activeTimers': 0, 'workersCreated': 0, 'subprocessesCreated': 0, 'socketsCreated': 0}
    if 'curlInputs' in row:
        equal(set(raw['guard']), set(expected_guard) | {'timerRequests'})
        equal({key: raw['guard'][key] for key in expected_guard}, expected_guard)
        assert len(raw['guard']['timerRequests']) < 512
        equal([entry for entry in raw['guard']['timerRequests'] if entry['operation'] == 'setTimeout' and entry.get('delay') == 1000], [])
    else:
        equal(raw['guard'], expected_guard)
    equal(raw['unhandled'], [])
    equal(raw['disposeSettled'], True)
    assert raw['assertions'] and all(entry['pass'] for entry in raw['assertions'])
    state = raw['atSettlement']
    outcome = raw['publicOutcome']
    events = raw['events']
    equal([entry['order'] for entry in events], list(range(1, len(events) + 1)))

    def event(name, **fields):
        found = [entry for entry in events if entry['event'] == name and all(entry.get(key) == value for key, value in fields.items())]
        equal(len(found), 1)
        return found[0]

    def ordered(*entries):
        positions = [entry['order'] for entry in entries]
        equal(positions, sorted(set(positions)))

    for key, value in {'acquisitions': 1, 'releases': 1, 'cleanupDone': True, 'bridgePending': 0, 'ordinaryDestinationWriteCalls': 0}.items():
        equal(state[key], value)
    ordered(event('cleanup-registered', label='guest-output'), event('acquire-start'))
    for entry in events:
        if entry['event'] in ['resource-release-done', 'inner-dispose-settled', 'child-release-done', 'hold-resource-released', 'transport-cleanup-done', 'response-disposed']:
            equal(entry['publicSettled'], False)
            assert entry['order'] < event('public-exec-settled')['order']
    if row['route'] == 'shell-module':
        equal(state['innerDisposed'], True)
    equal(outcome['kind'], expected['publicKind'])
    if expected['publicKind'] == 'rejection':
        assert 'result' not in outcome
        equal(state[{'callerError': 'callerIdentity', 'executionError': 'executionIdentity', 'cleanupError': 'cleanupIdentity'}[expected['identity']]], True)
    if 'exitCode' in expected:
        equal(outcome['result']['exitCode'], expected['exitCode'])
    for key in ['stdout', 'stderr']:
        if key in expected:
            equal(outcome[key + 'Hex'], expected[key].encode().hex())
    if 'stdoutHex' in expected:
        equal(outcome['stdoutHex'], expected['stdoutHex'])
    if 'accountedWriteCalls' in expected:
        equal(state['accountedWriteCalls'], expected['accountedWriteCalls'])
    guest = (INPUTS / 'lifecycle' / row['guest']).read_text()
    equal(raw['literalInvoke'], {'name': 'safejs', 'args': ['-e', guest, '--', *row['guestArgs']]})
    variant = REVISION['variants'].get(row['id'], {})
    source = variant.get('publicSource', LIFECYCLE['commonInputs']['publicShellCommand'])
    equal(raw['publicSource'], source)
    equal(raw['publicSourceHex'], source.encode().hex())
    equal(raw['publicSourceBytes'], len(source.encode()))
    if row['workflow'] == 'L02':
        event('public-stdout-accepted', hex='before-budget\n'.encode().hex())
        if row['id'].endswith('positive'):
            equal(raw['engine']['returnValue'], 4096)
        else:
            for key, value in {'code': 'budgetExceeded', 'budget': 'steps', 'current': 2049, 'limit': 2048}.items():
                equal(raw['engine']['error'][key], value)
    if row['workflow'] == 'L03':
        equal(state['holdEntries'], 1)
        equal(state['holdReleased'], True)
        equal(state['lateEntries'], expected['lateEntries'])
        if row['id'].endswith('-live'):
            equal(raw['files']['/work/late.txt'], {'hex': 'late\n'.encode().hex()})
        else:
            equal(raw['files']['/work/late.txt'], {'code': 'ENOENT'})
            equal(state['holdReleaseSignalAborted'], True)
            ordered(event('engine-return'), event('facade-signal-aborted'), event('hold-explicit-release'))
    if row['workflow'] == 'L04':
        for key, value in {'leftReleases': 1, 'rightReleases': 1, 'rightEffect': 'right\n', 'lateAcquisitionStarts': 0, 'lateChildCreations': 0, 'parentAbortedOnNormalClose': False}.items():
            equal(state[key], value)
        event('late-guest-child-refused')
        ordered(event('close-settled', label='left'), event('right-effect-after-left-close'))
    if row['workflow'] == 'L05':
        equal(state['cleanupErrorObserved'], True)
        if row['id'] == 'L05-caller-error':
            equal(state['callerAborted'], True)
            equal(state['lateWriteErrorObserved'], True)
        elif row['id'] == 'L05-cleanup-error':
            equal(event('safejs-invoke-settled')['status'], 0)
            equal(raw['engine']['ok'], True)
            equal(state['callerAborted'], False)
        else:
            equal(raw['variantId'], 'L05-S1-selected-after-command')
            equal(source, 'owned-guest\n)')
            equal(raw['selector'], {'calls': 1, 'throws': 1, 'publicResultAbsent': True, 'publicExecutionIdentity': True, 'callerAborted': False})
            equal(outcome['stderrHex'], '')
            equal(state['callerAborted'], False)
            nested = event('safejs-invoke-settled')
            equal(nested['status'], 1)
            assert not any(entry['event'] == 'safejs-invoke-rejected' for entry in events)
            entered = event('selected-syntax-diagnostic-sink-enter')
            thrown = event('selected-syntax-diagnostic-sink-throw')
            ordered(nested, event('resource-release-done', label='guest-output'), event('close-rejected', label='guest-output', cleanupIdentity=True), entered, thrown, event('public-exec-settled'))
            for key, value in {'count': 1, 'bytes': 37, 'attemptedHex': 'shell: Expected command at offset 12\n'.encode().hex(), 'selectedGuestStatus': 1, 'cleanupDone': True, 'cleanupErrorObserved': True, 'releases': 1, 'callerAborted': False}.items():
                equal(entered[key], value)
            equal(thrown['count'], 1)
            equal(thrown['executionIdentity'], True)
            equal([bytes.fromhex(entry['attemptedHex']).decode() for entry in events if entry['event'] == 'public-diagnostic-rejected'], variant['expectedDiagnosticAttempts'])
    if row['workflow'] == 'L06':
        curl = row.get('curlInputs', LIFECYCLE['curlInputs'])
        equal(curl['limits']['maxRedirects'], 0)
        equal(curl['limits']['maxRetries'], 0)
        network = raw['network']
        equal(network['authorizationJournal'], [{'call': 1, 'url': curl['authorizedUrl'], 'method': 'PUT', 'attempt': 0, 'hasRedirectFrom': False, 'signalAborted': False, 'allowed': True}])
        equal(network['transportJournal'], [{'call': 1, 'url': curl['authorizedUrl'], 'method': 'PUT', 'signalAborted': False, 'allowed': True}])
        for key, value in {'transportCalls': 1, 'transportCleanupCalls': 1, 'responseDisposeCalls': 1, 'authorizationCallsForRetry': 0, 'authorizationCallsWithRedirectFrom': 0, 'additionalTransportEntries': 0}.items():
            equal(network[key], value)
        for key, value in {'authorizeCalls': 1, 'uploadBeforeEof': True, 'uploadEof': True, 'transportCleanupRegistered': True, 'transportClosed': True, 'responseDisposed': True, 'transportAbortedByConsumer': False, 'curlStatus': expected['curlStatus'], 'curlWriteoutCalls': expected['writeoutAccountedCalls']}.items():
            equal(state[key], value)
        uploads = [entry for entry in events if entry['event'] == 'transport-upload-received']
        equal([entry['hex'] for entry in uploads], curl['uploadChunksHex'])
        response = event('transport-response-created')
        nested = event('curl-invoke-settled')
        ordered(event('authorization-entry'), event('transport-entry'), event('transport-cleanup-registered'), uploads[0], uploads[1], response)
        for name in ['response-disposed', 'transport-cleanup-done']:
            ordered(response, event(name), nested, event('public-exec-settled'))
        equal(nested['transportClosed'], True)
        equal(nested['responseDisposed'], True)
        equal(nested['status'], expected['curlStatus'])
        for key, value in {'status': curl.get('responseStatus', 200), 'statusText': curl.get('responseStatusText', 'OK'), 'httpVersion': '1.1', 'headers': curl['responseHeaders'], 'signalAborted': False}.items():
            equal(response[key], value)
        equal(any(name.lower() == 'location' for name, value in response['headers']), curl.get('responseStatus') == 307)
        equal(event('authorization-decision')['allowed'], True)
        equal(event('transport-decision')['allowed'], True)
        closed = [entry for entry in events if entry['event'] == 'curl-consumer-closed']
        equal(len(closed), 1 if row['closeCurlConsumer'] else 0)
        if closed:
            equal(closed[0]['reasonIdentity'], True)
            ordered(uploads[0], closed[0], uploads[1])
        for filename, content in curl['requiredFiles'].items():
            equal(raw['files'][filename], {'hex': content.encode().hex()})


    if 'curlInputs' in row:
        policy = raw['zeroPolicy']
        for key in ['responseBodyStarts', 'responseBodyChunks', 'uploadSourceStarts']:
            equal(policy[key], expected[key])
        equal([entry for entry in policy['timerRequests'] if entry['operation'] == 'setTimeout' and entry.get('delay') == 1000], [])
