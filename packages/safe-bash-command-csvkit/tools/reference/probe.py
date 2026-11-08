"""Isolated native reference inspection only; never imported by the product."""
import hashlib
import importlib.metadata
import json
import locale
import os
import platform
import sys
import time


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


distributions = []
for distribution in importlib.metadata.distributions():
    files = []
    for entry in sorted(distribution.files or [], key=str):
        if str(entry).endswith(".pyc"):
            continue
        located = distribution.locate_file(entry)
        if located.is_file():
            files.append({"path": str(entry), "sha256": digest_file(located)})
    encoded = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    distributions.append({
        "name": distribution.metadata["Name"], "version": distribution.version,
        "installedFileManifestSha256": hashlib.sha256(encoded).hexdigest(), "files": files,
    })

locale.setlocale(locale.LC_ALL, "")


def stream_profile(stream):
    buffer = getattr(stream, "buffer", None)
    raw = getattr(buffer, "raw", None)
    return {"isatty": stream.isatty(), "encoding": stream.encoding, "errors": stream.errors,
            "lineBuffering": stream.line_buffering, "writeThrough": stream.write_through,
            "bufferClass": type(buffer).__name__, "rawClass": type(raw).__name__}


print(json.dumps({
    "runtime": {"version": platform.python_version(), "executableSha256": digest_file(os.path.realpath(sys.executable)),
                "implementation": platform.python_implementation(), "platform": platform.platform()},
    "locale": {"all": locale.setlocale(locale.LC_ALL), "preferredEncoding": locale.getpreferredencoding(False), "localeconv": locale.localeconv(), "timezone": time.tzname},
    "stdio": {"stdin": stream_profile(sys.stdin), "stdout": stream_profile(sys.stdout), "stderr": stream_profile(sys.stderr)},
    "distributions": sorted(distributions, key=lambda entry: entry["name"]),
}, sort_keys=True))
