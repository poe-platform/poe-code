import datetime
import hashlib
import json
import pathlib
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
START = time.monotonic_ns()
seal = json.loads((ROOT/'PRESEAL.json').read_text())
tools = json.loads((ROOT/'TOOLS.json').read_text())

def sha(data): return hashlib.sha256(data).hexdigest()

def census(root):
    rows = []
    for path in sorted(pathlib.Path(root).rglob('*')):
        if path.is_symlink():
            rows.append({'path': str(path), 'link': str(path.readlink()), 'realpath': str(path.resolve())})
        elif path.is_dir(): rows.append({'path': str(path), 'directory': True, 'bytes': 0})
        else: rows.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())})
    return rows

def canonical(rows): return json.dumps(sorted(rows, key=lambda row: row['path']), sort_keys=True, separators=(',', ':')).encode()

def compare(expected, actual):
    old = {row['path']: row for row in expected}
    new = {row['path']: row for row in actual}
    return {'entries': len(actual), 'files': sum('sha256' in row for row in actual),
            'directories': sum(row.get('directory', False) for row in actual),
            'links': sum('link' in row for row in actual), 'bytes': sum(row.get('bytes', 0) for row in actual),
            'duplicates': len(old) != len(expected) or len(new) != len(actual),
            'added': sorted(new.keys() - old.keys()), 'removed': sorted(old.keys() - new.keys()),
            'changed': sorted(path for path in new.keys() & old.keys() if new[path] != old[path]),
            'samePathValues': old == new, 'samePathlibSequence': expected == actual,
            'sameJsFullPathSequence': expected == sorted(actual, key=lambda row: row['path']),
            'canonicalBeforeSha256': sha(canonical(expected)), 'canonicalAfterSha256': sha(canonical(actual))}

result = {'role': 'POST_STOP_DATA_ONLY_NO_EXECUTION_RETRY', 'startedWall': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'presealCommit': '8f7e5977873de258f13a2978587f096b8adebaa9', 'trees': [], 'tools': [],
          'runDirectoryExists': (ROOT/'RUN-01').exists(), 'presealSha256': sha((ROOT/'PRESEAL.json').read_bytes()),
          'nodeSha256': sha(pathlib.Path(seal['node']['path']).read_bytes()), 'sealedFiles': []}
for row in seal['files']:
    actual = sha((ROOT/row['path']).read_bytes())
    result['sealedFiles'].append({'path': row['path'], 'expected': row['sha256'], 'actual': actual, 'unchanged': row['sha256'] == actual})
for tree in seal['oldTrees']:
    result['trees'].append({'root': tree['root'], **compare(tree['rows'], census(tree['root']))})
for tool in tools:
    result['tools'].append({'root': tool['root'], 'name': tool['name'], **compare(tool['rows'], census(tool['root']))})
result['sourceInputHashMatchesOriginal'] = sha((ROOT/'INPUTS.json').read_bytes()) == sha((ROOT.parent/'m1a-review-v5/INPUTS.json').read_bytes())
result['fixtureHashMatchesOriginal'] = sha((ROOT/'fixtures.mjs').read_bytes()) == sha((ROOT.parent/'m1a-review-v5/fixtures.mjs').read_bytes())
result['elapsedMs'] = (time.monotonic_ns() - START) / 1e6
text = json.dumps(result, indent=2) + '\n'
path = 'tests/commands/git-independent-20260828/m1a-continuation-v11/POST-STOP-DATA.json'
patch = '*** Begin Patch\n*** Add File: ' + path + '\n' + ''.join('+'+line+'\n' for line in text.splitlines()) + '*** End Patch\n'
subprocess.run(['apply_patch'], input=patch, text=True, check=True, cwd=ROOT.parents[3])
print(json.dumps({'trees': [(row['root'].split('/')[-1], row['samePathValues']) for row in result['trees']],
                  'tools': [(row['name'], row['samePathValues'], row['sameJsFullPathSequence']) for row in result['tools']],
                  'sealedFilesUnchanged': all(row['unchanged'] for row in result['sealedFiles']),
                  'sourceInputHashMatchesOriginal': result['sourceInputHashMatchesOriginal'], 'runDirectoryExists': result['runDirectoryExists']}))
