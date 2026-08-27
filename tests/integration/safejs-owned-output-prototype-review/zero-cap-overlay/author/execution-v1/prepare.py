import difflib
import json
import tempfile
from pathlib import Path
from shared import *


def main():
    assert Path.cwd() == REPOSITORY
    assert not (OWNER / 'PREPARATION.json').exists()
    before = now()
    admission_bytes = blob(ADMISSION_COMMIT, ADMISSION_PATH)
    assert regular(REPOSITORY / ADMISSION_PATH) == admission_bytes
    admission = json.loads(admission_bytes)
    assert admission['verdict'] == 'ALLOW_REPLAY_OF_EXACT_FREEZE'
    assert admission['authorFreezeCommit'] == AUTHOR_COMMIT
    assert admission['inspectionCommit'] == '50897e9e17b3201235fa1a9f5fe0f7641bc4f4e3'
    assert admission['reviewerIdentity'] != 'zero-cap-overlay-author'
    freeze_bytes = blob(AUTHOR_COMMIT, AUTHOR_PATH + '/FREEZE.json')
    freeze = json.loads(freeze_bytes)
    frozen_entries = sorted([*freeze['files'], {'path': 'FREEZE.json', 'bytes': len(freeze_bytes), 'sha256': sha(freeze_bytes)}], key=lambda entry: entry['path'])
    assert len(frozen_entries) == 88
    original_files = {}
    for entry in frozen_entries:
        value = blob(AUTHOR_COMMIT, AUTHOR_PATH + '/' + entry['path'])
        assert len(value) == entry['bytes'] and sha(value) == entry['sha256']
        assert regular(REPOSITORY / AUTHOR_PATH / entry['path']) == value
        original_files[entry['path']] = value
    candidate = json.loads(original_files['CANDIDATE.json'])
    for field in ['candidateManifestSha256', 'sourceManifestSha256', 'compiledManifestSha256', 'packageManifestSha256']:
        assert candidate[field] == admission[field]
    assert sha(regular(NODE)) == candidate['node']['sha256']
    entries = json.loads(original_files['inventories/candidate-all940.json'])
    package_entries = json.loads(original_files['inventories/candidate-package709.json'])
    parent_entries = json.loads(original_files['inventories/parent-all940.json'])
    assert inventory(Path(candidate['candidateRoot'])) == entries
    assert inventory(Path(candidate['packageRoot'])) == package_entries
    for route in ['source-route', 'packaged-route']:
        assert inventory(RECEIPTS / route) == parent_entries
    temporary = Path(tempfile.mkdtemp(prefix='safe-bash-zero-overlay-author-replay-', dir='/private/tmp'))
    frozen_root = temporary / 'frozen-author'
    runtime_root = temporary / 'runtime'
    for path, value in original_files.items():
        target = frozen_root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(value)
        target.chmod(0o444)
        if path.startswith(('surface/', 'lifecycle/', 'controls/')):
            destination = runtime_root / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as output:
                output.write(value)
            destination.chmod(0o444)
    assert inventory(frozen_root) == frozen_entries
    original_adapter = original_files['admission.mjs'].decode()
    replacements = [
        ('export const author = dirname(fileURLToPath(import.meta.url));', f'export const author = "{frozen_root}";'),
        ('const freezePath = relative(repository, join(author, "FREEZE.json"));', f'const freezePath = "{AUTHOR_PATH}/FREEZE.json";'),
        ('`${commit}:${relative(repository, join(author, entry.path))}`', f'`${{commit}}:{AUTHOR_PATH}/${{entry.path}}`'),
    ]
    adapted = original_adapter
    for first, second in replacements:
        assert adapted.count(first) == 1
        adapted = adapted.replace(first, second)
    put(runtime_root / 'admission.mjs', adapted)
    (runtime_root / 'admission.mjs').chmod(0o444)
    put(OWNER / 'admission-relocation.mjs.data', adapted)
    put(OWNER / 'admission-relocation.patch-data', ''.join(difflib.unified_diff(original_adapter.splitlines(True), adapted.splitlines(True), 'frozen/admission.mjs', 'execution/admission.mjs')))
    copy_tree(Path(candidate['candidateRoot']), temporary / 'candidate', entries)
    copy_tree(Path(candidate['packageRoot']), temporary / 'package', package_entries)
    for name in ['home', 'tmp', 'raw']:
        (temporary / name).mkdir()
    prepared_engine = inventory(PREPARED / 'engine')
    assert len(prepared_engine) == 264
    for tool in candidate['tools']:
        assert inventory(PREPARED / 'node_modules' / tool['name']) == tool['files']
    loader_hash = json.loads(blob(AUTHOR_COMMIT, 'tests/integration/safejs-owned-output-prototype-review/lifecycle/SOURCE-PINS.json'))['loader']['sha256']
    assert sha(regular(PREPARED / 'loader.mjs')) == loader_hash
    root_descriptor = {
        'authorFreezeCommit': AUTHOR_COMMIT, 'candidateManifestSha256': candidate['candidateManifestSha256'], 'sourceManifestSha256': candidate['sourceManifestSha256'],
        'compiledManifestSha256': candidate['compiledManifestSha256'], 'packageManifestSha256': candidate['packageManifestSha256'],
        'independentReviewCommit': ADMISSION_COMMIT, 'independentReviewPath': ADMISSION_PATH,
        'rootAuthorized': True, 'rootAuthorization': 'ROOT RELEASES AUTHOR ACTUAL BOUNDED REPLAY, user message2026-08-27: exactly one isolated author replay of8surface+11lifecycle+6controls from freeze a61e63bc; I01 surface unconditional bounded continuation retained, first-nonpass stops within lifecycle/controls; no source/fixture/assertion repair, no promotion.',
        'allowedCohorts': ['surface', 'lifecycle', 'controls'], 'candidateRoot': str(temporary / 'candidate'), 'packageRoot': str(temporary / 'package'),
        'outputRoot': str(temporary / 'raw'), 'noPromotion': True,
    }
    put(temporary / 'ROOT-RELEASE.json', root_descriptor)
    put(OWNER / 'ROOT-RELEASE.json', root_descriptor)
    put(OWNER / 'ADMISSION.json.data', admission_bytes.decode())
    shared_roots = [PREPARED, RECEIPTS / 'source-route', RECEIPTS / 'packaged-route', Path(candidate['candidateRoot']), Path(candidate['packageRoot'])]
    inputs = [frozen_root, runtime_root, temporary / 'candidate', temporary / 'package']
    preparation = {'started': before, 'finished': now(), 'temporary': str(temporary), 'frozenRoot': str(frozen_root), 'runtimeRoot': str(runtime_root), 'candidateRoot': str(temporary / 'candidate'), 'packageRoot': str(temporary / 'package'),
        'originalFreezeCommit': AUTHOR_COMMIT, 'admissionCommit': ADMISSION_COMMIT, 'admissionPath': ADMISSION_PATH, 'admissionSha256': sha(admission_bytes),
        'sourceManifestSha256': candidate['sourceManifestSha256'], 'candidateManifestSha256': candidate['candidateManifestSha256'], 'compiledManifestSha256': candidate['compiledManifestSha256'], 'packageManifestSha256': candidate['packageManifestSha256'],
        'frozen88Entries': frozen_entries, 'runtimeEntries': inventory(runtime_root), 'metadataRelocations': replacements,
        'driverChildFixtureScorerAssertionChanges': 0, 'relocationQualification': 'Three pathname/Git-binding substitutions only in a separate admission copy; every original frozen88 file remains exact in frozen-author. All assertion predicates remain present; Git paths still bind the same original commit/files. Driver/child/profile/fixture bytes execute unchanged. New execution files do not enter or waive the historical88-file guard.',
        'preparedEngine': prepared_engine, 'loaderSha256': loader_hash, 'sharedRoots': list(map(str, shared_roots)), 'immutableRoots': list(map(str, inputs)),
        'node': candidate['node'], 'rootDescriptorSha256': sha(regular(temporary / 'ROOT-RELEASE.json')), 'productImports': 0, 'engineImports': 0, 'privateQueries': 0, 'noPromotion': True}
    put(OWNER / 'PREPARATION.json', preparation)
    put(OWNER / 'PREPARATION-SHARED.json', snapshot(shared_roots))
    put(OWNER / 'PREPARATION-INPUTS.json', snapshot(inputs))
    print(json.dumps({'temporary': str(temporary), 'frozenEntries': 88, 'runtimeFiles': len(preparation['runtimeEntries']), 'guestExecutions': 0, 'privateQueries': 0}))


if __name__ == '__main__':
    main()
