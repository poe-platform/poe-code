import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

REPO = Path('/Users/kjopek/Workspace/safe-bash')
BASE = 'tests/integration/safejs-owned-output-prototype-review'
OWN = REPO / BASE / 'validity-independent/replay-v2/execution'
ENV = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}
SURFACE = '09ba85cef42898fbc2185d03acc4191f9a4689cd'
LIFECYCLE = '3f6db4dd29950d92410a4d4f9871ba18a5b56e89'
SURFACE_EVIDENCE = 'ac549fc392f0853a369e1cef08c6ab08f7b12a95'
LIFECYCLE_EVIDENCE = '365ec125589cb41e7e9ea8134314627583ee21dd'


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPO), '-c', 'core.fsmonitor=false', *args], env=ENV)


def digest(data):
    return hashlib.sha256(data).hexdigest()


bindings = []


def blob(commit, filename):
    data = git('show', f'{commit}:{filename}')
    entry = {'commit': commit, 'path': filename, 'bytes': len(data), 'sha256': digest(data)}
    if entry not in bindings:
        bindings.append(entry)
    return data


def read_json(commit, filename):
    return json.loads(blob(commit, filename))


def verify_seal(commit, directory, filename, expected=None):
    data = blob(commit, f'{directory}/{filename}')
    if expected:
        assert digest(data) == expected, filename
    seal = json.loads(data)
    for entry in seal['files']:
        content = blob(commit, f'{directory}/{entry["path"]}')
        assert len(content) == entry['bytes'] and digest(content) == entry['sha256'], entry
    return seal


def apply_files(files):
    patch = '*** Begin Patch\n'
    for filename, text in files.items():
        assert not Path(filename).exists(), filename
        patch += f'*** Add File: {filename}\n' + ''.join('+' + line + '\n' for line in text.splitlines())
    patch += '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch.encode(), check=True, cwd=REPO)


for commit in [SURFACE, LIFECYCLE, SURFACE_EVIDENCE, LIFECYCLE_EVIDENCE]:
    assert git('rev-parse', f'{commit}^{{commit}}').decode().strip() == commit
verify_seal(SURFACE, f'{BASE}/surface/execution-v2', 'RUNNER-FREEZE.json')
verify_seal(LIFECYCLE, f'{BASE}/lifecycle/execution-v2', 'RUNNER-FREEZE.json', '70c5cf226b74308d5223d7102aa90c5b23481c0413dd7ffd6d0235f360f1a80b')
verify_seal(SURFACE_EVIDENCE, f'{BASE}/surface/execution-v2/attempt-01', 'SEAL.json', '18cb88e2241b1ee1ef186ea8c3ef0d70e744b9f81b63170aeb8abc46f851cfe2')
verify_seal(LIFECYCLE_EVIDENCE, f'{BASE}/lifecycle/execution-v2', 'ARTIFACTS.json', '2ef85dd6e767d591e1949bd9410a5dd1fb2a43670d41de221e75bdf8deeb3999')
for commit, family in [(SURFACE, 'surface'), (LIFECYCLE, 'lifecycle')]:
    for filename in git('ls-tree', '-r', '--name-only', commit, '--', f'{BASE}/{family}/execution-v2').decode().splitlines():
        assert blob(commit, filename) == blob(SURFACE_EVIDENCE if family == 'surface' else LIFECYCLE_EVIDENCE, filename)

original_surface = read_json('5645b4f516438b66e4fad32a585ab27cda8f7cdc', f'{BASE}/surface/CASES.json')
surface_cases = read_json(SURFACE, f'{BASE}/surface/execution-v2/CASES.json')
original_surface['cases'][7]['expected']['engine'] = surface_cases['cases'][7]['expected']['engine']
assert original_surface == surface_cases
delta = read_json(SURFACE, f'{BASE}/surface/execution-v2/DELTA.json')
old_surface_run = blob(delta['baseCommit'], f'{BASE}/surface/execution-v1/run.mjs').decode()
for replacement in delta['runner']['replacements']:
    assert old_surface_run.count(replacement['before']) == 1
    old_surface_run = old_surface_run.replace(replacement['before'], replacement['after'])
