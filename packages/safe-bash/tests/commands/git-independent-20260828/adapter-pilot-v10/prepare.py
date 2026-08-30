import base64
import datetime
import gzip
import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile
import time

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OLD = ROOT.parent / 'm1a-review-v5'
V9 = ROOT.parent / 'adapter-v9'
START = time.monotonic_ns()
METADATA = []

def sha(data):
    return hashlib.sha256(data).hexdigest()

def add(name, value):
    text = value if isinstance(value, str) else json.dumps(value, indent=2) + '\n'
    if (ROOT / name).exists():
        assert (ROOT / name).read_text() == text, 'existing preparation artifact differs: ' + name
        return
    patch = '*** Begin Patch\n*** Add File: ' + str((ROOT / name).relative_to(REPO)) + '\n'
    patch += ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch, text=True, cwd=REPO, check=True)

def census(root):
    rows = []
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink()
        rows.append({'path': str(path), 'directory': True, 'bytes': 0} if path.is_dir() else
                    {'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())})
    return rows

for commit, directory, names in [
    ('655cb37b97521558c4c90581b5b23fc6c3ad9bf2', OLD, ['BINDING.json','PRESEAL.json','INPUTS.json','WORKING.json.gz.base64','cases.mjs','fixtures.mjs']),
    ('2ed1e2e620b0db2bcfc05c733b56cad6f201d0b5', V9, ['SOURCE-TRANSFORMS.json','adapter.mjs']),
]:
    for name in names:
        relative = str((directory / name).relative_to(REPO))
        args = ['git','show',commit + ':' + relative]
        METADATA.append(args)
        assert subprocess.check_output(args,cwd=REPO) == (directory / name).read_bytes(), relative

binding = json.loads((OLD / 'BINDING.json').read_text())
old_seal = json.loads((OLD / 'PRESEAL.json').read_text())
originals = {row['path']: row for row in json.loads((OLD / 'INPUTS.json').read_text())}
working = json.loads(gzip.decompress(base64.b64decode((OLD / 'WORKING.json.gz.base64').read_bytes())))['entries']
working_map = {row['path']: row for row in working}
for row in working:
    assert not pathlib.PurePosixPath(row['path']).is_absolute() and '..' not in pathlib.PurePosixPath(row['path']).parts
    if 'base64' in row:
        data = base64.b64decode(row['base64']); assert sha(data) == row['sha256'] and len(data) == row['bytes']
package = base64.b64decode(pathlib.Path(old_seal['packagePath']).read_bytes())
assert sha(package) == old_seal['packageSha256']
expected_members = {row['path']: row for row in binding['members']}
modules = []
members = []
with tarfile.open(fileobj=io.BytesIO(package), mode='r:gz') as archive:
    for member in archive.getmembers():
        assert member.isfile() and member.name.startswith('package/')
        name = member.name.removeprefix('package/')
        assert '..' not in pathlib.PurePosixPath(name).parts and not name.startswith('/') and name not in [row['path'] for row in members]
        assert member.size < 8 * 1024 * 1024
        data = archive.extractfile(member).read()
        expected = expected_members[name]
        assert sha(data) == expected['sha256'] and len(data) == expected['bytes']
        members.append({'path': name, 'sha256': sha(data), 'bytes': len(data)})
        if name.startswith('dist/') and name.endswith('.js'):
            assert sha(data) == working_map['source/' + name]['sha256']
            modules.append({'path': name, 'sha256': sha(data), 'bytes': len(data), 'base64': base64.b64encode(data).decode(), 'role': 'authenticated-original-M1A-emit'})
assert len(members) == 898 and len(modules) == 224
assert sum(row['bytes'] for row in members) < 16 * 1024 * 1024
for path, row in originals.items():
    data = base64.b64decode(row['base64']); assert sha(data) == row['sha256']
    assert working_map['source/' + path]['sha256'] == row['sha256']

v9_source = json.loads((V9 / 'SOURCE-TRANSFORMS.json').read_text())['sources']
transforms = []
for item in v9_source:
    if not item['path'].startswith('src/') or 'transformedBase64' not in item:
        continue
    original = base64.b64decode(originals[item['path']]['base64']).decode()
    changes = item['changes']
    if item['path'] == 'src/shell/runtime.ts':
        changes = [
            {'before': '        const raw = definition.execute(forwarded);', 'after': '        __v9("shell-route", forwarded, scope);\n        const raw = definition.execute(forwarded);'},
            {'before': '        return await this.observeRuntimeReturn(raw, runtimeFrame);',
             'after': '        try { const result = await this.observeRuntimeReturn(raw, runtimeFrame); __v9("execute-joined", forwarded, raw, false); return result; }\n        catch (error) { __v9("execute-joined", forwarded, raw, true); __v9("execute-failure", forwarded, error); throw error; }'},
        ]
    else:
        assert sha(original.encode()) == item['sha256']
    transformed = original
    mapped = []
    for change in changes:
        before, after = change['before'], change['after']; assert transformed.count(before) == 1
        offset = original.index(before)
        mapped.append({'before': before, 'after': after, 'line': original[:offset].count('\n') + 1,
                       'byteOffset': len(original[:offset].encode()), 'beforeSha256': sha(before.encode()), 'afterSha256': sha(after.encode())})
        transformed = transformed.replace(before, after)
    reversed_text = transformed
    for change in reversed(mapped): reversed_text = reversed_text.replace(change['after'], change['before'], 1)
    assert reversed_text == original
    transformed = item['prefix'] + transformed
    for pattern in [r'\bawait\b', r'\.then\s*\(', r'\.catch\s*\(']: assert len(re.findall(pattern, original)) == len(re.findall(pattern, transformed))
    transforms.append({'path': item['path'], 'emitPath': item['path'].replace('src/', 'dist/', 1).removesuffix('.ts') + '.js',
                       'originalSha256': sha(original.encode()), 'originalBase64': base64.b64encode(original.encode()).decode(),
                       'v9OriginalSha256': item['sha256'], 'rebasedFromV9': sha(original.encode()) != item['sha256'],
                       'prefix': item['prefix'], 'changes': mapped, 'transformedSha256': sha(transformed.encode()),
                       'transformedBase64': base64.b64encode(transformed.encode()).decode(), 'reversalExact': True})
case = next(item for item in v9_source if item['path'].endswith('/cases.mjs'))
case_data = base64.b64decode(case['transformedBase64'])
assert sha(case_data) == case['transformedSha256']
add('cases.mjs', case_data.decode())
add('fixtures.mjs', (OLD / 'fixtures.mjs').read_text())
records = pathlib.Path(binding['records']['path']).read_bytes(); assert sha(records) == binding['records']['sha256']
add('records.json', records.decode())
adapter = (V9 / 'adapter.mjs').read_text()
adapter_changes = [
 ('{ capacity = 8192, identities = 1024, streamLimit = 32 }', '{ capacity = 262144, identities = 65536, streamLimit = 1024 }'),
 ('  const shellRoutes = [];', '  const shellRoutes = [];\n  const contexts = [];'),
 ("      record(event, subject, value, detail);", "      record(event, subject, value, detail);\n      if (event === 'invocation-begin') { if (contexts.length === 128) invalid = true; else if (!contexts.includes(subject)) contexts.push(subject); }"),
 ("      token: null, iterator: null, pendingNext: false, yielded: false, causes: [], errors: [], closed: false, restored: false };", "      token: null, iterator: null, pendingNext: false, yielded: false, causes: [], errors: [], closed: false, restored: false };\n    resource.closePromise = new Promise(resolve => { resource.resolveClose = resolve; });"),
 ("resource.onClose = () => { resource.closed = true; record('close-delivered', stream); };", "resource.onClose = () => { resource.closed = true; record('close-delivered', stream); resource.resolveClose(); };"),
 ('  return Object.freeze({ probe, inspect, verify, restore, rows });', '''  const states = () => resources.map(resource => ({ streamId: identity(resource.stream), contextId: identity(resource.context),
    closed: resource.stream.closed, destroyed: resource.stream.destroyed, closeDelivered: resource.closed,
    returnPending: resource.token !== null, readerPending: resource.pendingNext, causes: resource.causes.map(identity),
    errors: resource.errors.map(error => ({ reasonId: identity(error.reason), owned: error.owned, sequence: error.sequence })) }));
  const report = () => ({ contexts: contexts.map(context => ({ contextId: identity(context), ...inspect(context) })),
    resources: states(), valid: verify(), events: rows(), identityCount: referenceCount,
    identityTypes: Array.from({ length: referenceCount }, (_, index) => ({ id: index, type: references[index] === null ? 'null' : typeof references[index] })) });
  const notificationBarrier = () => Promise.all(resources.map(resource => resource.closePromise));
  const emergencyDestroy = () => { for (const resource of resources) if (!resource.stream.destroyed) Reflect.apply(resource.originalDestroy, resource.stream, []); };
  return Object.freeze({ probe, inspect, verify, restore, rows, report, notificationBarrier, emergencyDestroy });'''),
]
for before, after in adapter_changes:
    assert adapter.count(before) == 1, before
    adapter = adapter.replace(before, after)
add('adapter.mjs', adapter)
add('TRANSFORMS.json', {'classification': 'exact-source diagnostic overlays; not unchanged semantics',
 'candidateGit': binding['source'], 'base': binding['base'], 'candidateSourceMembership': binding['selected'],
 'moduleTransforms': transforms, 'caseOverlay': case,
 'adapterParentSha256': sha((V9 / 'adapter.mjs').read_bytes()), 'adapterChanges': [{'before': before, 'after': after} for before, after in adapter_changes],
 'runtimeRebase': 'Original M1A selected d2502aae runtime, not newer arrays runtime at full988 tree; no array source introduced; Git988 modules identical.'})
add('PACKAGE-DATA.json', {'packageSha256': sha(package), 'packageBytes': len(package), 'members': members, 'modules': modules,
                         'workingArchiveSha256': sha((OLD / 'WORKING.json.gz.base64').read_bytes()), 'sourceInputsSha256': sha((OLD / 'INPUTS.json').read_bytes())})
raw = json.loads(gzip.decompress(base64.b64decode((OLD / 'RAW.json.gz.base64').read_bytes())))['entries']
historical = []
previous = 0
for entry in raw:
    if re.fullmatch(r'source/(A\d\d|H\d\d)\.json', entry['path']):
        row = json.loads(base64.b64decode(entry['base64'])); current = row['nativeZlib']['created']
        historical.append({'id': row['id'], 'historicalCreatedDelta': current - previous, 'invocationsObserved': len(row['observations']), 'rowSha256': entry['sha256']})
        previous = current
add('CAPACITY.json', {'allMembership': [f'A{number:02}' for number in range(1,61)] + [f'H{number:02}' for number in range(1,12)],
 'pilotMembership': ['A57','A60','H09'], 'negativeControlMembership': [], 'historicalDataOnly': historical,
 'frozenFixtureSha256': sha((OLD / 'fixtures.mjs').read_bytes()), 'frozenCasesSha256': sha((OLD / 'cases.mjs').read_bytes()), 'recordsSha256': sha(records),
 'capacity': {'perGroupEvents': 262144, 'perGroupIdentities': 65536, 'perGroupStreams': 1024, 'perGroupContexts': 128,
              'perStreamCauses': 8, 'perStreamErrors': 32, 'shellRoutes': 32, 'workerAggregateCaptureBytes': 16777216},
 'planning': {'historicalSourceGroups': 69, 'historicalFactoryObjects': 289, 'historicalMaxCreatedPerGroup': max(row['historicalCreatedDelta'] for row in historical),
              'historicalMaxInvocationRowsPerGroup': max(row['invocationsObserved'] for row in historical),
              'H10': 'two direct calls, refusal before object inflate; not executed', 'H11': 'one ordinary source show via owned Real; not executed',
              'largestExplicitFixtureBodyBytes': 8194, 'oversizedHeaderOnly': 'blob 8388609\\0; no 8MiB body',
              'fullProductUpperBoundsAreNotFixtureCounts': {'maxObjects': 32768,'maxInflatedBytes':134217728,'maxSteps':32000000},
              'notClaimed': 'Historical counts are headroom planning, not proof every possible full-fixture schedule fits. No cap is a product limit. Overflow invalidates observer and stops.'},
 'captureStrategy': 'retain bounded per-group trace; publish at existing completed case boundary after owned notifications; cap whole worker16MiB and cohort32MiB; no asynchronous trace flushing within product work'})
typescript = next(tool for tool in binding['tools'] if tool['name'] == 'typescript')
builtins = sorted(set(re.findall(r'[\'\"](node:[a-zA-Z0-9_/-]+)[\'\"]', '\n'.join(base64.b64decode(row['base64']).decode() for row in modules))) |
                  {'node:assert/strict','node:fs/promises','node:fs','node:path','node:url','node:crypto','node:zlib','node:timers/promises','node:module'})
for row in typescript['rows']:
    if 'sha256' in row: assert sha((pathlib.Path(typescript['root']) / row['path']).read_bytes()) == row['sha256']
add('PRESEAL.json', {'schema': 'adapter-pilot-v10-author-only', 'frozenWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'preparationAttempts': [{'attempt':1,'role':'DATA only','failure':'apply_patch argv exceeded ARG_MAX writing PACKAGE-DATA.json; no compiler or product executed'},
                         {'attempt':2,'role':'DATA only','repair':'apply_patch stdin transport; previously generated exact bytes verified, not rewritten'}],
 'preparationFirstWall': '2026-08-28T20:22:24Z', 'preparationScriptMs': (time.monotonic_ns()-START)/1e6,
 'node': binding['node'], 'typescript': typescript, 'compilerOptions': {'target': 'ES2023', 'module': 'ES2022', 'sourceMap': False, 'declaration': False},
 'candidateGit': binding['source'], 'base': binding['base'], 'sourceSelection': 'original authenticated M1A derived package composition; not whole988 checkout',
 'membership': [{'id':'A57','expectedExit':0,'expectedStdout':'two\n','createdObjects':6,'route':'direct-noHook'},
                {'id':'A60','expectedExit':0,'expectedStdout':'two\n','createdObjects':6,'route':'actual-Shell-plugin'},
                {'id':'H09','expectedExit':128,'expectedStdout':'','createdObjects':3,'route':'direct-registered-cleanup'}],
 'negativeControls': [], 'limits': {'aggregateMs':600000,'setupMs':120000,'caseMs':30000,'notificationMs':5000,'workerMs':110000,
 'captureBytes':33554432,'workBytes':268435456,'processes':3,'directSpawnedChildren':2,'conservativeChildrenIncludingCoordinator':3,'ceiling':12,'peak':2,'syntaxChildren':0},
 'command': str(binding['node']['path']) + ' ' + str((ROOT / 'run.mjs').relative_to(REPO)), 'cwd':str(REPO),
 'childEnvironment': {'PATH':str(pathlib.Path(binding['node']['path']).parent),'UV_THREADPOOL_SIZE':'1'},
 'children': [{'role':'bounded-five-module-compiler','argv':[str(ROOT/'compile.mjs')]},{'role':'three-case-mechanical-pilot','argv':[str(ROOT/'bootstrap.mjs')]}],
 'allowedBuiltins': builtins, 'sourcePreparationGitCommands': METADATA,
 'files': [{'path':path.name,'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())} for path in sorted(ROOT.iterdir()) if path.is_file()],
 'oldTrees': [{'root':str(ROOT.parent/name),'rows':census(ROOT.parent/name)} for name in ['m1a-review-v5','observer-qualification-v6','observer-qualification-v7','observer-qualification-v8','observer-v8-independent','adapter-v9']],
 'foreignIndexBefore': subprocess.check_output(['git','diff','--cached','--name-status','-z'],cwd=REPO).decode(),
 'emitBinding': 'compiler output SHA256 + transformed input SHA + options + compiler identity recorded before worker starts; loader returns exact verified bytes and records actual module URL/hash; no fallback'})
