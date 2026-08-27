import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile
import zlib


OWNED = Path(__file__).resolve().parent
MANIFEST_SHA256 = "5c15aa518743449029f975b3e133544ede2f9ff6df9ed734bb8f9a1d575f9ba1"
ARCHIVE = OWNED / "raw-attempt-001.tar.gz"
LIMIT_BYTES = 40 * 1024 * 1024


def fingerprint(metadata):
    return (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)


class CheckedReader:
    def __init__(self, stream):
        self.stream = stream
        self.digest = hashlib.sha256()
        self.bytes = 0

    def read(self, size):
        chunk = self.stream.read(size)
        self.digest.update(chunk)
        self.bytes += len(chunk)
        return chunk


manifest_bytes = (OWNED / "RAW_MANIFEST.json").read_bytes()
assert hashlib.sha256(manifest_bytes).hexdigest() == MANIFEST_SHA256
manifest = json.loads(manifest_bytes)
records = sorted(manifest["files"], key=lambda record: record["path"])
assert len(records) == 2071
assert len({record["path"] for record in records}) == 2071
for record in records:
    assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", record["path"])
    assert re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
    assert isinstance(record["bytes"], int) and 0 <= record["bytes"] <= 16 * 1024 * 1024
root = Path(manifest["root"])
assert root.is_absolute() and root.resolve() == root
assert set(os.listdir(root)) == {record["path"] for record in records}
root_descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
verified = []
try:
    with ARCHIVE.open("xb") as destination:
        with gzip.GzipFile(filename="", mode="wb", compresslevel=9, fileobj=destination, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
                for record in records:
                    descriptor = os.open(record["path"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root_descriptor)
                    with os.fdopen(descriptor, "rb") as source:
                        before = os.fstat(source.fileno())
                        assert stat.S_ISREG(before.st_mode) and before.st_size == record["bytes"]
                        reader = CheckedReader(source)
                        member = tarfile.TarInfo(record["path"])
                        member.size = record["bytes"]
                        member.mode = 0o600
                        member.uid = member.gid = member.mtime = 0
                        member.uname = member.gname = ""
                        member.type = tarfile.REGTYPE
                        archive.addfile(member, reader)
                        assert reader.bytes == record["bytes"]
                        assert reader.digest.hexdigest() == record["sha256"], record["path"]
                        assert source.read(1) == b""
                        after = os.fstat(source.fileno())
                        named = os.stat(record["path"], dir_fd=root_descriptor, follow_symlinks=False)
                        assert stat.S_ISREG(named.st_mode)
                        assert fingerprint(before) == fingerprint(after) == fingerprint(named)
                        verified.append(dict(record))
        destination.flush()
        os.fsync(destination.fileno())
finally:
    os.close(root_descriptor)
assert (OWNED / "RAW_MANIFEST.json").read_bytes() == manifest_bytes
assert set(os.listdir(root)) == {record["path"] for record in records}
with ARCHIVE.open("rb") as source:
    archive_sha256 = hashlib.file_digest(source, "sha256").hexdigest()
archive_bytes = ARCHIVE.stat().st_size
result = {
    "status": "CREATED_PENDING_INDEPENDENT_EXTRACTION" if archive_bytes <= LIMIT_BYTES else "OVERSIZE_STOP_NO_COMMIT",
    "archive": ARCHIVE.name,
    "compressedBytes": archive_bytes,
    "sha256": archive_sha256,
    "maximumCompressedBytes": LIMIT_BYTES,
    "withinSizeLimit": archive_bytes <= LIMIT_BYTES,
    "rawManifest": "RAW_MANIFEST.json",
    "rawManifestSha256": MANIFEST_SHA256,
    "memberCount": len(verified),
    "rawMemberBytes": sum(record["bytes"] for record in verified),
    "members": verified,
    "format": {"container": "USTAR", "order": "ASCII path ascending", "regularFilesOnly": True, "mode": "0600", "uid": 0, "gid": 0, "uname": "", "gname": "", "mtime": 0, "gzipFilename": "", "gzipMtime": 0, "gzipLevel": 9},
    "implementation": {"python": sys.version, "zlib": zlib.ZLIB_VERSION, "zlibRuntime": zlib.ZLIB_RUNTIME_VERSION},
    "productImports": 0,
    "rawInputsModified": False,
}
with (OWNED / "ARCHIVE_MANIFEST.json").open("x") as destination:
    json.dump(result, destination, indent=2)
    destination.write("\n")
print(json.dumps({key: value for key, value in result.items() if key != "members"}, indent=2))
if archive_bytes > LIMIT_BYTES:
    sys.exit(2)
