import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tarfile


def emit(value):
    print(json.dumps(value, sort_keys=True))


def extract(archive, destination, helper):
    specification = importlib.util.spec_from_file_location("primary_guarded_extractor", helper)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    archive_path = destination.parent / (destination.name + ".guarded.tar")
    total = 0
    with gzip.open(archive, "rb") as source, archive_path.open("xb") as target:
        while chunk := source.read(65536):
            total += len(chunk)
            if total > 64 * 1024 * 1024:
                raise ValueError("expanded archive cap")
            target.write(chunk)
    result = module.inspect_and_extract(archive_path, destination)
    result["expandedArchiveBytes"] = total
    result["primaryExtractorReused"] = str(helper)
    emit(result)


def pack(source, archive):
    members = [source / "package.json", source / "README.md"]
    for directory, directories, filenames in os.walk(source / "dist", followlinks=False):
        for name in directories:
            if (Path(directory) / name).is_symlink():
                raise ValueError("package directory link")
        members.extend(Path(directory) / name for name in filenames)
    members.sort(key=lambda member: member.relative_to(source).as_posix())
    if not members or len(members) > 5000:
        raise ValueError("package member cap")
    files = []
    total = 0
    with archive.open("xb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as output:
            for member in members:
                if member.is_symlink() or not member.is_file():
                    raise ValueError("package member not regular")
                contents = member.read_bytes()
                total += len(contents)
                if len(contents) > 32 * 1024 * 1024 or total > 64 * 1024 * 1024:
                    raise ValueError("package payload cap")
                relative = member.relative_to(source).as_posix()
                header = tarfile.TarInfo("package/" + relative)
                header.size = len(contents)
                header.mode = 0o644
                header.mtime = 0
                header.uid = header.gid = 0
                header.uname = header.gname = ""
                output.addfile(header, io.BytesIO(contents))
                files.append({"path": relative, "bytes": len(contents), "sha256": hashlib.sha256(contents).hexdigest(), "archiveMode": 0o644})
    emit({"method": "stdlib deterministic npm-compatible package/ tar.gz; not npm pack/install; no lifecycle hooks", "files": files, "fileCount": len(files), "totalFileBytes": total})


operation = sys.argv[1]
if operation == "extract" and len(sys.argv) == 5:
    extract(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
elif operation == "pack" and len(sys.argv) == 4:
    pack(Path(sys.argv[2]), Path(sys.argv[3]))
else:
    raise ValueError("only exact pack/extract operations are permitted")