assert old_surface_run == blob(SURFACE, f'{BASE}/surface/execution-v2/run.mjs').decode()
original_lifecycle = blob('19da254941847de60e80ea18407332bbe10b5265', f'{BASE}/lifecycle/CASES.json')
assert original_lifecycle.replace(b'"maxRedirects": 0', b'"maxRedirects": 1').replace(b'"maxRetries": 0', b'"maxRetries": 1') == blob(LIFECYCLE, f'{BASE}/lifecycle/execution-v2/CASES.json')
for filename in ['common.mjs', 'guard.mjs']:
    assert blob('91464989ff4c563195330cc3a7cacc4500c0bad0', f'{BASE}/lifecycle/execution-v1/{filename}') == blob(LIFECYCLE, f'{BASE}/lifecycle/execution-v2/{filename}')

temporary = Path(tempfile.mkdtemp(prefix='safe-bash-independent-v2-inputs-', dir='/private/tmp')).resolve()
extracted = []
for commit, subtree in [('5645b4f516438b66e4fad32a585ab27cda8f7cdc', 'surface'), ('19da254941847de60e80ea18407332bbe10b5265', 'lifecycle'), (SURFACE, 'surface/execution-v2'), (LIFECYCLE, 'lifecycle/execution-v2')]:
    for line in git('ls-tree', '-r', commit, '--', f'{BASE}/{subtree}').decode().splitlines():
        header, filename = line.split('\t')
        mode, kind, oid = header.split()
        assert kind == 'blob' and mode in ['100644', '100755']
        data = blob(commit, filename)
        target = temporary / Path(filename).relative_to(BASE)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(0o400)
        extracted.append({'path': str(target.relative_to(temporary)), 'bytes': len(data), 'sha256': digest(data), 'commit': commit, 'gitPath': filename})

adaptations = {}
generated = {}
shape_function = '''function independentDirectoryShape(roots) {
  const output = {};
  for (const root of roots) {
    const entries = [];
    const visit = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        assert.ok(entry.isDirectory() || entry.isFile(), `Nonregular independent input: ${entry.name}`);
        const filename = join(directory, entry.name);
        entries.push({ path: relative(root, filename), kind: entry.isDirectory() ? "directory" : "file" });
        if (entry.isDirectory()) visit(filename);
      }
    };
    visit(root); output[root] = entries;
  }
  return output;
}
let independentShapes;
'''

