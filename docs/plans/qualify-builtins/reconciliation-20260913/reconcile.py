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
nonpasses = []
for row in inventory['mismatches']:
    if row['filename'].startswith(('built-ins/', 'intl402/', 'annexB/built-ins/')):
        nonpasses.append({'id': row['id'], 'owner': row['primaryTask'], 'category': row['category'],
                          'reason': row['reason'], 'detail': row.get('detail'), 'esid': row.get('esid'),
                          'report': row['report'], 'sourceHash': row['sourceHash'],
                          'control': row['neighboringPassingControl'],
                          'disposition': 'QB-REVALIDATE: historical nonpass; not a validated current product defect',
                          'targetDisposition': row['targetDisposition']})
current = json.loads((OUT / 'source-before.json').read_text())
previous_path = ROOT / 'docs/plans/qualify-regexp-semantics-and-cost/current-source-20260913/source-before.json'
previous = json.loads(previous_path.read_text())
changed = [name for name, digest in previous['source'].items() if (ROOT / name).is_file() and sha(ROOT / name) != digest]
missing = [name for name in previous['source'] if not (ROOT / name).is_file()]
assert not changed and not missing, (changed, missing)
regex_report = previous_path.parent / 'corpus.jsonl'
regex = [json.loads(line) for line in regex_report.read_text().splitlines()]
assert regex[0]['sourceSha'] == current['head']
current_header = json.loads((OUT / 'current-corpus.jsonl').read_text().splitlines()[0])
for key in ['sourceSha', 'sourceHash', 'runtime', 'execution', 'revision']:
    assert regex[0][key] == current_header[key], key
for row in regex[1:-1]:
    assert sha(CORPUS / 'test' / row['filename']) == row['sourceHash']
report = {'historicalSource': {k: manifest[k] for k in ['sourceSha', 'sourceHash', 'revision', 'runtime', 'execution']},
          'verifiedReportCount': len(receipts), 'verifiedFileCount': len(observed), 'historicalCounts': counts,
          'categories': categories, 'nonpassCount': len(nonpasses),
          'regexReuse': {'sourceInventorySha256': sha(previous_path), 'matchedSourceFiles': len(previous['source']),
                        'reportSha256': sha(regex_report), 'counts': regex[-1]['counts'],
                        'scope': 'same recorded source files and Node/ICU; no full-suite rerun; unrecorded dependencies not certified'},
          'batchReceipts': receipts}
(OUT / 'category-results.json').write_text(json.dumps(report, indent=2) + '\n')
with (OUT / 'unresolved-variants.json.gz').open('wb') as output:
    with gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=0) as archive:
        archive.write((json.dumps(nonpasses, indent=2) + '\n').encode())
lines = ['# Built-in category evidence reconciliation', '', 'Historical corpus results, not current-source all-pass certification. Parent rows overlap children; do not sum the table.', '',
         '| Ledger ID | Category | Owner | Files | Pass | Fail | Unsupported |', '| --- | --- | --- | ---: | ---: | ---: | ---: |']
for row in categories:
    lines.append(f"| {row['id']} | {row['path']} | {row['owner']} | {row['files']} | {row.get('passed',0)} | {row.get('failed',0)} | {row.get('unsupported',0)} |")
(OUT / 'category-results.md').write_text('\n'.join(lines) + '\n')
print(json.dumps({'categories': len(categories), 'nonpasses': len(nonpasses), 'counts': counts, 'regexReuse': report['regexReuse']}))
