import gzip
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tarfile

MAX_TAR_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_FILES = 5000


def safe_name(member):
    name = member.name
    if not name or name.startswith('/') or '\\' in name or '\x00' in name:
        raise ValueError(f'unsafe name: {name!r}')
    parts = name.rstrip('/').split('/')
    if parts[0] != 'package' or any(part in ('', '.', '..') for part in parts):
        raise ValueError(f'unsafe package path: {name!r}')
    if any(any(ord(character) < 32 for character in part) for part in parts):
        raise ValueError('control character in path')
    if not (member.isfile() or member.isdir()) or member.issparse() or member.linkname:
        raise ValueError(f'link/special/sparse member: {name!r}')
    if any('sparse' in key.lower() or key == 'linkpath' for key in member.pax_headers):
        raise ValueError('unsupported pax link/sparse metadata')
    if member.size < 0 or member.size > MAX_FILE_BYTES:
        raise ValueError('member size ceiling')
    if member.isdir() and member.size:
        raise ValueError('directory payload')
    return '/'.join(parts)


def inspect_and_extract(archive_path, destination):
    if destination.exists():
        raise ValueError('destination must not exist')
    with tarfile.open(archive_path, 'r:') as archive:
        members = []
        names = set()
        folded = set()
        files = set()
        prefix_spellings = {}
        total = 0
        for member in archive:
            name = safe_name(member)
            if name in names or name.casefold() in folded:
                raise ValueError(f'duplicate/case collision: {name}')
            names.add(name)
            folded.add(name.casefold())
            components = name.split('/')
            for count in range(1, len(components) + 1):
                prefix = '/'.join(components[:count])
                folded_prefix = prefix.casefold()
                if folded_prefix in prefix_spellings and prefix_spellings[folded_prefix] != prefix:
                    raise ValueError('casefold ancestor collision')
                prefix_spellings[folded_prefix] = prefix
            members.append((name, member))
            if member.isfile():
                files.add(name)
                total += member.size
            if len(members) > MAX_FILES or total > MAX_TAR_BYTES:
                raise ValueError('archive member/payload ceiling')
        for name, member in members:
            parents = Path(name).parents
            if any(str(parent) in files for parent in parents):
                raise ValueError('file/directory ancestor collision')
        end_offset = max((member.offset_data + ((member.size + 511) // 512) * 512 for name, member in members), default=0)
        with open(archive_path, 'rb') as raw:
            raw.seek(end_offset)
            tail = raw.read(MAX_TAR_BYTES + 1)
            if len(tail) < 1024 or any(tail):
                raise ValueError('missing zero terminator or nonzero trailing archive payload')
        destination.mkdir(mode=0o700)
        rows = []
        for name, member in members:
            relative = '/'.join(name.split('/')[1:])
            if not relative:
                if not member.isdir():
                    raise ValueError('package root must be directory')
                continue
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if member.isdir():
                target.mkdir(exist_ok=True, mode=0o700)
                continue
            source = archive.extractfile(member)
            if source is None:
                raise ValueError('missing regular payload')
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
            mode = 0o755 if member.mode & 0o111 else 0o644
            descriptor = os.open(target, flags, mode)
            digest = hashlib.sha256()
            remaining = member.size
            with os.fdopen(descriptor, 'wb') as output:
                while remaining:
                    chunk = source.read(min(65536, remaining))
                    if not chunk:
                        raise ValueError('truncated regular payload')
                    remaining -= len(chunk)
                    digest.update(chunk)
                    output.write(chunk)
            if not stat.S_ISREG(target.lstat().st_mode):
                raise ValueError('nonregular extraction result')
            rows.append({'path': relative, 'bytes': member.size, 'sha256': digest.hexdigest(), 'archiveMode': member.mode, 'extractedMode': stat.S_IMODE(target.stat().st_mode), 'paxKeys': sorted(member.pax_headers)})
        return {'members': len(members), 'fileCount': len(rows), 'totalFileBytes': total, 'files': sorted(rows, key=lambda row: row['path'])}


def main():
    output = Path(__file__).resolve().parent
    download = json.loads((output / 'download.json').read_text())
    if not download['integrityMatches']:
        raise ValueError('digest gate closed')
    scratch = Path(download['scratch'])
    if not str(scratch).startswith('/private/tmp/safe-bash-published-auth-'):
        raise ValueError('unowned scratch')
    archive_path = scratch / 'published.tar'
    total = 0
    with gzip.open(download['officialTarball']['path'], 'rb') as compressed, archive_path.open('xb') as raw:
        while True:
            chunk = compressed.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_TAR_BYTES:
                raise ValueError('decompression ceiling')
            raw.write(chunk)
    result = inspect_and_extract(archive_path, scratch / 'authenticated-package')
    result.update({'python': sys.version, 'archiveBytes': total, 'destination': str(scratch / 'authenticated-package'), 'noPackageCodeExecuted': True, 'method': 'stdlib gzip/tarfile inspection then exclusive regular writes; no extractall, no link/special/duplicate traversal and no installed product extraction helpers'})
    with (output / 'published-files.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'members': result['members'], 'fileCount': result['fileCount'], 'totalFileBytes': result['totalFileBytes'], 'destination': result['destination']}))


if __name__ == '__main__':
    main()
