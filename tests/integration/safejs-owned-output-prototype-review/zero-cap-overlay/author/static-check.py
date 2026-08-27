import ast
import base64
import difflib
import json
from pathlib import Path
import subprocess
from prepare import ACCEPTED, AUDIT, NETWORK, NODE, OWNED, PARENT, REPOSITORY, blob, encoded, git, inventory, regular, sha


def load(path):
    return json.loads(regular(OWNED / path))


def main():
    candidate = load('CANDIDATE.json')
    before = load('inventories/parent-all940.json')
    after = load('inventories/candidate-all940.json')
    assert inventory(Path(candidate['candidateRoot'])) == after
    assert inventory(Path(candidate['packageRoot'])) == load('inventories/candidate-package709.json')
    assert len(before) == len(after) == 940
    assert [entry['path'] for entry in before] == [entry['path'] for entry in after]
    changed = [first['path'] for first, second in zip(before, after) if first != second]
    assert changed == ['dist/commands/network/shared.d.ts.map', 'dist/commands/network/shared.js', 'dist/commands/network/shared.js.map', NETWORK]
    assert sha(encoded(load('inventories/parent-source213.json'))) == PARENT
    for path, field in [('candidate-source213', 'sourceManifestSha256'), ('candidate-compiled708', 'compiledManifestSha256'), ('candidate-package709', 'packageManifestSha256'), ('candidate-all940', 'candidateManifestSha256')]:
        assert sha(encoded(load('inventories/' + path + '.json'))) == candidate[field]
    for entry in candidate['changes']:
        decoded = base64.b64decode(regular(OWNED / 'candidate-bytes' / (entry['path'] + '.base64-data')).strip(), validate=True)
        assert len(decoded) == entry['after']['bytes'] and sha(decoded) == entry['after']['sha256']
        assert decoded == regular(Path(candidate['candidateRoot']) / entry['path'])
    original = regular(OWNED / 'overlay/shared.before.ts.data')
    derived = regular(OWNED / 'overlay/shared.after.ts.data')
    assert original == blob(ACCEPTED + '^', NETWORK)
    assert derived == blob(ACCEPTED, NETWORK)
    expected_patch = ''.join(difflib.unified_diff(original.decode().splitlines(True), derived.decode().splitlines(True), 'a/' + NETWORK, 'b/' + NETWORK))
    assert regular(OWNED / 'overlay/zero-validation.patch-data').decode() == expected_patch
    controls = load('controls/CASES.json')
    base = load('lifecycle/CASES.json')
    original_cases = json.loads(blob('3f6db4dd29950d92410a4d4f9871ba18a5b56e89', AUDIT + '/lifecycle/execution-v2/CASES.json'))
    revised_cases = json.loads(json.dumps(original_cases))
    revised_cases['curlInputs']['limits'].update(maxRedirects=0, maxRetries=0)
    assert revised_cases == base
    assert base['rows'] == original_cases['rows'] and len(base['rows']) == 11
    original_child = blob('3f6db4dd29950d92410a4d4f9871ba18a5b56e89', AUDIT + '/lifecycle/execution-v2/child.mjs')
    assert regular(OWNED / 'lifecycle/child.mjs') == original_child
    for filename in ['common.mjs', 'guard.mjs']:
        assert regular(OWNED / 'lifecycle' / filename) == blob('3f6db4dd29950d92410a4d4f9871ba18a5b56e89', AUDIT + '/lifecycle/execution-v2/' + filename)
    for filename in ['child.mjs', 'CASES.json', 'controls.mjs']:
        assert regular(OWNED / 'surface' / filename) == blob('09ba85cef42898fbc2185d03acc4191f9a4689cd', AUDIT + '/surface/execution-v2/' + filename)
    selector = load('lifecycle/REVISION.json')['variants']['L05-execution-error']
    assert selector == json.loads(blob('3f6db4dd29950d92410a4d4f9871ba18a5b56e89', AUDIT + '/lifecycle/execution-v2/REVISION.json'))['variants']['L05-execution-error']
    assert selector['publicSource'] == 'owned-guest\n)' and len(selector['publicSource'].encode()) == 13
    assert len(controls['rows']) == controls['executionRows'] == 6
    assert controls['executionOrder'] == [row['id'] for row in controls['rows']]
    assert [row['expect']['curlStatus'] for row in controls['rows']] == [0, 141, 22, 22, 47, 47]
    for key in ['defaultSafeJsLimits', 'containment', 'commonInputs', 'errors', 'curlInputs']:
        assert controls[key] == base[key]
    for row in controls['rows']:
        curl = row['curlInputs']
        assert curl['limits'] == base['curlInputs']['limits']
        assert curl['args'][curl['args'].index('--retry') + 1] == '9'
        assert curl['args'][curl['args'].index('--max-redirs') + 1] == '9'
        assert curl['args'][curl['args'].index('--retry-delay') + 1] == '0'
        assert '-L' in curl['args'] and curl['method'] == 'PUT'
        assert curl['uploadChunksHex'] == base['curlInputs']['uploadChunksHex']
        assert curl['responseChunksHex'] == base['curlInputs']['responseChunksHex']
        assert row['expect']['uploadSourceStarts'] == 1
        assert row['expect']['retryDelay1000msRequests'] == 0
        if row['closeCurlConsumer']:
            assert row['requiresPositive'] == 'Z01-open'
            assert row['requiresMatchedOpen'] == row['id'].replace('closed', 'open')
        if curl['responseStatus'] == 503:
            assert ['Retry-After', '1'] in curl['responseHeaders'] and '--fail' in curl['args']
        if curl['responseStatus'] == 307:
            assert ['Location', '/next'] in curl['responseHeaders']
        if curl['responseStatus'] != 200:
            assert curl['requiredFiles']['/work/body.bin'] == row['initialFiles']['/work/body.bin']
            assert row['expect']['responseBodyStarts'] == row['expect']['responseBodyChunks'] == 0
    control_child = regular(OWNED / 'controls/child.mjs').decode()
    for section in ['uploadBytes.push(Buffer.from(chunk))', 'await uploadGate.promise', 'if (!allowed) throw new Error("Fixture transport denied unexpected admission")', 'request.registerCleanup(closeTransport)', 'assert.equal(transportCalls, 1)', 'assert.equal(responseDisposeCalls, 1)', 'nested.order < settled.order']:
        assert section in control_child
    references = load('REFERENCES.json')
    for reference in references:
        frozen = blob(reference['commit'], reference['path'])
        assert sha(frozen) == reference['sha256']
        assert regular(REPOSITORY / reference['path']) == frozen
    syntax = []
    assert sha(regular(NODE)) == candidate['node']['sha256']
    for path in sorted(OWNED.rglob('*.mjs')):
        result = subprocess.run([str(NODE), '--check', str(path)], capture_output=True, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=20)
        assert result.returncode == 0, result.stderr.decode()
        syntax.append({'path': path.relative_to(OWNED).as_posix(), 'sha256': sha(regular(path)), 'parseExitCode': 0})
    for path in sorted(OWNED.glob('*.py')):
        ast.parse(regular(path), filename=str(path))
    for entry in load('FIXTURE-DERIVATION.json')['files']:
        assert sha(regular(OWNED / entry['path'])) == entry['newSha256']
    return {'kind': 'AUTHOR_STATIC_ONLY_NOT_RUNTIME_ACCEPTANCE', 'candidateManifestSha256': candidate['candidateManifestSha256'], 'changedEntries': changed, 'unchangedParentEntries': 936, 'sourceFiles': 213, 'compiledFiles': 708, 'compilerInputs': len(load('inventories/compiler-inputs358.json')), 'referencesAuthenticated': len(references), 'baseSurfaceProfiles': 8, 'baseLifecycleProfiles': 11, 'additionalControls': 6, 'parserChecks': syntax, 'guestExecutions': 0, 'productImports': 0, 'privateEngineImports': 0, 'transportCalls': 0, 'privateQueries': 0, 'noPromotion': True}


if __name__ == '__main__':
    print(json.dumps(main(), indent=2))
