# SPDX-License-Identifier: MPL-2.0
# License: https://www.mozilla.org/MPL/2.0/
# Source distribution: pyodide@314.0.6, python_stdlib.zip.
# Extracted unchanged from Pyodide 314.0.6 pyodide/_package_loader.py.
from __future__ import annotations
import re
from pathlib import Path
from collections.abc import Iterable
from typing import IO
from zipfile import ZipFile
ZIP_TYPES = {".whl", ".zip"}
TAR_TYPES = {".bz", ".bz2", ".tbz2", ".gz", ".tgz", ".tar"}
EXTENSION_TAGS = [".cpython-314-wasm32-emscripten", ".abi3", ""]
PLATFORM_TAG_REGEX = re.compile(r"\.(cpython|pypy|jython)-[0-9]{2,}[a-z]*(-[a-z0-9_-]*)?")
SHAREDLIB_REGEX = re.compile(r"\.so(.\d+)*$")

def should_load_dynlib(path: str | Path) -> bool:
    path = Path(path)

    if not SHAREDLIB_REGEX.search(path.name):
        return False

    suffixes = path.suffixes

    try:
        tag = suffixes[suffixes.index(".so") - 1]
    except ValueError:  # This should not happen, but just in case
        return False

    if tag in EXTENSION_TAGS:
        return True
    # Okay probably it's not compatible now. But it might be an unrelated .so
    # file with a name with an extra dot: `some.name.so` vs
    # `some.cpython-39-x86_64-linux-gnu.so` Let's make a best effort here to
    # check.
    return not PLATFORM_TAG_REGEX.match(tag)

def get_dynlibs(archive: IO[bytes], suffix: str, target_dir: Path) -> list[str]:
    """List out the paths to .so files in a zip or tar archive.

    Parameters
    ----------
    archive
        A binary representation of either a zip or a tar archive. We use the `.name`
        field to determine which file type.

    target_dir
        The directory the archive is unpacked into. Paths will be adjusted to point
        inside this directory.

    Returns
    -------
        The list of paths to dynamic libraries ('.so' files) that were in the archive,
        but adjusted to point to their unpacked locations.
    """
    import tarfile

    dynlib_paths_iter: Iterable[str]
    if suffix in ZIP_TYPES:
        dynlib_paths_iter = ZipFile(archive).namelist()
    elif suffix in TAR_TYPES:
        dynlib_paths_iter = (tinfo.name for tinfo in tarfile.open(archive.name))
    else:
        raise ValueError(f"Unexpected suffix {suffix}")

    return [
        str((target_dir / path).resolve())
        for path in dynlib_paths_iter
        if should_load_dynlib(path)
    ]
