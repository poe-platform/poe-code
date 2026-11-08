import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import sys
import tarfile

archive_path, destination_name = sys.argv[1:]
destination = Path(destination_name)
assert destination.is_absolute() and not destination.exists()
assert str(destination).startswith('/private/tmp/safe-bash-owned-output-receipt-review-')
destination.mkdir()
assert destination.resolve() == destination
records = []
metadata_records = []
seen = set()
with tarfile.open(archive_path, 'r:gz') as archive:
    members = archive.getmembers()
    assert len(members) <= 5000
    assert sum(member.size for member in members) <= 100 * 1024 * 1024
    for member in members:
        name = member.name
        parts = PurePosixPath(name).parts
        assert name and not name.startswith('/') and '..' not in parts and '\\' not in name
        assert member.isfile() or member.isdir(), (name, member.type)
        normalized = '/'.join(parts)
        assert normalized not in seen, normalized
        seen.add(normalized)
    for member in members:
        target = destination.joinpath(*PurePosixPath(member.name).parts)
        assert target == destination or destination in target.parents
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        assert target.parent.resolve() == target.parent
        with archive.extractfile(member) as source:
            content = source.read(member.size + 1)
        assert len(content) == member.size
        if target.name.startswith('._'):
            assert hashlib.sha256(Path(archive_path).read_bytes()).hexdigest() == '0066bc48069f116b549ea895e4972c02ed6958be641fd23ea3b6db26cc181f05'
            assert len(content) == 163
            assert hashlib.sha256(content).hexdigest() == '5934932f7beff3c908b0c8b6af6ea8a142bb02b0c16dc2d411fbde870a31e988'
            assert struct.unpack('>II16sH', content[:26]) == (0x00051607, 0x00020000, b'Mac OS X        ', 2)
            counterpart = target.with_name(target.name[2:]).relative_to(destination).as_posix()
            assert counterpart in seen
            original_name = target.relative_to(destination).as_posix()
            target = Path(str(destination) + '-archive-metadata') / original_name
            target.parent.mkdir(parents=True, exist_ok=True)
            assert target.parent.resolve() == target.parent
            metadata_records.append({'path': original_name, 'counterpart': counterpart, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(), 'classification': 'exact pinned AppleDouble com.apple.provenance archive metadata; not compiler input'})
        with target.open('xb') as output:
            output.write(content)
        if destination in target.parents:
            records.append({'path': target.relative_to(destination).as_posix(), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
print(json.dumps({'files': sorted(records, key=lambda item: item['path']), 'archiveMetadata': metadata_records, 'rawRegularEntries': sum(member.isfile() for member in members), 'directoryEntries': sum(member.isdir() for member in members), 'links': 0, 'specialEntries': 0, 'destination': str(destination)}))
