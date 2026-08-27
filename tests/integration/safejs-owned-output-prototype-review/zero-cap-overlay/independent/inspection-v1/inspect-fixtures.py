import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess


REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
SCRATCH = Path('/private/tmp/safe-bash-zero-overlay-independent-inspect-5q9y5wec')
AUTHOR = SCRATCH / 'author-inputs'
OUTPUT = Path(__file__).resolve().parent
BASE = 'tests/integration/safejs-owned-output-prototype-review'
FREEZE = 'a61e63bc46e8389e59c0d8fdc1d424003f62c769'
SURFACE = '09ba85cef42898fbc2185d03acc4191f9a4689cd'
LIFECYCLE = '3f6db4dd29950d92410a4d4f9871ba18a5b56e89'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git_bytes(commit, filename):
    return subprocess.check_output(
        ['/usr/bin/git', '-c', 'core.fsmonitor=false', 'show', f'{commit}:{filename}'],
        cwd=REPOSITORY, env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, timeout=20,
    )


def load(filename):
    return json.loads((AUTHOR / filename).read_bytes())


def anchor(filename, text):
    lines = (AUTHOR / filename).read_text().splitlines()
    matches = [index + 1 for index, line in enumerate(lines) if text in line]
    assert matches, (filename, text)
    return {'path': filename, 'lines': matches, 'contains': text}


