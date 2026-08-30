import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

root = Path(__file__).resolve().parent.parent / 'measurement'
manifest_bytes = (root / 'RAW_MANIFEST.json').read_bytes()
manifest = json.loads(manifest_bytes)
expected = {record['path']: record for record in manifest['files']}
archive = root / 'raw-attempt-001.tar.gz'
before = archive.stat()
compressed = archive.read_bytes()
assert len(compressed) <= 41943040
archive_sha256 = hashlib.sha256(compressed).hexdigest()
declared = json.loads((root / 'ARCHIVE_MANIFEST.json').read_bytes())
assert archive_sha256 == declared['sha256']
assert hashlib.sha256(manifest_bytes).hexdigest() == declared['rawManifestSha256']
assert manifest['files'] == declared['members']
seen = []
total = 0
with tarfile.open(archive, 'r|gz') as stream:
    for member in stream:
        assert member.isfile() and not member.issparse()
        assert not member.name.startswith('/') and '..' not in PurePosixPath(member.name).parts
        assert member.name in expected and member.name not in seen
        record = expected[member.name]
        assert member.size == record['bytes'] and member.size < 256 * 1024 * 1024
        assert member.mode == 0o600 and member.uid == 0 and member.gid == 0 and member.mtime == 0
        data = stream.extractfile(member).read(member.size + 1)
        assert len(data) == member.size and hashlib.sha256(data).hexdigest() == record['sha256']
        seen.append(member.name)
        total += member.size
        assert total <= 512 * 1024 * 1024
assert seen == sorted(expected) and len(seen) == 2071 and total == 432565451
after = archive.stat()
assert (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
print(json.dumps({'status': 'PASS_ALL_ARCHIVE_MEMBERS_EQUAL_REVIEWED_RAW_MANIFEST', 'archive': str(archive), 'archiveSha256': archive_sha256, 'compressedBytes': len(compressed), 'rawManifestSha256': hashlib.sha256(manifest_bytes).hexdigest(), 'regularMembers': len(seen), 'rawMemberBytes': total, 'duplicates': 0, 'extraOrMissing': 0, 'linksOrSpecialFiles': 0, 'extractions': 0, 'productImports': 0, 'nativeOracleCalls': 0}, indent=2))
