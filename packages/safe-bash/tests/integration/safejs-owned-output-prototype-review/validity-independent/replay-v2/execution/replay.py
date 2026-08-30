import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

sys.dont_write_bytecode = True
from assess import LIFECYCLE, SURFACE, lifecycle_check, surface_check

HERE = Path(__file__).resolve().parent
REPO = Path('/Users/kjopek/Workspace/safe-bash')
NODE = Path('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node')
NODE_SHA = '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'
BINDINGS = json.loads((HERE / 'BINDINGS.json').read_text())
ROOT = Path(BINDINGS['regularInputRoot'])
ENV = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPO), '-c', 'core.fsmonitor=false', *args], env=ENV)


def save(filename, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with filename.open('xb') as stream:
        stream.write(data)


def require_hash(data, expected):
    assert sha(data) == expected, 'Refused bytes before runtime admission'


def authenticated_inputs():
    freeze = json.loads((HERE / 'FREEZE.json').read_text())
    freeze_path = str((HERE / 'FREEZE.json').relative_to(REPO))
    freeze_commit = git('log', '-1', '--format=%H', '--', freeze_path).decode().strip()
    assert freeze_commit and git('show', f'{freeze_commit}:{freeze_path}') == (HERE / 'FREEZE.json').read_bytes()
    for entry in freeze['files']:
        data = (HERE / entry['path']).read_bytes()
        require_hash(data, entry['sha256'])
        assert git('show', f'{freeze_commit}:{HERE.relative_to(REPO)}/{entry["path"]}') == data
    for entry in BINDINGS['bindings']:
        require_hash(git('show', f'{entry["commit"]}:{entry["path"]}'), entry['sha256'])
    expected = {entry['path']: entry for entry in BINDINGS['extracted']}
    observed = {}
    directory_names = []
    for family in ['surface', 'lifecycle']:
        for filename in sorted((ROOT / family).rglob('*')):
            assert not filename.is_symlink() and filename.resolve() == filename
            relative = str(filename.relative_to(ROOT))
            if filename.is_dir():
                directory_names.append(relative)
            else:
                assert filename.is_file()
                observed[relative] = sha(filename.read_bytes())
    assert set(observed) == set(expected)
    for filename, digest in observed.items():
        assert digest == expected[filename]['sha256']
    assert NODE.resolve() == NODE and NODE.is_file()
    require_hash(NODE.read_bytes(), NODE_SHA)
    return {'freezeCommit': freeze_commit, 'extractedFiles': len(observed), 'directories': directory_names, 'nodeSha256': NODE_SHA, 'bindings': len(BINDINGS['bindings'])}


def read_json(filename):
    return json.loads(filename.read_text())


def closure_check(family, raw):
    before = read_json(raw / 'private-before.json')
    after = read_json(raw / 'private-after.json')
    before.pop('at', None)
    after.pop('at', None)
    assert before == after, 'Fresh private before/after mismatch'
    assert len(before['engine']) == 264 and len(before['metadata']) == 6
    assert before['head'] == 'bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e'
    assert before['tree'] == 'ebcb4508690856b288a40e60e7682331d6fad8ff'
    assert read_json(raw / 'independent-directory-before.json') == read_json(raw / 'independent-directory-after.json')
    if family == 'surface':
        journal = read_json(raw / 'journal.json')
        assert journal['status'] == 'EXECUTION_SETTLED' and not journal['failures']
        assert journal['privateUnchanged'] and journal['inputTreesUnchanged'] and journal['sharedTreesUnchanged']
        assert not journal['parentAfter']['knownLiveChildren']
        assert not journal.get('finding')
        assert read_json(raw / 'inputs-before.json') == read_json(raw / 'inputs-after.json')
        children = journal['children']
        assert len(children) == 8
        for child in children:
            assert child['code'] == 0 and child['signal'] is None and not child['timedOut'] and not child['outputExceeded']
            assert not child.get('spawnError')
    else:
        journal = read_json(raw / 'report.json')
        assert journal['status'] == 'PASS' and journal['privateUnchanged'] and journal['sharedUnchanged']
        assert journal['cleanup']['knownCaseChildrenClosed'] and journal['cleanup']['removed']
        assert not journal.get('finalContainment')
        assert read_json(raw / 'immutable-before.json') == read_json(raw / 'immutable-after.json')
        assert read_json(raw / 'shared-before.json') == read_json(raw / 'shared-after.json')
        children = journal['children']
        assert len(children) == 11
        for child in children:
            assert child['code'] == 0 and child['signal'] is None and child['containment'] is None
    return {'privateHead': before['head'], 'privateTree': before['tree'], 'engineFiles': len(before['engine']), 'metadataFiles': len(before['metadata']), 'freshPrivateUnchanged': True, 'directoryNamesReenumerated': True, 'knownChildrenNaturallyClosed': len(children), 'remainingKnownChildren': 0}


def imports_check(family, raw):
    if family == 'surface':
        allowlist = read_json(raw / 'import-allowlist.json')
        paths = sorted(raw.glob('*/imports.ndjson'))
    else:
        report = read_json(raw / 'report.json')
        temporary = Path(report['temporary'])
        inventories = read_json(raw / 'immutable-before.json')
        allowlist = {f'{root}/{entry["path"]}': entry['sha256'] for root, entries in inventories.items() for entry in entries}
        paths = sorted(raw.glob('*.imports.ndjson'))
    counts = []
    for filename in paths:
        entries = [json.loads(line) for line in filename.read_text().splitlines() if line]
        for entry in entries:
            assert entry['path'] in allowlist and entry['sha256'] == allowlist[entry['path']], entry
        counts.append({'capture': filename.name if family == 'lifecycle' else filename.parent.name, 'records': len(entries), 'engineFiles': len({entry['path'] for entry in entries if entry['path'].startswith('engine/')})})
    assert len(counts) == (8 if family == 'surface' else 11)
    return counts


def main(family):
    assert family in ['surface', 'lifecycle']
    output = ROOT / 'independent-results' / family
    output.mkdir(parents=True, exist_ok=False)
    record = {'family': family, 'started': datetime.now(timezone.utc).isoformat(), 'attempt': 1, 'automaticRetries': 0, 'reviewerThread': '01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4', 'noPromotion': True}
    raw = None
    try:
        before = authenticated_inputs()
        record['authenticationBefore'] = before
        save(output / 'authentication-before.json', before)
        if family == 'surface':
            controls = subprocess.run([str(NODE), str(ROOT / 'surface/execution-v2/controls.mjs')], cwd=REPO, env=ENV, capture_output=True, timeout=5)
            save(output / 'controls.stdout.json', controls.stdout)
            save(output / 'controls.stderr.txt', controls.stderr)
            assert controls.returncode == 0 and not controls.stderr
            control_data = json.loads(controls.stdout)
            assert len(control_data['results']) == 9
            assert all(entry['pass'] and entry['calls'] == 1 and entry['finalizers'] == 1 and entry['sameReferenceOrPrimitive'] and entry['getterReads'] == 0 for entry in control_data['results'])
            record['finiteHostControls'] = {'executed': 9, 'pass': 9, 'enginePasses': 0}
            negative = subprocess.run([sys.executable, '-B', str(HERE / 'assess.py'), 'negatives'], cwd=REPO, env=ENV, capture_output=True, timeout=10)
            save(output / 'data-negative-checks.json', negative.stdout)
            save(output / 'data-negative-checks.stderr.txt', negative.stderr)
            assert negative.returncode == 0
            child_bytes = (ROOT / 'surface/execution-v2/child.mjs').read_bytes()
            refused = False
            try:
                require_hash(child_bytes + b'\x00', sha(child_bytes))
            except AssertionError:
                refused = True
            assert refused
            save(output / 'tamper-refusal.json', {'inMemoryByteMismatchRefused': refused, 'fixtureWrites': 0, 'runtimeImports': 0})
        args = [str(NODE), str(HERE / f'{family}-run.mjs')]
        if family == 'lifecycle':
            args.append(str(output / 'raw'))
        record['command'] = args
        record['parentStarted'] = datetime.now(timezone.utc).isoformat()
        parent = subprocess.Popen(args, cwd=REPO, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        record['parentPid'] = parent.pid
        stdout, stderr = parent.communicate()
        record['parentExit'] = parent.returncode
        record['parentClosed'] = datetime.now(timezone.utc).isoformat()
        save(output / 'parent.stdout.txt', stdout)
        save(output / 'parent.stderr.txt', stderr)
        if family == 'surface':
            terminal = json.loads(stdout.decode().splitlines()[-1])
            raw = Path(terminal['task']) / 'results'
        else:
            raw = output / 'raw'
        record['rawDirectory'] = str(raw)
        record['authenticationAfter'] = authenticated_inputs()
        assert before == record['authenticationAfter']
        record['closure'] = closure_check(family, raw)
        record['imports'] = imports_check(family, raw)
        assert parent.returncode == 0
        rows = []
        selected_rows = [row for row in SURFACE['cases'] if not row.get('conditional')] if family == 'surface' else LIFECYCLE['rows']
        for selected in selected_rows:
            filename = raw / selected['id'] / 'actual.json' if family == 'surface' else raw / (selected['id'] + '.json')
            detail = read_json(filename)
            if family == 'surface':
                surface_check(detail, selected)
            else:
                if selected.get('requiresPositive'):
                    assert any(row['id'] == selected['requiresPositive'] and row['independentRawChecks'] == 'PASS' for row in rows)
                lifecycle_check(detail, selected)
            rows.append({'id': selected['id'], 'variantId': detail.get('variantId', selected['id']), 'independentRawChecks': 'PASS', 'sha256': sha(filename.read_bytes())})
        record['rows'] = rows
        record['status'] = 'INDEPENDENT_BOUNDED_PROFILE_PASS'
    except Exception as failure:
        record['status'] = 'INDEPENDENT_NONPASS'
        record['failure'] = {'type': type(failure).__name__, 'message': str(failure)}
        if raw:
            record['rawDirectory'] = str(raw)
        raise
    finally:
        record['finished'] = datetime.now(timezone.utc).isoformat()
        record['nodeAfterSha256'] = sha(NODE.read_bytes())
        save(output / 'independent-assessment.json', record)
        print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main(sys.argv[1])