def main():
    assert Path.cwd() == REPOSITORY
    authenticated = []
    for filename in sorted(AUTHOR.rglob('*')):
        assert not filename.is_symlink()
        if filename.is_file():
            relative = filename.relative_to(AUTHOR).as_posix()
            data = filename.read_bytes()
            assert data == git_bytes(FREEZE, f'{BASE}/zero-cap-overlay/author/{relative}')
            authenticated.append({'path': relative, 'bytes': len(data), 'sha256': sha(data)})
    assert len(authenticated) == 88
    exact_base = []
    for cohort, commit, filenames in [
        ('surface', SURFACE, ['child.mjs', 'CASES.json', 'PINS.json', 'RELEASE.json', 'controls.mjs']),
        ('lifecycle', LIFECYCLE, ['child.mjs', 'common.mjs', 'guard.mjs']),
    ]:
        for filename in filenames:
            actual = (AUTHOR / cohort / filename).read_bytes()
            assert actual == git_bytes(commit, f'{BASE}/{cohort}/execution-v2/{filename}')
            exact_base.append(f'{cohort}/{filename}')
    surface = load('surface/CASES.json')
    assert surface['counts']['unconditional'] == 8
    assert len(surface['cases']) == 9
    guests = []
    for row in surface['cases']:
        source = row['source']
        actual = (AUTHOR / 'surface' / source['path']).read_bytes()
        assert len(actual) == source['bytes'] and sha(actual) == source['sha256']
        assert actual == git_bytes(SURFACE, f"{BASE}/surface/{source['path']}")
        guests.append({'cohort': 'surface', 'id': row['id'], **source})
    lifecycle = load('lifecycle/CASES.json')
    old_cases_bytes = git_bytes(LIFECYCLE, f'{BASE}/lifecycle/execution-v2/CASES.json')
    old_cases = json.loads(old_cases_bytes)
    expected = copy.deepcopy(old_cases)
    assert expected['curlInputs']['limits']['maxRedirects'] == 1
    assert expected['curlInputs']['limits']['maxRetries'] == 1
    expected['curlInputs']['limits']['maxRedirects'] = 0
    expected['curlInputs']['limits']['maxRetries'] = 0
    assert lifecycle == expected
    assert (AUTHOR / 'lifecycle/CASES.json').read_bytes() == old_cases_bytes.replace(
        b'"maxRedirects": 1, "maxRetries": 1', b'"maxRedirects": 0, "maxRetries": 0')
    assert len(lifecycle['rows']) == 11 and lifecycle['rows'] == old_cases['rows']
    revision = load('lifecycle/REVISION.json')
    old_revision = json.loads(git_bytes(LIFECYCLE, f'{BASE}/lifecycle/execution-v2/REVISION.json'))
    selector = revision['variants']['L05-execution-error']
    assert selector == old_revision['variants']['L05-execution-error']
    assert selector['publicSource'] == 'owned-guest\n)' and len(selector['publicSource'].encode()) == 13
    assert selector['selectorDiagnostic'] == 'shell: Expected command at offset 12\n'
    assert len(selector['selectorDiagnostic'].encode()) == selector['selectorDiagnosticBytes'] == 37
    for filename in sorted((AUTHOR / 'lifecycle/guests').iterdir()):
        actual = filename.read_bytes()
        assert actual == git_bytes(LIFECYCLE, f'{BASE}/lifecycle/guests/{filename.name}')
        if filename.name == 'curl.ajs.data':
            assert actual == (AUTHOR / 'controls/guests' / filename.name).read_bytes()
        guests.append({'cohort': 'lifecycle-and-controls' if filename.name == 'curl.ajs.data' else 'lifecycle', 'path': f'guests/{filename.name}',
                       'bytes': len(actual), 'sha256': sha(actual)})
    controls = load('controls/CASES.json')
    assert controls['executionRows'] == 6
    expected_order = [f'Z{family:02d}-{state}' for family in range(1, 4) for state in ['open', 'closed']]
    assert controls['executionOrder'] == [row['id'] for row in controls['rows']] == expected_order
    for key in ['defaultSafeJsLimits', 'containment', 'commonInputs', 'errors']:
        assert controls[key] == lifecycle[key] == old_cases[key]
    assert (AUTHOR / 'controls/common.mjs').read_bytes() == (AUTHOR / 'lifecycle/common.mjs').read_bytes()
    initial = {'/work/body.bin': 'zero-body-sentinel\n', '/work/headers.txt': 'zero-header-sentinel\n'}
    writeout = '%{http_code}|%{num_redirects}|%{num_retries}|%{size_upload}|%{size_download}|%{exitcode}\n'
    common_args = ['-sS', '-T', '-', '-o', '/work/body.bin', '-D', '/work/headers.txt', '-w',
                   writeout, '-L', '--max-redirs', '9', '--retry', '9', '--retry-delay', '0']
    profiles = []
    for row in controls['rows']:
        family = row['id'][:3]
        closed = row['id'].endswith('-closed')
        status, status_text, curl_failure, extra_headers, diagnostic = {
            'Z01': (200, 'OK', 0, [], ''),
            'Z02': (503, 'Service Unavailable', 22, [['Retry-After', '1']], 'curl: (22) HTTP response status 503\n'),
            'Z03': (307, 'Temporary Redirect', 47, [['Location', '/next']], 'curl: (47) Maximum redirects exceeded\n'),
        }[family]
        inputs = row['curlInputs']
        expected_inputs = copy.deepcopy(lifecycle['curlInputs'])
        expected_inputs['args'] = common_args + (['--fail'] if family == 'Z02' else []) + ['https://owned.invalid/upload']
        expected_inputs['responseStatus'] = status
        expected_inputs['responseStatusText'] = status_text
        expected_inputs['responseHttpVersion'] = '1.1'
        expected_inputs['responseHeaders'] = [['Content-Type', 'application/octet-stream'], ['Content-Length', '12']] + extra_headers
        headers = f'HTTP/1.1 {status} {status_text}\r\n' + ''.join(f'{name}: {value}\r\n' for name, value in expected_inputs['responseHeaders']) + '\r\n'
        expected_inputs['requiredFiles'] = {'/work/body.bin': initial['/work/body.bin'] if curl_failure else 'body0\nbody1\n', '/work/headers.txt': headers}
        assert inputs == expected_inputs, row['id']
        public_status = curl_failure or (141 if closed else 0)
        downloaded = 0 if curl_failure else 12
        expected_stdout = ('' if closed else f'{status}|0|0|6|{downloaded}|{curl_failure}\n') + f'curl:{public_status}\n'
        expected_result = {'publicKind': 'result', 'exitCode': public_status, 'stdout': expected_stdout,
                           'stderr': diagnostic + 'independent-stderr\n', 'curlStatus': public_status,
                           'writeoutAccountedCalls': 0 if closed else 1, 'transportSignalAbortedByConsumer': False,
                           'responseBodyStarts': 0 if curl_failure else 1, 'responseBodyChunks': 0 if curl_failure else 2,
                           'uploadSourceStarts': 1, 'retryDelay1000msRequests': 0}
        assert row['expect'] == expected_result, row['id']
        assert row['initialFiles'] == initial
        assert row['guest'] == 'guests/curl.ajs.data' and row['guestArgs'] == []
        assert row['route'] == 'shell-module' and row['workflow'] == 'L06'
        assert row['closeCurlConsumer'] is closed
        if closed:
            assert row['requiresPositive'] == 'Z01-open' and row['requiresMatchedOpen'] == f'{family}-open'
        else:
            assert 'requiresPositive' not in row and 'requiresMatchedOpen' not in row
        profiles.append({'id': row['id'], 'expect': expected_result, 'requiredFiles': expected_inputs['requiredFiles'],
                         'exactArgs': inputs['args'], 'hostCaps': {'maxRedirects': 0, 'maxRetries': 0}})
    anchors = [anchor(filename, text) for filename, text in [
        ('surface/child.mjs', 'throw reason;'),
        ('surface/child.mjs', 'callReturned ? "await-rejected" : "call-threw"'),
        ('surface/run.mjs', 'const actual = await childCase('),
        ('surface/run.mjs', 'journal.conditionalBlocked ='),
        ('lifecycle/child.mjs', 'assert.equal(publicError, executionError);'),
        ('lifecycle/child.mjs', 'entered.selectedGuestStatus, 1'),
        ('controls/child.mjs', 'authorizationJournal.push(entry);'),
        ('controls/child.mjs', 'transportJournal.push(entry);'),
        ('controls/child.mjs', 'request.registerCleanup(closeTransport);'),
        ('controls/child.mjs', 'uploadBytes.push(Buffer.from(chunk));'),
        ('controls/child.mjs', 'disposed.order < nested.order && closed.order < nested.order'),
        ('controls/child.mjs', 'entry.delay === 1000'),
        ('controls/run.mjs', 'row.requiresMatchedOpen'),
        ('controls/run.mjs', 'row.requiresPositive'),
        ('controls/run.mjs', 'if (result.classification !== "PASS") blocked ='),
        ('lifecycle/run.mjs', 'if (result.classification !== "PASS") blocked ='),
        ('admission.mjs', 'review.verdict'),
    ]]
    surface_driver = (AUTHOR / 'surface/run.mjs').read_text()
    assert 'if (result.classification !== "PASS")' not in surface_driver
    assert 'process.exitCode' not in surface_driver
    report = {'kind': 'STATIC_DATA_AND_BYTE_AUTHENTICATION_NOT_RUNTIME', 'authorFreezeCommit': FREEZE,
              'authorFiles': authenticated, 'unchangedApprovedBaseFiles': exact_base, 'guestBindings': guests,
              'baseSurfaceScheduled': 8, 'dormantSurfaceGuestNotScheduled': 1, 'baseLifecycleScheduled': 11,
              'additionalControls': profiles, 'totalScheduled': 25, 'executedGuests': 0, 'newRuntimePasses': 0,
              'sourceDerivedExpectationsMatch': True, 'L05ApprovedSelectorUnchanged': True,
              'baseLifecycleCaseBytesOnlyTwoCapReplacements': True,
              'controlBudgetsAndSignalsPreserved': True, 'manualReviewAnchors': anchors,
              'orchestrationFinding': {'id': 'I01', 'surfaceFirstNonpassHalt': False,
                                       'lifecycleFirstNonpassHalt': True, 'controlsFirstNonpassHalt': True,
                                       'surfaceProcessExitIsNotVerdict': True,
                                       'qualification': 'Text anchors corroborate manual review, not execution or a formal control-flow proof.'},
              'noPromotion': True}
    target = OUTPUT / 'FIXTURE-CHECKS.json'
    assert not target.exists()
    text = json.dumps(report, indent=2) + '\n'
    patch = f'*** Begin Patch\n*** Add File: {target.relative_to(REPOSITORY)}\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), cwd=REPOSITORY, check=True)
    print(json.dumps({'status': 'STATIC_FIXTURE_DATA_MATCH', 'profiles': 25, 'runtimeExecutions': 0, 'finding': 'I01'}))


if __name__ == '__main__':
    main()
