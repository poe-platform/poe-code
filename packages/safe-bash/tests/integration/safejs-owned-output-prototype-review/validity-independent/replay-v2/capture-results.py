import hashlib
import json
from pathlib import Path
import subprocess

REPOSITORY = Path('/Users/kjopek/Workspace/safe-bash')
OWNED = REPOSITORY / 'tests/integration/safejs-owned-output-prototype-review/validity-independent/replay-v2'
INPUT_ROOT = Path('/private/tmp/safe-bash-independent-v2-inputs-5dho_5db')
SURFACE_RAW = Path('/private/tmp/safe-bash-independent-surface-v2-1PVw9l/results')
DESTINATION = OWNED / 'attempt-01'
assert not DESTINATION.exists()


def sha(data):
    return hashlib.sha256(data).hexdigest()


captures = []
for source, target in [(SURFACE_RAW, 'surface/raw'), (INPUT_ROOT / 'independent-results/surface', 'surface/orchestration'), (INPUT_ROOT / 'independent-results/lifecycle', 'lifecycle')]:
    assert source.resolve() == source
    for filename in sorted(source.rglob('*')):
        assert not filename.is_symlink()
        if filename.is_dir():
            continue
        assert filename.is_file()
        data = filename.read_bytes()
        text = data.decode('utf-8')
        assert not data or data.endswith(b'\n'), filename
        assert '\r' not in text, filename
        destination = DESTINATION / target / filename.relative_to(source)
        patch = '*** Begin Patch\n*** Add File: ' + str(destination) + '\n'
        patch += ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
        subprocess.run(['apply_patch'], input=patch.encode(), check=True, stdout=subprocess.DEVNULL, cwd=REPOSITORY)
        assert destination.read_bytes() == data
        captures.append({'source': str(filename), 'path': str(destination.relative_to(OWNED)), 'bytes': len(data), 'sha256': sha(data)})

manifest = {'status': 'EXACT_OWN_REPLAY_CAPTURE_NOT_AUTHOR_RAW_REUSE', 'freezeCommit': 'c53e63f3bfe26e0f9982f17c391e11255512201d', 'files': captures, 'totalFiles': len(captures), 'totalBytes': sum(entry['bytes'] for entry in captures), 'copyMethod': 'apply_patch with exact post-copy byte comparison', 'privateSourceBytesIncluded': False, 'noPromotion': True}
filename = DESTINATION / 'CAPTURE-MANIFEST.json'
text = json.dumps(manifest, indent=2) + '\n'
patch = '*** Begin Patch\n*** Add File: ' + str(filename) + '\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
subprocess.run(['apply_patch'], input=patch.encode(), check=True, cwd=REPOSITORY)
print(json.dumps({key: manifest[key] for key in ['status', 'totalFiles', 'totalBytes', 'privateSourceBytesIncluded']}))
