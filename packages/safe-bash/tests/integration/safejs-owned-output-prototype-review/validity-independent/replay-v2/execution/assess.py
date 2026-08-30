import base64
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
BINDINGS = json.loads((HERE / 'BINDINGS.json').read_text())
INPUTS = Path(BINDINGS['regularInputRoot'])
SURFACE = json.loads((INPUTS / 'surface/execution-v2/CASES.json').read_text())
LIFECYCLE = json.loads((INPUTS / 'lifecycle/execution-v2/CASES.json').read_text())
REVISION = json.loads((INPUTS / 'lifecycle/execution-v2/REVISION.json').read_text())


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
    equal(raw['guard'], {'failures': [], 'activeTimers': 0, 'workersCreated': 0, 'subprocessesCreated': 0, 'socketsCreated': 0})
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
        curl = LIFECYCLE['curlInputs']
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
        for key, value in {'status': 200, 'statusText': 'OK', 'httpVersion': '1.1', 'headers': curl['responseHeaders'], 'signalAborted': False}.items():
            equal(response[key], value)
        assert all(name.lower() != 'location' for name, value in response['headers'])
        equal(event('authorization-decision')['allowed'], True)
        equal(event('transport-decision')['allowed'], True)
        closed = [entry for entry in events if entry['event'] == 'curl-consumer-closed']
        equal(len(closed), 1 if row['closeCurlConsumer'] else 0)
        if closed:
            equal(closed[0]['reasonIdentity'], True)
            ordered(uploads[0], closed[0], uploads[1])
        for filename, content in curl['requiredFiles'].items():
            equal(raw['files'][filename], {'hex': content.encode().hex()})


def negatives():
    repository = '/Users/kjopek/Workspace/safe-bash'
    prefix = 'tests/integration/safejs-owned-output-prototype-review/'

    def old(commit, filename):
        return json.loads(subprocess.check_output(['/usr/bin/git', '-C', repository, 'show', f'{commit}:{prefix}{filename}'], env={'PATH': '/usr/bin:/bin', 'GIT_OPTIONAL_LOCKS': '0'}))

    surface = old('ac549fc392f0853a369e1cef08c6ab08f7b12a95', 'surface/execution-v2/attempt-01/raw/08-function-spread-profile/actual.json')
    selected = next(row for row in SURFACE['cases'] if row['id'] == surface['id'])
    precedence = old('365ec125589cb41e7e9ea8134314627583ee21dd', 'lifecycle/execution-v2/evidence/attempt-01/L05-execution-error.json')
    curl = old('365ec125589cb41e7e9ea8134314627583ee21dd', 'lifecycle/execution-v2/evidence/attempt-01/L06-curl-open.json')
    mutations = []
    missing = copy.deepcopy(surface)
    missing['events'].remove('actual-engine-run-rejected')
    mutations.append(('missing-surface-terminal', surface_check, missing, selected))
    fabricated = copy.deepcopy(surface)
    fabricated['engine'] = {'ok': False}
    mutations.append(('fabricated-surface-result', surface_check, fabricated, selected))
    fulfilled = copy.deepcopy(precedence)
    fulfilled['publicOutcome'].update(kind='result', result={'exitCode': 1})
    mutations.append(('nonzero-fulfilled-is-not-rejection', lifecycle_check, fulfilled, next(row for row in LIFECYCLE['rows'] if row['id'] == fulfilled['id'])))
    extra = copy.deepcopy(curl)
    extra['network']['authorizationJournal'].append(copy.deepcopy(extra['network']['authorizationJournal'][0]))
    mutations.append(('extra-authorization-is-nonpass', lifecycle_check, extra, next(row for row in LIFECYCLE['rows'] if row['id'] == extra['id'])))
    refused = []
    for name, function, mutated, selected in mutations:
        try:
            function(mutated, selected)
        except (AssertionError, KeyError, ValueError) as failure:
            refused.append({'id': name, 'refused': True, 'reason': str(failure)[:500]})
        else:
            raise AssertionError(name)
    print(json.dumps({'dataOnly': True, 'guestExecutions': 0, 'newEnginePasses': 0, 'negativeChecks': refused}, indent=2))


if __name__ == '__main__':
    if sys.argv[1:] == ['negatives']:
        negatives()
