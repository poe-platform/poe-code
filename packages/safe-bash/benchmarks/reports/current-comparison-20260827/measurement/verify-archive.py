import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile


OWNED = Path(__file__).resolve().parent
MANIFEST_SHA256 = "5c15aa518743449029f975b3e133544ede2f9ff6df9ed734bb8f9a1d575f9ba1"
ARCHIVE = OWNED / "raw-attempt-001.tar.gz"
manifest_bytes = (OWNED / "RAW_MANIFEST.json").read_bytes()
assert hashlib.sha256(manifest_bytes).hexdigest() == MANIFEST_SHA256
records = sorted(json.loads(manifest_bytes)["files"], key=lambda record: record["path"])
assert len(records) == 2071 and len({record["path"] for record in records}) == 2071
for record in records:
    assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", record["path"])
    assert re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
    assert isinstance(record["bytes"], int) and 0 <= record["bytes"] <= 16 * 1024 * 1024
assert stat.S_ISREG(ARCHIVE.lstat().st_mode)
archive_bytes = ARCHIVE.stat().st_size
assert archive_bytes <= 40 * 1024 * 1024, "OVERSIZE: stop; bounded split proposal required"
with ARCHIVE.open("rb") as source:
    archive_sha256 = hashlib.file_digest(source, "sha256").hexdigest()
    source.seek(0)
    assert source.read(10) == bytes.fromhex("1f8b08000000000002ff"), "noncanonical gzip header"
temporary = Path(tempfile.mkdtemp(prefix="safe-bash-measurement-archive-verify-", dir="/private/tmp"))
directory_descriptor = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
with (OWNED / "ARCHIVE_VERIFY_INTENT_02.json").open("x") as destination:
    json.dump({"archive": str(ARCHIVE), "sha256": archive_sha256, "extractionRoot": str(temporary), "pid": os.getpid(), "productImports": 0}, destination, indent=2)
    destination.write("\n")
member_hashes = []
tar_digest = hashlib.sha256()
tar_bytes = 0


def read_exact(stream, size):
    global tar_bytes
    data = stream.read(size)
    assert len(data) == size, "truncated tar stream"
    tar_digest.update(data)
    tar_bytes += len(data)
    return data


def expected_header(record):
    header = bytearray(512)
    name = record["path"].encode("ascii")
    header[:len(name)] = name
    header[100:108] = b"0000600\0"
    header[108:116] = header[116:124] = b"0000000\0"
    header[124:136] = (f'{record["bytes"]:011o}\0').encode("ascii")
    header[136:148] = b"00000000000\0"
    header[148:156] = b"        "
    header[156:157] = b"0"
    header[257:265] = b"ustar\00000"
    checksum = sum(header)
    header[148:156] = (f"{checksum:06o}\0 ").encode("ascii")
    return bytes(header)


try:
    with gzip.open(ARCHIVE, "rb") as stream:
        for record in records:
            header = read_exact(stream, 512)
            assert header == expected_header(record), f'noncanonical/nonregular/unexpected member: {record["path"]}'
            descriptor = os.open(record["path"], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_descriptor)
            digest = hashlib.sha256()
            remaining = record["bytes"]
            with os.fdopen(descriptor, "wb") as destination:
                while remaining:
                    data = read_exact(stream, min(remaining, 65536))
                    digest.update(data)
                    destination.write(data)
                    remaining -= len(data)
            assert digest.hexdigest() == record["sha256"], record["path"]
            padding = (-record["bytes"]) % 512
            assert read_exact(stream, padding) == bytes(padding)
            member_hashes.append({"path": record["path"], "bytes": record["bytes"], "archiveMemberSha256": digest.hexdigest(), "expectedSha256": record["sha256"]})
        trailer_bytes = 1024 + (-(tar_bytes + 1024) % 10240)
        assert read_exact(stream, trailer_bytes) == bytes(trailer_bytes)
        assert stream.read(1) == b"", "extra decompressed member/data"
    assert set(os.listdir(temporary)) == {record["path"] for record in records}
    for record in member_hashes:
        descriptor = os.open(record["path"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_descriptor)
        with os.fdopen(descriptor, "rb") as source:
            metadata = os.fstat(source.fileno())
            assert stat.S_ISREG(metadata.st_mode) and metadata.st_size == record["bytes"]
            actual = hashlib.file_digest(source, "sha256").hexdigest()
            assert actual == record["expectedSha256"], record["path"]
            record["extractedFileSha256"] = actual
finally:
    os.close(directory_descriptor)
with ARCHIVE.open("rb") as source:
    assert hashlib.file_digest(source, "sha256").hexdigest() == archive_sha256
assert (OWNED / "RAW_MANIFEST.json").read_bytes() == manifest_bytes
result = {
    "status": "VERIFIED_AGAINST_IMMUTABLE_RAW_MANIFEST",
    "archive": ARCHIVE.name,
    "compressedBytes": archive_bytes,
    "sha256": archive_sha256,
    "rawManifestSha256": MANIFEST_SHA256,
    "memberCount": len(member_hashes),
    "rawMemberBytes": sum(record["bytes"] for record in records),
    "tarBytes": tar_bytes,
    "tarSha256": tar_digest.hexdigest(),
    "extractionRoot": str(temporary),
    "verification": "Independent gzip/manual USTAR parser, without packer or tarfile imports; exact canonical regular-file headers/order/padding/end; every member compared to RAW_MANIFEST.json while extracting and again from extracted regular files. Does not read original raw files or ARCHIVE_MANIFEST.json.",
    "allArchiveMembersMatch": True,
    "allExtractedFilesMatch": True,
    "extraMembers": 0,
    "symlinksOrTraversal": 0,
    "members": member_hashes,
    "productImports": 0,
    "childrenSpawned": 0,
}
with (OWNED / "ARCHIVE_VERIFICATION.json").open("x") as destination:
    json.dump(result, destination, indent=2)
    destination.write("\n")
print(json.dumps({key: value for key, value in result.items() if key != "members"}, indent=2))