for family, commit in [('surface', SURFACE), ('lifecycle', LIFECYCLE)]:
    original = blob(commit, f'{BASE}/{family}/execution-v2/run.mjs').decode()
    revised = original
    replacements = []

    def change(before, after):
        global revised
        assert revised.count(before) == 1, (family, before, revised.count(before))
        revised = revised.replace(before, after)
        replacements.append({'before': before, 'after': after})

    directory = temporary / family / 'execution-v2'
    if family == 'surface':
        change('const owned = dirname(fileURLToPath(import.meta.url));', f'const owned = {json.dumps(str(directory))};')
        change('const repository = resolve(surface, "../../../..");', f'const repository = {json.dumps(str(REPO))};')
        change('const task = mkdtempSync("/private/tmp/safe-bash-owned-output-surface-execution-v2-");', 'const task = mkdtempSync("/private/tmp/safe-bash-independent-surface-v2-");')
        change('const runnerCommit = git(repository, "log", "-1", "--format=%H", "--", relative(repository, join(owned, "RUNNER-FREEZE.json"))).trim();', f'const runnerCommit = "{commit}";')
        change('gitBytes(runnerCommit, relative(repository, join(owned, entry.path)))', f'gitBytes(runnerCommit, `{BASE}/surface/execution-v2/${{entry.path}}`)')
        change('gitBytes(release.inputCommit, relative(repository, join(surface, "FREEZE-v2.json")))', f'gitBytes(release.inputCommit, "{BASE}/surface/FREEZE-v2.json")')
        change('copyTree(join(privateRoot, "packages/safejs"), join(task, "engine"), bytesOnly(before.engine), new Set(before.qualification.exclusions));', 'copyTree(join(shared, "engine"), join(task, "engine"), bytesOnly(before.engine));')
        change('put("/private/tmp/safe-bash-owned-output-surface-finding.txt",', 'put(join(results, "independent-finding.txt"),')
        change('await childCase(cohort.cases.find(entry => entry.id === "09-conditional-finite-marker"), journal.cohortDeadline, expectedImports);', 'journal.conditionalExecutionRefused = "Independent release authorizes only eight unconditional rows; no extra guest";')
        change('let before;', shape_function + '\nlet before;')
        change('inputBaseline = allInputs(inputRoots);', 'inputBaseline = allInputs(inputRoots);\n  independentShapes = independentDirectoryShape([...inputRoots, ...sharedRoots]);\n  put(join(results, "independent-directory-before.json"), independentShapes);')
        change('if (inputBaseline) {', 'if (inputBaseline) {\n      const shapesAfter = independentDirectoryShape([...inputRoots, ...sharedRoots]);\n      put(join(results, "independent-directory-after.json"), shapesAfter);\n      assert.deepEqual(shapesAfter, independentShapes);')
    else:
        change('from "./common.mjs";', f'from {json.dumps(str(directory / "common.mjs"))};')
        change('from "./profile.mjs";', f'from {json.dumps(str(directory / "profile.mjs"))};')
        change('const directory = dirname(fileURLToPath(import.meta.url));', f'const directory = {json.dumps(str(directory))};')
        change('assert.ok(output.startsWith(join(directory, "evidence") + "/"));', f'assert.ok(output.startsWith({json.dumps(str(temporary / "independent-results") + "/")}));')
        change('let temporary;', shape_function + '\nlet temporary;')
        change('const filename = relative(repository, join(directory, entry.path));', f'const filename = `{BASE}/lifecycle/execution-v2/${{entry.path}}`;')
        change('`HEAD:${filename}`', f'`{commit}:${{filename}}`')
        change('`HEAD:${owner}/execution-v2/RUNNER-FREEZE.json`', f'`{commit}:${{owner}}/execution-v2/RUNNER-FREEZE.json`')
        change('return git(repository, "log", "-1", "--format=%H", "--", `${owner}/execution-v2/RUNNER-FREEZE.json`).toString().trim();', f'return "{commit}";')
        change('One revised eleven-row / six-workflow author cohort: eight unchanged controls and three explicitly named revised bindings', 'Independent exact-child eleven-row replay: eight unchanged controls and three approved revised bindings')
        change('mkdtempSync("/tmp/safe-bash-owned-output-lifecycle-execution-v2-")', 'mkdtempSync("/private/tmp/safe-bash-independent-lifecycle-v2-")')
        change('immutable = currentImmutable();', 'immutable = currentImmutable();\n  independentShapes = independentDirectoryShape([...Object.keys(immutable).map(name => join(temporary, name)), ...sharedRoots]);\n  save("independent-directory-before.json", independentShapes);')
        change('if (immutable) { verifyCopies', 'if (immutable) {\n      const shapesAfter = independentDirectoryShape([...Object.keys(immutable).map(name => join(temporary, name)), ...sharedRoots]);\n      save("independent-directory-after.json", shapesAfter); assert.deepEqual(shapesAfter, independentShapes);\n      verifyCopies')
    generated[str(OWN / f'{family}-run.mjs')] = revised
    generated[str(OWN / f'{family}-orchestration.patch-data')] = ''.join(difflib.unified_diff(original.splitlines(True), revised.splitlines(True), fromfile=f'{commit}/run.mjs', tofile=f'independent/{family}-run.mjs'))
    adaptations[family] = {'originalSha256': digest(original.encode()), 'adaptedSha256': digest(revised.encode()), 'replacements': replacements}

record = {'status': 'STATIC_AUTHENTICATED_NOT_EXECUTED', 'reviewerThread': '01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4', 'regularInputRoot': str(temporary), 'bindings': bindings, 'extracted': extracted, 'adaptations': adaptations, 'guestExecutions': 0, 'noPromotion': True}
generated[str(OWN / 'BINDINGS.json')] = json.dumps(record, indent=2) + '\n'
apply_files(generated)
print(json.dumps({'regularInputRoot': str(temporary), 'authenticatedGitBlobs': len(bindings), 'extractedRegularFiles': len(extracted), 'guestExecutions': 0}))
