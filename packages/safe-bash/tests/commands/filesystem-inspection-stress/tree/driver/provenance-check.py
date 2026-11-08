import hashlib
import json
import pathlib
import tarfile

directory = pathlib.Path('/tmp/safe-bash-tree-initial-run-NN3E3X')
candidate = directory / 'candidate'
oracle = pathlib.Path('/tmp/safe-bash-tree-oracle-MlUjmM')
sealed = pathlib.Path('/tmp/safe-bash-tree-hidden-prep-vyzfHc')
digest = lambda data: hashlib.sha256(data).hexdigest()
metadata = json.loads((candidate / 'tests/commands/tree/native-fixtures.json').read_text())['provenance']
archive = oracle / 'tree-2.2.1.tar.bz2'
binary = oracle / 'unix-tree-2.2.1/tree'
assert digest(archive.read_bytes()) == metadata['archiveSha256']
assert digest(binary.read_bytes()) == metadata['binarySha256']
assert digest((sealed / 'oracle/tree').read_bytes()) == metadata['binarySha256']
assert digest((sealed / 'oracle/tree-2.2.1.tar.bz2').read_bytes()) == metadata['archiveSha256']
source_matches = []
with tarfile.open(archive, 'r:bz2') as stream:
    for entry in stream.getmembers():
        if not entry.isfile():
            continue
        relative = pathlib.PurePosixPath(entry.name).relative_to('unix-tree-2.2.1')
        if relative.suffix not in ('.c', '.h') and relative.as_posix() not in ('Makefile', 'doc/tree.1'):
            continue
        data = stream.extractfile(entry).read()
        actual = (oracle / 'unix-tree-2.2.1' / relative).read_bytes()
        assert digest(data) == digest(actual), str(relative)
        source_matches.append({'path': str(relative), 'archiveAndBuildTreeSha256': digest(data)})
log = pathlib.Path('/tmp/safe-bash-tree-author.log').read_text()
lines = log.splitlines()
excerpt = '\n'.join(f'{index + 1}: {lines[index]}' for index in range(3928, 3951)) + '\n'
(directory / 'native-build-original-excerpt.txt').write_text(excerpt)
assert "CFLAGS='-O2 -std=c11 -Wall -Wextra' LDFLAGS= tree" in excerpt
assert 'succeeded in 1688ms' in excerpt
assert 'Apple clang version 21.0.0' in excerpt
assert 'stddata_fd' in excerpt
lock = json.loads((candidate / 'package-lock.json').read_text())
installed = []
for package_file in (candidate / 'node_modules').glob('*/package.json'):
    package = json.loads(package_file.read_text())
    key = package_file.parent.relative_to(candidate).as_posix()
    if key in lock['packages']:
        assert package['version'] == lock['packages'][key]['version'], key
        installed.append({'name': package.get('name'), 'version': package['version'], 'lockKey': key})
for package_file in (candidate / 'node_modules').glob('@*/*/package.json'):
    package = json.loads(package_file.read_text())
    key = package_file.parent.relative_to(candidate).as_posix()
    assert package['version'] == lock['packages'][key]['version'], key
    installed.append({'name': package.get('name'), 'version': package['version'], 'lockKey': key})
report = {
    'nativeMetadata': metadata, 'independentChecks': {'archiveHash': 'matches', 'binaryHash': 'matches', 'sealedCopyHashes': 'matches', 'archiveSourceVersusBuildTree': source_matches, 'recordedBuildCommandCompilerWarningExit': 'corroborated in original author execution log'},
    'buildLogWholeSha256': digest(log.encode()), 'buildExcerptSha256': digest(excerpt.encode()),
    'provenanceConclusion': 'Recorded official archive URL, binary/archive hashes, exact build command, Apple clang21 metadata and successful original build corroborated; relevant build sources equal archive. Not a fresh reproducible rebuild or independent network attestation.',
    'nativeExecutionsThisResume': 0, 'newNativeCaptures': 0,
    'installedDependencyVersionsMatchCandidateLock': installed,
    'preExecutionBridgeSha256': digest((directory / 'bridge.mjs').read_bytes()),
    'preExecutionProfileSha256': digest((directory / 'profile.json').read_bytes()),
    'preExecutionRunnerSha256': digest((directory / 'execute.mjs').read_bytes()),
    'scope': 'Standalone direct source module; no public/default integration',
}
(directory / 'provenance-check.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'nativeProvenance': 'corroborated', 'matchingSourceFiles': len(source_matches), 'lockedInstalledPackages': len(installed), 'nativeRecaptures': 0}, indent=2))
