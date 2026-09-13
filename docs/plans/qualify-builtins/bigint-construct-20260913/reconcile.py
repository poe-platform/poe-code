"""Reconcile existing corpus data; does not execute QA or infer conformance passes."""
import collections
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
BASE = ROOT / 'docs/plans/complete-conformance-runner/baseline-v4'
CORPUS = Path('/tmp/safejs-regexp-test262-419d3e0')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

manifest = json.loads((BASE / 'manifest.json').read_text())
inventory = json.loads((BASE / 'independent-mismatch-inventory.json').read_text())
files = {row['filename']: row for row in manifest['files']}
observed = {}
receipts = []
for check in inventory['checkedReports']:
    path = BASE / 'batches' / check['report']
    assert sha(path) == check['sha256'], path
    records = [json.loads(line) for line in path.read_text().splitlines()]
    header, summary = records[0], records[-1]
    assert header['type'] == 'header' and summary['complete'] is True
    for key in ['sourceSha', 'sourceHash', 'runtime', 'execution', 'revision']:
        assert header[key] == manifest[key], (path, key)
    assert summary['counts'] == check['counts'], path
    for row in records[1:-1]:
        name = row['filename']
        assert name not in observed, name
        assert row['sourceHash'] == files[name]['sourceHash'], name
        assert {r['mode'] for r in row.get('results', [])} == {v['mode'] for v in files[name]['variants']}, name
        observed[name] = row
    receipts.append({'path': str(path.relative_to(ROOT)), 'sha256': sha(path)})
assert set(observed) == set(files)
counts = collections.Counter(r['status'] for row in observed.values() for r in row.get('results', []))
assert dict(counts) == {k: inventory['counts'][k] for k in ['passed', 'failed', 'unsupported']}
for name, row in files.items():
    assert sha(CORPUS / 'test' / name) == row['sourceHash'], name
for name, digest in manifest['harnessHashes'].items():
    # features.yml lives outside harness in this corpus.
    candidates = [CORPUS / 'harness' / name, CORPUS / name]
    assert any(p.is_file() and sha(p) == digest for p in candidates), name
categories = []
for line in (ROOT / 'docs/plans/safejs-gap-closure-categories.md').read_text().splitlines():
    cells = [c.strip().strip('`') for c in line.split('|')[1:-1]]
    if len(cells) != 5 or not cells[0].startswith('P-'):
        continue
    ident, prefix, expected, scope, owner = cells
    if not (prefix in ['built-ins', 'intl402', 'annexB/built-ins'] or prefix.startswith(('built-ins/', 'intl402/'))):
        continue
    selected = [r for name, r in observed.items() if name == prefix or name.startswith(prefix + '/')]
    statuses = collections.Counter(r['status'] for row in selected for r in row.get('results', []))
    assert len(selected) == int(expected), prefix
    categories.append({'id': ident, 'path': prefix, 'owner': owner, 'files': len(selected),
                       'variants': sum(statuses.values()), **dict(statuses),
                       'target': scope, 'currentDisposition': 'QB-REVISION: historical results; current category closure not established'})

result = {'historicalReportsVerified': len(receipts), 'fixtureHashesVerified':len(observed), 'counts':dict(counts), 'categories':categories, 'historicalSource': {k:manifest[k] for k in ['sourceSha','sourceHash','revision','runtime','execution']}}
(OUT / 'reconciliation.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({'categories':len(categories), 'files':len(observed), 'counts':dict(counts)}))
