import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import time

repository = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
destination = pathlib.Path('/tmp/safe-bash-tree-final-436bda3-k1mKIO')
candidate = destination / 'candidate'
commit = '436bda3e21b2b6041409fac7408cf072b5d3fe5e'
candidate.mkdir(mode=0o700)
started = time.time()
inventory = []
archive = subprocess.Popen(['git', 'archive', '--format=tar', commit], cwd=repository, stdout=subprocess.PIPE)
with tarfile.open(fileobj=archive.stdout, mode='r|') as stream:
    for member in stream:
        if member.isdir():
            continue
        if not member.isfile():
            raise RuntimeError(f'Nonregular commit entry refused: {member.name}')
        relative = pathlib.PurePosixPath(member.name)
        if relative.is_absolute() or '..' in relative.parts:
            raise RuntimeError(f'Unsafe commit entry: {member.name}')
        target = candidate / member.name
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with stream.extractfile(member) as source, target.open('xb') as output:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
        target.chmod(0o444)
        inventory.append({'path': member.name, 'bytes': member.size, 'sha256': digest.hexdigest(), 'kind': 'candidate-regular-file'})
if archive.wait() != 0:
    raise RuntimeError('git archive failed')

dependency_source = repository / 'node_modules'
dependency_target = candidate / 'node_modules'
shutil.copytree(dependency_source, dependency_target, symlinks=False)
dependencies = []
for root, directories, files in os.walk(dependency_target):
    for name in sorted(files):
        target = pathlib.Path(root) / name
        relative = target.relative_to(candidate).as_posix()
        original = repository / relative
        copied = target.read_bytes()
        before = hashlib.sha256(original.read_bytes()).hexdigest()
        copied_hash = hashlib.sha256(copied).hexdigest()
        if before != copied_hash:
            raise RuntimeError(f'Dependency changed during copy: {relative}')
        target.chmod(0o555 if target.stat().st_mode & 0o111 else 0o444)
        dependencies.append({'path': relative, 'bytes': len(copied), 'sha256': copied_hash, 'sourceSha256AfterCopy': before, 'sourceWasSymlink': original.is_symlink(), 'kind': 'copied-development-dependency'})

inventory.sort(key=lambda item: item['path'])
dependencies.sort(key=lambda item: item['path'])
full = sorted(inventory + dependencies, key=lambda item: item['path'])
def publish(name, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    (destination / name).write_bytes(data)
    return hashlib.sha256(data).hexdigest()

source = [item for item in inventory if item['path'].startswith('src/')]
summary = {
    'commit': commit,
    'tree': subprocess.check_output(['git', 'rev-parse', f'{commit}^{{tree}}'], cwd=repository, text=True).strip(),
    'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'elapsedSeconds': round(time.time() - started, 3),
    'candidateDirectory': str(candidate),
    'projection': 'ALL regular files from exact git commit; no live source imports; all copied files read-only',
    'candidateFileCount': len(inventory),
    'dependencyFileCount': len(dependencies),
    'candidateBytes': sum(item['bytes'] for item in inventory),
    'dependenciesBytes': sum(item['bytes'] for item in dependencies),
    'commitManifestSha256': publish('candidate-files.json', inventory),
    'sourceManifestSha256': publish('source-files.json', source),
    'dependencyManifestSha256': publish('dependency-files.json', dependencies),
    'fullInputManifestSha256': publish('full-input-files.json', full),
    'dependencyPolicy': 'Copied existing installed development tools, verified each against source after copy; symlinks dereferenced to regular frozen files. No install/download; copied .bin is not used.',
}
publish('freeze.json', summary)
shutil.copyfile('/tmp/safe-bash-tree-sort-text-fix-detail.txt', destination / 'author-detail.original.txt')
print(json.dumps(summary, indent=2))
