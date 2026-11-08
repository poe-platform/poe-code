import collections
import json
from pathlib import Path
import re


REPORT = Path(__file__).resolve().parent
STATE = json.loads((REPORT / 'state.json').read_text())
SNAPSHOT = Path(STATE['snapshot'])


def write(name, value):
    (REPORT / name).write_text(json.dumps(value, indent=2) + '\n')


def parse_tap(name):
    lines = (REPORT / f'{name}.stdout.log').read_text(errors='replace').splitlines()
    summary = {}
    for line in lines:
        match = re.fullmatch(r'# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)', line)
        if match:
            summary[match[1]] = float(match[2]) if '.' in match[2] else int(match[2])
    results = []
    diagnostic_indent = None
    for index, line in enumerate(lines):
        if diagnostic_indent is not None:
            if line == ' ' * diagnostic_indent + '...':
                diagnostic_indent = None
            continue
        if line.strip() == '---':
            diagnostic_indent = len(line) - len(line.lstrip())
            continue
        match = re.match(r'^( *)(not ok|ok) (\d+) - (.*)$', line)
        if not match:
            continue
        indent, outcome, number, title = match.groups()
        detail = []
        following = index + 1
        while following < len(lines):
            candidate = lines[following]
            if candidate.strip() and len(candidate) - len(candidate.lstrip()) <= len(indent):
                break
            detail.append(candidate)
            following += 1
        block = '\n'.join(detail)
        fields = {}
        for field in ['type', 'failureType', 'location', 'code', 'error']:
            found = re.search(r'^\s*' + field + r': (.*)$', block, re.M)
            fields[field] = found[1].strip("'\"") if found else None
        status = 'pass' if outcome == 'ok' else 'fail'
        if re.search(r' # SKIP\b', title, re.I):
            status = 'skipped'
        elif re.search(r' # TODO\b', title, re.I):
            status = 'todo'
        elif fields['failureType'] in {'cancelledByParent', 'testTimeoutFailure', 'testAborted'}:
            status = 'cancelled'
        results.append({'id': f'{name}:tap-line-{index + 1}', 'line': index + 1, 'indent': len(indent), 'ordinal': int(number), 'name': title, 'status': status, **fields, **({'detail': block} if status != 'pass' else {})})
    tests = [result for result in results if result['type'] != 'suite']
    counts = dict(collections.Counter(result['status'] for result in tests))
    for status in ['pass', 'fail', 'skipped', 'todo', 'cancelled']:
        counts.setdefault(status, 0)
    expected = {key: summary.get(key) for key in counts}
    assert summary.get('tests') == len(tests), (name, len(tests), summary)
    assert counts == expected, (name, counts, expected)
    write(f'{name}.accounting.json', {'summary': summary, 'parsedCounts': counts, 'uniqueTestObservations': len(tests), 'uniqueIdentity': 'TAP result line identity within one complete unchanged-script invocation; repeated titles remain distinct test instances; suite containers and result-like text inside YAML diagnostics excluded; do not add contracts rerun to full-test totals.', 'suiteContainers': len(results) - len(tests), 'testRecords': [{key: result[key] for key in ['id', 'line', 'name', 'status', 'location']} for result in tests]})
    write(f'{name}.nonpass.json', [result for result in tests if result['status'] != 'pass'])
    return tests, summary


tests, summary = parse_tap('test')
contracts, contracts_summary = parse_tap('contracts')
if (REPORT / 'test-with-rg.result.json').exists():
    tests, summary = parse_tap('test-with-rg')
if (REPORT / 'clean-test.result.json').exists():
    tests, summary = parse_tap('clean-test')
    parse_tap('clean-contracts')
failures = [result for result in tests if result['status'] in {'fail', 'cancelled'}]
groups = collections.defaultdict(list)
for result in failures:
    location = result['location'] or 'NO_LOCATION'
    relative = re.split(r'/source(?:-clean)?/', location)[-1]
    if relative.startswith('tests/'):
        parts = relative.split('/')
        group = '/'.join(parts[:4] if 'diff-patch-stress' in parts else parts[:3])
    else:
        group = relative
    groups[group].append(result)
write('failure-groups.json', {group: {'count': len(records), 'records': [{key: record[key] for key in ['id', 'line', 'name', 'status', 'location']} for record in records]} for group, records in sorted(groups.items())})
write('test-inventory.json', {'fullScript': STATE['scripts']['test'], 'includedTestFiles': sorted(str(path.relative_to(SNAPSHOT)) for path in SNAPSHOT.glob('tests/**/*.test.ts')), 'nonTestPrograms': sorted(str(path.relative_to(SNAPSHOT)) for path in SNAPSHOT.glob('tests/**/*') if path.is_file() and path.suffix in {'.ts', '.mjs'} and not path.name.endswith('.test.ts')), 'conditionalEnvironmentReferences': [{'path': str(path.relative_to(SNAPSHOT)), 'variables': sorted(set(re.findall(r'process\.env\.([A-Z_][A-Z_0-9]*)', path.read_text())))} for path in SNAPSHOT.glob('tests/**/*.ts') if 'process.env.' in path.read_text()]})
print(json.dumps({'test': summary, 'contracts': contracts_summary, 'failureGroups': {group: len(records) for group, records in groups.items()}}, indent=2))
