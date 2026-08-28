import argparse
import hashlib
import json
from pathlib import Path
import stat
import subprocess


ROOT = Path('/Users/kjopek/Workspace/safe-bash')
OWNED = Path(__file__).resolve().parent
AUTHOR = 'eb468a7e5283525e48a282c40dd98ec7617c4307'
PRIOR = '157eb678f8bcb9ed18fd308a21771aa4d6a032ce'
PACKET = 'tests/comparison/breadth-continuation-20260828'
INDEPENDENT = 'tests/comparison/breadth-continuation-independent-20260828'
checks = []


def digest(data):
    return hashlib.sha256(data).hexdigest()


def frozen(commit, filename):
    if any(part.upper() == 'AGENTS.MD' for part in Path(filename).parts):
        raise ValueError('Instruction content forbidden')
    return subprocess.check_output(['git', 'show', commit + ':' + filename], cwd=ROOT)


def check(identifier, condition, detail=None):
    checks.append({'id': identifier, 'holds': bool(condition), 'detail': detail})


parser = argparse.ArgumentParser(description='Read-only metadata and tool-byte supplement; no specimen execution.')
parser.add_argument('--output', required=True)
arguments = parser.parse_args()
if Path(arguments.output).name != arguments.output or not arguments.output.endswith('.json'):
    parser.error('A fresh direct-child JSON filename is required')
destination = OWNED / arguments.output
if destination.exists():
    parser.error('Refuse evidence overwrite')
manifest_bytes = frozen(AUTHOR, PACKET + '/MANIFEST.json')
check('original-manifest-binding-only', digest(manifest_bytes) == '19526e0eb11478107b73026bdcc5d3b309f4cfb38c57a93c7cfea1672e75e923')
check('current-original-manifest-binding-only', (ROOT / PACKET / 'MANIFEST.json').read_bytes() == manifest_bytes)
expected_top = sorted([entry['path'] for entry in json.loads(manifest_bytes)['files']] + ['MANIFEST.json', 'executor-preparation-v1', 'executor-overlay-v2'])
check('author-root-top-level-new-entries', sorted(entry.name for entry in (ROOT / PACKET).iterdir()) == expected_top, {'expectedCount': len(expected_top)})
seal = json.loads(frozen(AUTHOR, PACKET + '/executor-overlay-v2/SEAL.json'))
tools = []
for tool in seal['tools']:
    location = Path(tool['path'])
    metadata = location.lstat()
    regular = stat.S_ISREG(metadata.st_mode) and location.resolve() == location
    check('tool-regular:' + tool['role'], regular)
    if not regular:
        raise ValueError('Refuse unbound tool alias')
    actual_hash = digest(location.read_bytes())
    check('tool-bytes:' + tool['role'], metadata.st_size == tool['bytes'] and stat.S_IMODE(metadata.st_mode) == tool['mode'] and actual_hash == tool['sha256'])
    tools.append({'role': tool['role'], 'path': str(location), 'sha256': actual_hash, 'executedForReview': tool['role'] == 'git'})
prior_seal = json.loads(frozen(PRIOR, INDEPENDENT + '/SEAL.json'))
prior_top = sorted({entry['path'].split('/')[0] for entry in prior_seal['files']} | {'SEAL.json', 'overlay-v2-review'})
check('prior-root-new-entries-except-exact-owned-directory', sorted(entry.name for entry in (ROOT / INDEPENDENT).iterdir()) == prior_top)
result = {'schema': 'overlay-v2-final-static-authentication-v1', 'author': AUTHOR, 'prior': PRIOR, 'checks': checks, 'counts': {'checks': len(checks), 'holds': sum(item['holds'] for item in checks), 'doesNotHold': sum(not item['holds'] for item in checks)}, 'tools': tools, 'checkerSha256': digest(Path(__file__).read_bytes()), 'qualification': 'Metadata/tool-byte authentication only. Original eleven-file proof is not repeated. Git read-only commands are not native-oracle execution; Node is hashed, not invoked. Membership snapshots are point-in-time, not a filesystem lease.'}
with destination.open('x') as output:
    output.write(json.dumps(result, indent=2) + '\n')
print(json.dumps({'output': arguments.output, 'counts': result['counts']}))
raise SystemExit(1 if result['counts']['doesNotHold'] else 0)
