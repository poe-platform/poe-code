from pathlib import Path
from shared import load, now, OWNER


def optional(path):
    return load(path) if Path(path).is_file() else None


def imports(path, allowed, required):
    import json
    entries = [json.loads(line) for line in Path(path).read_text().splitlines() if line] if Path(path).is_file() else []
    failures = [entry for entry in entries if allowed.get(entry.get('path')) != entry.get('sha256')]
    paths = {entry.get('path') for entry in entries}
    failures.extend({'missing': name} for name in required if name not in paths)
    return {'entries': len(entries), 'engineFiles': sum(entry.get('path', '').startswith('engine/src/') for entry in entries), 'productFiles': sum(entry.get('path', '').startswith('consumer/node_modules/virtual-bash/dist/') for entry in entries), 'failures': failures}


def assess(cohort, raw_root, execution):
    preparation = load(OWNER / 'PREPARATION.json')
    frozen = Path(preparation['frozenRoot'])
    cases = load(frozen / cohort / 'CASES.json')
    required = ['consumer/node_modules/virtual-bash/dist/index.js', 'engine/src/run.ts', 'engine/src/interp/budget.ts', 'engine/src/modules/fs.ts', 'engine/src/interp/host-bridge.ts']
    rows = []
    if cohort == 'surface':
        journal = optional(raw_root / 'journal.json') or {}
        allowed = optional(raw_root / 'import-allowlist.json') or {}
        expected_rows = [row for row in cases['cases'] if not row.get('conditional')]
        gates_clean = execution.get('privateUnchanged') is True and execution.get('sharedUnchanged') is True and execution.get('inputsUnchanged') is True and not execution.get('containment') and all(journal.get(key) is True for key in ['privateUnchanged', 'inputTreesUnchanged', 'sharedTreesUnchanged']) and not journal.get('failures')
        for row in expected_rows:
            identifier = row['id']
            actual = optional(raw_root / identifier / 'actual.json')
            assessment = optional(raw_root / identifier / 'assessment.json') or {}
            child = optional(raw_root / identifier / 'child.json') or {}
            checks = []
            def check(name, result):
                checks.append({'name': name, 'pass': bool(result)})
            if actual is None:
                rows.append({'id': identifier, 'classification': 'BLOCKED', 'launched': bool(child), 'engineRuns': 0, 'rawOutcome': assessment.get('outcome'), 'checks': checks})
                continue
            audited = imports(raw_root / identifier / 'imports.ndjson', allowed, required)
            check('frozen scorer passed all checks', assessment.get('outcome') == 'PASS' and bool(assessment.get('checks')) and all(entry.get('pass') for entry in assessment.get('checks', [])))
            check('one real engine entry', actual.get('runtimeCalls') == 1)
            check('child closed without containment', child.get('code') == 0 and child.get('signal') is None and not child.get('timedOut') and not child.get('outputExceeded') and bool(child.get('closed')))
            check('exact public status/stdout/stderr', all(actual.get('shell', {}).get(key) == row['expected'].get(key) for key in ['rejected', 'exitCode', 'stdout', 'stderr']))
            check('exact imports authenticated', not audited['failures'])
            if identifier.startswith('08-'):
                events = actual.get('events', [])
                check('awaited rejection not fulfillment', actual.get('engineOutcome', {}).get('kind') == 'await-rejected' and 'engine' not in actual and events.count('actual-engine-run-rejected') == 1 and 'actual-engine-run-settled' not in events)
                check('rejection before cleanup and settlement', all(name in events for name in ['actual-engine-run-rejected', 'operation-close-settled', 'shell-exec-settled']) and events.index('actual-engine-run-rejected') < events.index('operation-close-settled') < events.index('shell-exec-settled'))
            classification = 'PASS' if all(entry['pass'] for entry in checks) else 'FAIL'
            if classification == 'PASS' and not gates_clean:
                classification = 'UNPROVED_GUARD'
            rows.append({'id': identifier, 'classification': classification, 'rawOutcome': assessment.get('outcome'), 'launched': True, 'engineRuns': actual.get('runtimeCalls', 0), 'scope': 'DIALECT_ONLY' if identifier.startswith('07-') else 'AWAITED_REJECTION_PROFILE' if identifier.startswith('08-') else 'SUPPORTED_SURFACE', 'checks': checks, 'imports': audited, 'public': actual.get('shell'), 'engineOutcome': actual.get('engineOutcome'), 'events': actual.get('events'), 'hostCounters': actual.get('hostCounters')})
        blocker = journal.get('status') == 'INFRASTRUCTURE_FAILURE' or not gates_clean
    else:
        journal = optional(raw_root / 'report.json') or {}
        immutable = optional(raw_root / 'immutable-before.json') or {}
        allowed = {prefix + '/' + entry['path']: entry['sha256'] for prefix, entries in immutable.items() for entry in entries}
        gates_clean = execution.get('privateUnchanged') is True and execution.get('sharedUnchanged') is True and execution.get('inputsUnchanged') is True and not execution.get('containment') and journal.get('privateUnchanged') is True and journal.get('sharedUnchanged') is True and journal.get('cleanup', {}).get('knownCaseChildrenClosed') is True and journal.get('cleanup', {}).get('removed') is True and not journal.get('afterGuardFailure')
        for row in cases['rows']:
            identifier = row['id']
            actual = optional(raw_root / (identifier + '.json'))
            raw_row = next((entry for entry in journal.get('rows', []) if entry['id'] == identifier), {})
            checks = []
            def check(name, result):
                checks.append({'name': name, 'pass': bool(result)})
            if actual is None:
                rows.append({'id': identifier, 'classification': 'BLOCKED', 'launched': any(entry.get('id') == identifier for entry in journal.get('children', [])), 'engineRuns': 0, 'rawClassification': raw_row.get('classification'), 'reason': raw_row.get('reason'), 'checks': checks})
                continue
            audited = imports(raw_root / (identifier + '.imports.ndjson'), allowed, required)
            state = actual.get('atSettlement', {})
            public = actual.get('publicOutcome', {})
            check('all unchanged child assertions passed', actual.get('classification') == 'PASS' and bool(actual.get('assertions')) and all(entry.get('pass') for entry in actual.get('assertions', [])))
            check('one real engine entry', actual.get('engineRuns') == 1)
            check('exact imports authenticated', not audited['failures'])
            check('public classification and exact bytes', public.get('kind') == row['expect']['publicKind'] and all(public.get(key + 'Hex') == row['expect'][key].encode().hex() for key in ['stdout', 'stderr'] if key in row['expect']))
            if 'exitCode' in row['expect']:
                check('exact public exitCode', (public.get('result') or {}).get('exitCode') == row['expect']['exitCode'])
            check('cooperative cleanup before settlement', state.get('cleanupDone') is True and state.get('bridgePending') == 0 and state.get('releases') == 1)
            check('no runtime containment/unhandled/timer leak', not actual.get('containment') and not actual.get('unhandled') and actual.get('guard', {}).get('activeTimers') == 0 and not actual.get('guard', {}).get('failures') and actual.get('disposeSettled') is True)
            critical = {}
            if identifier == 'L05-execution-error':
                selector = actual.get('selector', {})
                check('NEW source-selected execution rejection', actual.get('publicSource') == 'owned-guest\n)' and actual.get('publicSourceBytes') == 13 and selector.get('calls') == selector.get('throws') == 1 and selector.get('publicResultAbsent') is True and selector.get('publicExecutionIdentity') is True and public.get('kind') == 'rejection' and state.get('executionIdentity') is True)
                critical = {'selector': selector, 'source': actual.get('publicSource'), 'events': actual.get('events')}
            if row['workflow'] == 'L06':
                curl = row.get('curlInputs', cases['curlInputs'])
                network = actual.get('network', {})
                events = actual.get('events', [])
                positions = {name: [entry for entry in events if entry.get('event') == name] for name in ['authorization-entry', 'transport-entry', 'transport-cleanup-registered', 'transport-upload-received', 'transport-response-created', 'response-disposed', 'transport-cleanup-done', 'curl-invoke-settled', 'public-exec-settled']}
                auth = network.get('authorizationJournal', [])
                transport = network.get('transportJournal', [])
                check('exactly one auth and transport, no replay', len(auth) == len(transport) == 1 and network.get('transportCalls') == 1 and network.get('authorizationCallsForRetry') == network.get('authorizationCallsWithRedirectFrom') == network.get('additionalTransportEntries') == 0)
                check('authorized initial PUT only', len(auth) == 1 and auth[0].get('attempt') == 0 and auth[0].get('method') == 'PUT' and auth[0].get('url') == curl['authorizedUrl'] and auth[0].get('hasRedirectFrom') is False and auth[0].get('allowed') is True and auth[0].get('signalAborted') is False and auth[0].get('redirectFrom') is None)
                check('upload before EOF, retained reused bytes', state.get('uploadBeforeEof') is True and state.get('uploadEof') is True and [entry.get('hex') for entry in positions['transport-upload-received']] == curl['uploadChunksHex'])
                check('stdout closure cannot cancel required transfer', state.get('transportAbortedByConsumer') is False and state.get('curlStatus') == row['expect']['curlStatus'] and state.get('curlWriteoutCalls') == row['expect']['writeoutAccountedCalls'])
                check('exact body/header bytes', all(actual.get('files', {}).get(filename, {}).get('hex') == text.encode().hex() for filename, text in curl['requiredFiles'].items()))
                check('exactly one response and transport cleanup', network.get('transportCleanupCalls') == network.get('responseDisposeCalls') == 1)
                complete = all(len(entries) == (2 if name == 'transport-upload-received' else 1) for name, entries in positions.items())
                ordered = False
                if complete:
                    order = lambda name: positions[name][0]['order']
                    ordered = order('authorization-entry') < order('transport-entry') < order('transport-cleanup-registered') < order('transport-upload-received') < positions['transport-upload-received'][1]['order'] < order('transport-response-created') < order('response-disposed') < order('curl-invoke-settled') < order('public-exec-settled') and order('transport-response-created') < order('transport-cleanup-done') < order('curl-invoke-settled')
                check('journal before acquisition and cleanup before nested/public settlement', complete and ordered)
                if cohort == 'controls':
                    policy = actual.get('zeroPolicy', {})
                    check('exact finite zero-policy consumption counters', all(policy.get(key) == row['expect'][key] for key in ['responseBodyStarts', 'responseBodyChunks', 'uploadSourceStarts']) and sum(entry.get('operation') == 'setTimeout' and entry.get('delay') == 1000 for entry in policy.get('timerRequests', [])) == 0)
                critical = {'network': network, 'positions': positions, 'atSettlement': state, 'zeroPolicy': actual.get('zeroPolicy'), 'files': actual.get('files')}
            classification = 'PASS' if all(entry['pass'] for entry in checks) else 'FAIL'
            if actual.get('engineRuns') == 0 and (actual.get('fatal') or {}).get('name') == 'RangeError' and 'Invalid network limit:' in (actual.get('fatal') or {}).get('message', ''):
                classification = 'FAIL_VALID_PROBE_CONSTRUCTOR'
            elif actual.get('classification') == 'INVALID_FIXTURE':
                classification = 'INVALID_FIXTURE'
            elif actual.get('classification') == 'UNPROVED':
                classification = 'UNPROVED'
            if classification == 'PASS' and not gates_clean:
                classification = 'UNPROVED_GUARD'
            rows.append({'id': identifier, 'classification': classification, 'rawClassification': actual.get('classification'), 'launched': True, 'engineRuns': actual.get('engineRuns', 0), 'checks': checks, 'imports': audited, 'public': public, 'critical': critical, 'fatal': actual.get('fatal')})
        blocker = journal.get('status') == 'BLOCKED_INPUT_OR_HARNESS' or not gates_clean
    counts = {'total': len(rows), 'launched': sum(row['launched'] for row in rows), 'engineRuns': sum(row['engineRuns'] for row in rows), 'pass': sum(row['classification'] == 'PASS' for row in rows), 'failed': sum(row['classification'].startswith('FAIL') for row in rows), 'blocked': sum(row['classification'] == 'BLOCKED' for row in rows), 'invalid': sum(row['classification'] == 'INVALID_FIXTURE' for row in rows), 'unproved': sum(row['classification'].startswith('UNPROVED') for row in rows)}
    return {'at': now(), 'cohort': cohort, 'role': 'AUTHOR_ONLY_NOT_INDEPENDENT_ACCEPTANCE', 'status': 'PASS' if counts['pass'] == counts['total'] and gates_clean else 'BOUNDED_NONPASS', 'inputOrFixtureBindingBlocker': blocker, 'gatesClean': gates_clean, 'counts': counts, 'rows': rows, 'driverStatus': journal.get('status'), 'noPromotion': True}
