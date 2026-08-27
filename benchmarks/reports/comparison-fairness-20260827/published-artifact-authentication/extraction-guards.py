import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile

root = Path(__file__).resolve().parent
specification = importlib.util.spec_from_file_location('owned_extractor', root / 'extract.py')
extractor = importlib.util.module_from_spec(specification)
specification.loader.exec_module(extractor)
download = json.loads((root / 'download.json').read_text())
scratch = Path(tempfile.mkdtemp(prefix='guard-cases-', dir=download['scratch']))


def entry(name, kind=tarfile.REGTYPE, target='', content=b'guard'):
    member = tarfile.TarInfo(name)
    member.type = kind
    member.linkname = target
    member.size = len(content) if kind == tarfile.REGTYPE else 0
    return member, content


cases = [
    ('positive', [entry('package/file')], True),
    ('traversal', [entry('package/../escape')], False),
    ('absolute', [entry('/escape')], False),
    ('outside-prefix', [entry('other/file')], False),
    ('symlink', [entry('package/link', tarfile.SYMTYPE, '/etc/passwd')], False),
    ('hardlink', [entry('package/link', tarfile.LNKTYPE, 'package/file')], False),
    ('fifo', [entry('package/pipe', tarfile.FIFOTYPE)], False),
    ('device', [entry('package/device', tarfile.CHRTYPE)], False),
    ('duplicate', [entry('package/file'), entry('package/file')], False),
    ('casefold', [entry('package/FILE'), entry('package/file')], False),
    ('casefold-parent', [entry('package/Dir/one'), entry('package/dir/two')], False),
    ('file-ancestor', [entry('package/dir'), entry('package/dir/file')], False),
    ('backslash', [entry('package/..\\escape')], False),
    ('empty-component', [entry('package//file')], False),
    ('control-character', [entry('package/line\nname')], False),
]
results = []
for name, members, expected in cases:
    archive = scratch / f'{name}.tar'
    with tarfile.open(archive, 'w', format=tarfile.PAX_FORMAT) as stream:
        for member, content in members:
            stream.addfile(member, io.BytesIO(content) if member.isfile() else None)
    destination = scratch / name
    failure = None
    try:
        extractor.inspect_and_extract(archive, destination)
        accepted = True
    except (ValueError, tarfile.TarError) as error:
        accepted = False
        failure = str(error)
    if accepted != expected:
        raise AssertionError(f'{name}: expected accepted={expected}, got {accepted}')
    results.append({'id': name, 'expectedAccepted': expected, 'accepted': accepted, 'error': failure})
with (root / 'extraction-guards.json').open('x') as stream:
    json.dump({'scope': 'Owned synthetic archive guards only, no product/native recipe execution', 'scratch': str(scratch), 'pass': len(results), 'total': len(results), 'results': results}, stream, indent=2)
    stream.write('\n')
print(json.dumps({'pass': len(results), 'total': len(results)}))
