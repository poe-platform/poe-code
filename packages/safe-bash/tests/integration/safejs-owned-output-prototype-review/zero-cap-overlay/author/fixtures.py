import copy
import difflib
import json
from pathlib import Path
from prepare import OWNED, REPOSITORY, AUDIT, blob, encoded, git, put, sha


SURFACE = '09ba85cef42898fbc2185d03acc4191f9a4689cd'
LIFECYCLE = '3f6db4dd29950d92410a4d4f9871ba18a5b56e89'
references = {}
derivations = []


def frozen(commit, path):
    data = blob(commit, path)
    assert (REPOSITORY / path).read_bytes() == data, path
    references[(commit, path)] = {'commit': commit, 'path': path, 'bytes': len(data), 'sha256': sha(data)}
    return data.decode()


def source(cohort, filename):
    commit = SURFACE if cohort == 'surface' else LIFECYCLE
    return frozen(commit, f'{AUDIT}/{cohort}/execution-v2/{filename}')


def replace(text, before, after):
    assert text.count(before) == 1, (before[:180], text.count(before))
    return text.replace(before, after)


def authored(cohort, filename, original, revised):
    put(OWNED / cohort / filename, revised)
    patch = ''.join(difflib.unified_diff(original.splitlines(True), revised.splitlines(True), f'approved-v2/{cohort}/{filename}', f'zero-overlay/{cohort}/{filename}'))
    if patch:
        put(OWNED / 'fixture-deltas' / (cohort + '-' + filename.replace('/', '__') + '.patch-data'), patch)
    derivations.append({'path': cohort + '/' + filename, 'approvedV2Sha256': sha(original.encode()), 'newSha256': sha(revised.encode()), 'unchanged': original == revised})


def lifecycle_driver(cohort):
    original = source('lifecycle', 'run.mjs')
    revised = replace(original, 'import { verifyProfile } from "./profile.mjs";', f'import {{ verifyProfile }} from "./profile.mjs";\nimport {{ author, candidate, directoryShape, releaseFor, verifyCandidate, verifyFrozen }} from "../admission.mjs";\nconst admission = releaseFor("{cohort}");\nconst overlay = verifyCandidate(admission);')
    revised = replace(revised, 'const lifecycle = resolve(directory, "..");', f'const lifecycle = "{REPOSITORY}/{AUDIT}/lifecycle";')
    revised = replace(revised, 'assert.ok(output.startsWith(join(directory, "evidence") + "/"));', 'assert.ok(output.startsWith(resolve(admission.outputRoot) + "/"));')
    revised = replace(revised, 'const runnerFreeze = load(join(directory, "RUNNER-FREEZE.json"));', 'const runnerFreeze = load(join(author, "FREEZE.json"));')
    revised = replace(revised, 'profile: revision, source: pins.staticReadEquality.sourceManifestSha256,', 'profile: revision, source: candidate.sourceManifestSha256, parentSource: candidate.parentSourceManifestSha256, rootAdmission: admission,')
    revised = replace(revised, 'One revised eleven-row / six-workflow author cohort: eight unchanged controls and three explicitly named revised bindings', 'Frozen zero-policy ' + ('six-row additional control cohort' if cohort == 'controls' else 'eleven-row lifecycle cohort; eight unchanged controls, retained L05 selector, restored two L06 zero-cap rows'))
    first = revised.index('function verifyRunner() {')
    last = revised.index('function currentImmutable()', first)
    revised = revised[:first] + 'function verifyRunner() { return verifyFrozen(); }\n' + revised[last:]
    revised = replace(revised, 'let immutable;', 'let immutable;\nlet shapes;')
    revised = replace(revised, 'sharedRoots = [prepared, proof.routes.sourceRoute, proof.routes.packagedRoute];', 'sharedRoots = [prepared, proof.routes.sourceRoute, proof.routes.packagedRoute, overlay.root, overlay.packageRoot];')
    revised = replace(revised, 'assert.equal(sha(JSON.stringify(assembly.candidateFiles.filter(entry => entry.path.startsWith("src/")))), report.source);', 'assert.equal(sha(JSON.stringify(assembly.candidateFiles.filter(entry => entry.path.startsWith("src/")))), report.parentSource);\n  assert.deepEqual(assembly.candidateFiles, overlay.parent);')
    revised = replace(revised, 'copyRegular(proof.routes.packagedRoute, join(temporary, "product"), assembly.candidateFiles);', 'copyRegular(overlay.root, join(temporary, "product"), overlay.entries);')
    revised = replace(revised, 'const installed = copyRegular(pins.publicPackageReadOnlyRoot, join(temporary, "consumer/node_modules/virtual-bash"));', 'const installed = copyRegular(overlay.packageRoot, join(temporary, "consumer/node_modules/virtual-bash"), overlay.packageEntries);')
    revised = replace(revised, 'pins.staticReadEquality.installedPackageInventorySha256', 'candidate.packageManifestSha256')
    revised = replace(revised, 'for (const entry of installed) assert.deepEqual(entry, assembly.candidateFiles.find(candidate => candidate.path === entry.path));', 'for (const entry of installed) assert.deepEqual(entry, overlay.entries.find(candidateEntry => candidateEntry.path === entry.path));')
    revised = replace(revised, 'copyRegular(join(lifecycle, "guests"), join(temporary, "consumer/harness/guests"));', 'copyRegular(join(directory, "guests"), join(temporary, "consumer/harness/guests"));')
    revised = replace(revised, 'immutable = currentImmutable();', 'immutable = currentImmutable();\n  shapes = directoryShape([...Object.keys(immutable).map(name => join(temporary, name)), ...sharedRoots]);\n  save("directory-shape-before.json", shapes);')
    revised = replace(revised, 'if (immutable) { verifyCopies("after-execution"); save("immutable-after.json", currentImmutable()); }', 'if (immutable) {\n      verifyCopies("after-execution"); save("immutable-after.json", currentImmutable());\n      const afterShapes = directoryShape([...Object.keys(immutable).map(name => join(temporary, name)), ...sharedRoots]);\n      save("directory-shape-after.json", afterShapes); assert.deepEqual(afterShapes, shapes);\n    }\n    verifyCandidate(admission);')
    revised = replace(revised, 'Empty-directory additions are not covered.', 'Directory-shape re-enumeration additionally detects empty-directory additions/removals; no atomic intervening-state or atime claim.')
    if cohort == 'controls':
        revised = replace(revised, 'total: 11, logicalWorkflows: 6', 'total: 6, logicalWorkflows: 1')
        revised = replace(revised, 'for (const row of cases.rows) {', 'for (const row of cases.rows) {\n    if (!blocked && row.requiresMatchedOpen && report.rows.find(entry => entry.id === row.requiresMatchedOpen)?.classification !== "PASS") blocked = `Missing matched open control ${row.requiresMatchedOpen}`;')
    authored(cohort, 'run.mjs', original, revised)


