# Unmodified helper bodies from Pyodide 314.0.6 and micropip 0.11.1.

def find_wheel_metadata_dir(source: ZipFile, suffix: str) -> str | None:
    """
    Returns the name of the contained metadata directory inside the wheel file.

    Parameters
    ----------
    source
        A ZipFile object representing the wheel file.

    suffix
        The suffix of the metadata directory. Usually ".dist-info" or ".data"

    Returns
    -------
        The name of the metadata directory. If not found, returns None.
    """

    # Zip file path separators must be /
    subdirs = {p.split("/", 1)[0] for p in source.namelist()}

    info_dirs = [s for s in subdirs if s.endswith(suffix)]

    if not info_dirs:
        return None

    # Choose the first directory if there are multiple directories
    info_dir = info_dirs[0]
    return info_dir

def wheel_dist_info_dir(source: zipfile.ZipFile, name: str) -> str:
    """Returns the name of the contained .dist-info directory.
    Raises UnsupportedWheel if not found, >1 found, or it doesn't match the
    provided name.
    """
    # Zip file path separators must be /
    subdirs = {p.split("/", 1)[0] for p in source.namelist()}

    info_dirs = [s for s in subdirs if s.endswith(".dist-info")]

    if not info_dirs:
        raise UnsupportedWheel(f".dist-info directory not found in wheel {name!r}")

    if len(info_dirs) > 1:
        raise UnsupportedWheel(
            "multiple .dist-info directories found in wheel {!r}: {}".format(
                name, ", ".join(info_dirs)
            )
        )

    info_dir = info_dirs[0]

    info_dir_name = canonicalize_name(info_dir)
    canonical_name = canonicalize_name(name)
    if not info_dir_name.startswith(canonical_name):
        raise UnsupportedWheel(
            f".dist-info directory {info_dir!r} does not start with {canonical_name!r}"
        )

    return info_dir