def main():
    candidate = json.loads((OWNED / 'CANDIDATE.json').read_text())
    for cohort, filenames in [('surface', ['child.mjs', 'CASES.json', 'PINS.json', 'RELEASE.json', 'controls.mjs']), ('lifecycle', ['child.mjs', 'common.mjs', 'guard.mjs'])]:
        for filename in filenames:
            text = source(cohort, filename)
            authored(cohort, filename, text, text)
    surface_cases = json.loads(source('surface', 'CASES.json'))
    for row in surface_cases['cases']:
        path = row['source']['path']
        text = frozen(SURFACE, f'{AUDIT}/surface/{path}')
        put(OWNED / 'surface' / path, text)
    lifecycle_original = source('lifecycle', 'CASES.json')
    lifecycle_text = replace(replace(lifecycle_original, '"maxRedirects": 1', '"maxRedirects": 0'), '"maxRetries": 1', '"maxRetries": 0')
    authored('lifecycle', 'CASES.json', lifecycle_original, lifecycle_text)
    lifecycle_cases = json.loads(lifecycle_text)
    revision_original = source('lifecycle', 'REVISION.json')
    revision = json.loads(revision_original)
    revision.update({'profileId': 'lifecycle-zero-cap-overlay-v3', 'release': 'AUTHOR/FREEZE ONLY; no runtime release; requires different review plus ROOT release', 'policy': 'Same11 row objects and expectations; approved L05 source selector retained; original both-zero L06 caps restored against only validated shared.ts overlay. No historical result is rescored.'})
    for row_id in ['L06-curl-open', 'L06-curl-consumer-closed']:
        revision['variants'][row_id]['variantId'] = row_id.replace('L06-', 'L06-Z0-')
        revision['variants'][row_id]['hostProfile'] = 'both-host-caps-zero-single-request'
    authored('lifecycle', 'REVISION.json', revision_original, json.dumps(revision, indent=2) + '\n')
    for path in sorted({row['guest'] for row in lifecycle_cases['rows']}):
        text = frozen(LIFECYCLE, f'{AUDIT}/lifecycle/{path}')
        put(OWNED / 'lifecycle' / path, text)
    lifecycle_driver('lifecycle')
    controls = copy.deepcopy(lifecycle_cases)
    controls['rows'] = []
    format_string = '%{http_code}|%{num_redirects}|%{num_retries}|%{size_upload}|%{size_download}|%{exitcode}\n'
    for number, family, status, status_text, extra_headers, fail, code in [
        (1, 'cli-override-positive', 200, 'OK', [], False, 0),
        (2, 'retry-after-fail-sentinel', 503, 'Service Unavailable', [['Retry-After', '1']], True, 22),
        (3, 'redirect-refusal-sentinel', 307, 'Temporary Redirect', [['Location', '/next']], False, 47),
    ]:
        positive_id = f'Z0{number}-open'
        for closed in [False, True]:
            row = copy.deepcopy(lifecycle_cases['rows'][-1 if closed else -2])
            row_id = f'Z0{number}-' + ('closed' if closed else 'open')
            row.update({'id': row_id, 'schedule': family, 'closeCurlConsumer': closed, 'initialFiles': {'/work/body.bin': 'zero-body-sentinel\n', '/work/headers.txt': 'zero-header-sentinel\n'}})
            if closed:
                row['requiresPositive'] = 'Z01-open'
                row['requiresMatchedOpen'] = positive_id
            curl = copy.deepcopy(controls['curlInputs'])
            curl.update({'responseStatus': status, 'responseStatusText': status_text, 'responseHeaders': [*curl['responseHeaders'], *extra_headers]})
            curl['args'] = ['-sS', '-T', '-', '-o', '/work/body.bin', '-D', '/work/headers.txt', '-w', format_string, '-L', '--max-redirs', '9', '--retry', '9', '--retry-delay', '0', *(['--fail'] if fail else []), curl['authorizedUrl']]
            curl['requiredFiles'] = {'/work/body.bin': 'body0\nbody1\n' if status == 200 else 'zero-body-sentinel\n', '/work/headers.txt': f'HTTP/1.1 {status} {status_text}\r\n' + ''.join(f'{name}: {value}\r\n' for name, value in curl['responseHeaders']) + '\r\n'}
            diagnostic = '' if code == 0 else f'curl: ({code}) ' + ('HTTP response status 503\n' if code == 22 else 'Maximum redirects exceeded\n')
            selected_code = 141 if closed and code == 0 else code
            writeout = f'{status}|0|0|6|{12 if status == 200 else 0}|{code}\n'
            row['curlInputs'] = curl
            row['expect'] = {'publicKind': 'result', 'exitCode': selected_code, 'stdout': ('' if closed else writeout) + f'curl:{selected_code}\n', 'stderr': diagnostic + curl['independentStderr'], 'curlStatus': selected_code, 'writeoutAccountedCalls': 0 if closed else 1, 'transportSignalAbortedByConsumer': False, 'responseBodyStarts': 1 if status == 200 else 0, 'responseBodyChunks': 2 if status == 200 else 0, 'uploadSourceStarts': 1, 'retryDelay1000msRequests': 0}
            row['qualification'] = 'Virtual public SafeJS facade + explicit injected transport only. Both-zero policy with finite CLI override9; Retry-After1 is finite. Error wins over closed-output141. Error body sentinel must remain exact, headers must publish, diagnostics remain required; no native parity claim.'
            controls['rows'].append(row)
    controls.update({'version': 'zero-policy-controls-v1', 'logicalWorkflows': 1, 'executionRows': 6, 'executionOrder': [row['id'] for row in controls['rows']]})
    authored('controls', 'CASES.json', lifecycle_original, json.dumps(controls, indent=2) + '\n')
    control_revision = copy.deepcopy(revision)
    control_revision.update({'profileId': 'zero-policy-controls-v1', 'variants': {}, 'cohort': {'rows': 6, 'workflows': 1, 'additionalControls': 6}, 'policy': 'Six additional rows separate from unchanged8 surface and versioned11 lifecycle; no result yet.', 'curlAdmission': {'authorizationCalls': 1, 'transportCalls': 1, 'authorizationAttempt': 0, 'redirectFromPresent': False, 'extraAdmissionPolicy': 'journal before acquisition; deny every extra; final exact journals must still equal one'}})
    authored('controls', 'REVISION.json', revision_original, json.dumps(control_revision, indent=2) + '\n')
    for filename in ['common.mjs', 'guard.mjs']:
        original = source('lifecycle', filename)
        revised = original
        if filename == 'guard.mjs':
            revised = replace(revised, 'const activeTimers = new Set();', 'const activeTimers = new Set();\nconst timerRequests = [];')
            revised = replace(revised, 'const wrappedSet = (callback, ...args) => {', 'const wrappedSet = (callback, ...args) => {\n    assert.ok(timerRequests.length < 512);\n    timerRequests.push({ operation: setName, delay: args[0] });')
            revised = replace(revised, 'activeTimers: activeTimers.size,', 'activeTimers: activeTimers.size, timerRequests: [...timerRequests],')
        authored('controls', filename, original, revised)
    original = source('lifecycle', 'child.mjs')
    revised = replace(original, 'assert.ok(row);', 'assert.ok(row);\nconst curlInputs = row.curlInputs;\nassert.equal(curlInputs.limits.maxRedirects, 0);\nassert.equal(curlInputs.limits.maxRetries, 0);')
    revised = revised.replace('cases.curlInputs', 'curlInputs')
    revised = replace(revised, 'let responseDisposeCalls = 0;', 'let responseDisposeCalls = 0;\nlet responseBodyStarts = 0;\nlet responseBodyChunks = 0;\nlet uploadSourceStarts = 0;')
    revised = replace(revised, 'await fs.mkdir("/work");', 'await fs.mkdir("/work");\n  for (const [filename, text] of Object.entries(row.initialFiles)) await fs.writeFile(filename, Buffer.from(text));')
    revised = replace(revised, 'const response = { status: 200, statusText: "OK", httpVersion: "1.1", headers: curlInputs.responseHeaders,', 'const response = { status: curlInputs.responseStatus, statusText: curlInputs.responseStatusText, httpVersion: curlInputs.responseHttpVersion, headers: curlInputs.responseHeaders,')
    revised = replace(revised, 'body: (async function* () { for (const hex of curlInputs.responseChunksHex) yield Buffer.from(hex, "hex"); })(),', 'body: (async function* () { responseBodyStarts += 1; for (const hex of curlInputs.responseChunksHex) { responseBodyChunks += 1; yield Buffer.from(hex, "hex"); } })(),')
    revised = replace(revised, 'const input = (async function* () {', 'const input = (async function* () {\n            uploadSourceStarts += 1;')
    revised = replace(revised, 'assert.equal(response.status, 200); assert.equal(response.statusText, "OK"); assert.equal(response.httpVersion, "1.1");', 'assert.equal(response.status, curlInputs.responseStatus); assert.equal(response.statusText, curlInputs.responseStatusText); assert.equal(response.httpVersion, curlInputs.responseHttpVersion);')
    revised = replace(revised, 'assert.equal(response.headers.some(([name]) => name.toLowerCase() === "location"), false);', 'assert.equal(response.headers.some(([name]) => name.toLowerCase() === "location"), curlInputs.responseStatus === 307);')
    revised = replace(revised, 'report.classification = report.assertions.every(entry => entry.pass) ? "PASS" : "FAIL";', 'check("zero-policy no replay, no retry timer and exact body suppression", () => {\n    report.zeroPolicy = { responseBodyStarts, responseBodyChunks, uploadSourceStarts, timerRequests: guardState().timerRequests };\n    assert.equal(responseBodyStarts, row.expect.responseBodyStarts);\n    assert.equal(responseBodyChunks, row.expect.responseBodyChunks);\n    assert.equal(uploadSourceStarts, row.expect.uploadSourceStarts);\n    assert.equal(report.zeroPolicy.timerRequests.filter(entry => entry.operation === "setTimeout" && entry.delay === 1000).length, row.expect.retryDelay1000msRequests);\n  });\n  report.classification = report.assertions.every(entry => entry.pass) ? "PASS" : "FAIL";')
    authored('controls', 'child.mjs', original, revised)
    put(OWNED / 'controls/guests/curl.ajs.data', frozen(LIFECYCLE, f'{AUDIT}/lifecycle/guests/curl.ajs.data'))
    lifecycle_driver('controls')
    original = source('surface', 'run.mjs')
    revised = replace(original, 'const owned = dirname(fileURLToPath(import.meta.url));', 'import { candidate, directoryShape, releaseFor, verifyCandidate, verifyFrozen } from "../admission.mjs";\nconst admission = releaseFor("surface");\nconst overlay = verifyCandidate(admission);\nconst owned = dirname(fileURLToPath(import.meta.url));')
    revised = replace(revised, 'const surface = dirname(owned);', f'const surface = "{REPOSITORY}/{AUDIT}/surface";')
    revised = replace(revised, 'const task = mkdtempSync("/private/tmp/safe-bash-owned-output-surface-execution-v2-");', 'mkdirSync(admission.outputRoot, { recursive: true });\nconst task = mkdtempSync(join(admission.outputRoot, "surface-zero-overlay-"));')
    first = revised.index('  const frozenRunner = JSON.parse(')
    last = revised.index('  for (const entry of release.receipts)', first)
    revised = revised[:first] + '  const runnerCommit = verifyFrozen();\n  journal.runnerCommit = runnerCommit;\n  journal.rootAdmission = admission;\n  journal.candidateIdentity = candidate.candidateManifestSha256;\n' + revised[last:]
    revised = replace(revised, 'journal.release = release;', 'journal.historicalRelease = release;')
    revised = replace(revised, 'put("/private/tmp/safe-bash-owned-output-surface-finding.txt",', 'put(join(task, "ROOT-FINDING.json"),')
    revised = replace(revised, 'await childCase(cohort.cases.find(entry => entry.id === "09-conditional-finite-marker"), journal.cohortDeadline, expectedImports);', 'journal.conditionalBlocked = "Dormant original09 data preserved; this release freezes exactly eight surface profiles. Stop and route finding to ROOT; no ninth child authorized.";')
    revised = replace(revised, 'candidateEntries = provenance.get("assembly.json").candidateFiles;', 'assert.deepEqual(provenance.get("assembly.json").candidateFiles, overlay.parent);\n  candidateEntries = overlay.entries;')
    revised = replace(revised, 'consumerEntries = provenance.get("build-proof.json").consumerFiles;', 'assert.equal(hash(JSON.stringify(provenance.get("build-proof.json").consumerFiles)), "4a81b133665b238545f2111bf349250329e874917691235be67d703056a4f018");\n  consumerEntries = overlay.packageEntries;')
    revised = replace(revised, 'assert.deepEqual(bytesOnly(sharedBaseline[root]), candidateEntries);', 'assert.deepEqual(bytesOnly(sharedBaseline[root]), overlay.parent);')
    revised = replace(revised, 'sharedBaseline = allInputs(sharedRoots);', 'const originalRoutes = sharedRoots.slice(-2);\n  sharedRoots.push(overlay.root, overlay.packageRoot);\n  sharedBaseline = allInputs(sharedRoots);')
    revised = replace(revised, 'for (const root of sharedRoots.slice(-2))', 'for (const root of originalRoutes)')
    revised = replace(revised, 'copyTree(join(shared, "candidate"), join(task, "candidate"), candidateEntries);', 'copyTree(overlay.root, join(task, "candidate"), candidateEntries);')
    revised = replace(revised, 'copyTree(join(shared, "consumer/node_modules/virtual-bash"), join(task, "consumer/node_modules/virtual-bash"), consumerEntries);', 'copyTree(overlay.packageRoot, join(task, "consumer/node_modules/virtual-bash"), consumerEntries);')
    revised = replace(revised, 'copyTree(join(privateRoot, "packages/safejs"), join(task, "engine"), bytesOnly(before.engine), new Set(before.qualification.exclusions));', 'copyTree(join(shared, "engine"), join(task, "engine"), bytesOnly(before.engine));')
    revised = replace(revised, 'regular(join(filename === "CASES.json" || filename === "PINS.json" ? owned : surface, filename))', 'regular(join(owned, filename))')
    revised = replace(revised, 'let inputBaseline;', 'let inputBaseline;\nlet shapes;')
    revised = replace(revised, 'inputBaseline = allInputs(inputRoots);', 'inputBaseline = allInputs(inputRoots);\n  shapes = directoryShape([...inputRoots, ...sharedRoots]);\n  put(join(results, "directory-shape-before.json"), shapes);')
    revised = replace(revised, 'if (inputBaseline) {', 'verifyFrozen(); verifyCandidate(admission);\n    if (inputBaseline) {\n      const afterShapes = directoryShape([...inputRoots, ...sharedRoots]);\n      put(join(results, "directory-shape-after.json"), afterShapes); assert.deepEqual(afterShapes, shapes);')
    authored('surface', 'run.mjs', original, revised)
    original = source('lifecycle', 'profile.mjs')
    revised = replace(original, "originalCasesText.replace('\"maxRedirects\": 0', '\"maxRedirects\": 1').replace('\"maxRetries\": 0', '\"maxRetries\": 1')", 'originalCasesText')
    revised = replace(revised, 'assert.deepEqual(cases.curlInputs.limits, proposedCurl.constructor.limits);', 'assert.deepEqual(cases.curlInputs.limits, { ...proposedCurl.constructor.limits, maxRedirects: 0, maxRetries: 0 });')
    revised = replace(revised, 'assert.deepEqual(revisedIds.slice(1).map(id => revision.variants[id].variantId), proposedCurl.futureVariantIds);', 'assert.deepEqual(proposedCurl.futureVariantIds, ["L06-C1-curl-open", "L06-C1-curl-consumer-closed"]);\n  assert.deepEqual(revisedIds.slice(1).map(id => revision.variants[id].variantId), ["L06-Z0-curl-open", "L06-Z0-curl-consumer-closed"]);')
    revised = replace(revised, 'onlyCasesByteDelta: ["maxRedirects: 0 -> 1", "maxRetries: 0 -> 1"]', 'onlyCasesByteDelta: ["versus approved v2: maxRedirects 1 -> 0", "versus approved v2: maxRetries 1 -> 0"], originalZeroCasesBytesRestored: true')
    authored('lifecycle', 'profile.mjs', original, revised)
    for commit, path in [
        (LIFECYCLE, f'{AUDIT}/lifecycle/SOURCE-PINS.json'),
        ('c8df5cf2819d7ad9d54c2a70800258c7c200665a', f'{AUDIT}/lifecycle/FREEZE.json'),
        ('19da254941847de60e80ea18407332bbe10b5265', f'{AUDIT}/lifecycle/execution-v1/evidence/attempt-01/private-after.json'),
        (SURFACE, f'{AUDIT}/surface/FREEZE-v2.json'),
        ('c53e63f3bfe26e0f9982f17c391e11255512201d', f'{AUDIT}/validity-independent/replay-v2/execution/FREEZE.json'),
        ('9f44add1e59ea65af85ece4d2b4eac9af5d02df8', f'{AUDIT}/validity-independent/replay-v2/REPORT.md'),
    ]:
        frozen(commit, path)
    release = json.loads(source('surface', 'RELEASE.json'))
    for entry in release['receipts']:
        frozen(entry['commit'], entry['path'])
    pins = json.loads(source('surface', 'PINS.json'))
    for entry in pins['provenance']['files']:
        frozen(pins['provenance']['commit'], entry['path'])
    for entry in json.loads(frozen(SURFACE, f'{AUDIT}/surface/FREEZE-v2.json'))['files']:
        frozen(SURFACE, f'{AUDIT}/surface/' + entry['path'])
    for path in git('ls-tree', '-r', '--name-only', 'c8df5cf2819d7ad9d54c2a70800258c7c200665a', '--', f'{AUDIT}/lifecycle').decode().splitlines():
        frozen('c8df5cf2819d7ad9d54c2a70800258c7c200665a', path)
    for entry in candidate['bindings']:
        references[(entry['commit'], entry['path'])] = {'commit': entry['commit'], 'path': entry['path'], 'sha256': entry['sha256']}
    put(OWNED / 'REFERENCES.json', sorted(references.values(), key=lambda entry: (entry['path'], entry['commit'])))
    put(OWNED / 'FIXTURE-DERIVATION.json', {'approvedSurfaceCommit': SURFACE, 'approvedLifecycleCommit': LIFECYCLE, 'files': derivations, 'baseSurfaceProfiles': 8, 'dormantConditionalSurfaceData': 1, 'baseLifecycleProfiles': 11, 'additionalZeroPolicyControls': 6, 'executed': 0, 'noPromotion': True})
    print(json.dumps({'surface': 8, 'lifecycle': 11, 'controls': len(controls['rows']), 'references': len(references), 'fixtureFiles': len(derivations)}))


if __name__ == '__main__':
    main()
