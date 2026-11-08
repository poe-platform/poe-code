from shared import *


ADDED_STATUS_LINES = [
    '?? docs/plans/safejs-audit-data-pipelines-review-2026-08-27.md',
    '?? docs/plans/safejs-audit-streaming-sketches-2026-08-27.md',
]


def expected_private_profile():
    profile = load(OWNER / 'PRIVATE-STATUS.json')
    assert profile['addedLines'] == ADDED_STATUS_LINES
    historical = profile['historicalSnapshot']
    original_bytes = blob(historical['commit'], historical['path'])
    assert sha(original_bytes) == historical['sha256']
    expected = json.loads(original_bytes)
    assert expected['status'] == profile['historicalStatus']
    anchor = '?? docs/plans/safejs-24h-audit-2026-08-27.md\n'
    assert expected['status'].count(anchor) == 1
    assert all(line not in expected['status'].splitlines() for line in ADDED_STATUS_LINES)
    status = expected['status'].replace(anchor, anchor + ''.join(line + '\n' for line in ADDED_STATUS_LINES))
    assert status == profile['expectedStatus']
    expected['status'] = status
    assert expected == load(OWNER / 'expected-private.json.data')
    return expected


def historical_schema(snapshot):
    def metadata(entry):
        projected = {key: value for key, value in entry.items() if key not in ['mtimeNs', 'ctimeNs']}
        for field in ['mtime', 'ctime']:
            seconds, nanoseconds = divmod(entry[field + 'Ns'], 1000000000)
            projected[field + 'Ms'] = seconds * 1000 + nanoseconds / 1000000
        return projected
    return {
        **{key: snapshot[key] for key in ['head', 'tree', 'status', 'staged']},
        'index': metadata(snapshot['index']),
        'metadata': {path: metadata(entry) for path, entry in snapshot['metadata'].items()},
        'engine': [metadata(entry) for entry in snapshot['engine']],
    }


def binding_release(freeze_commit, preparation):
    requested = os.environ.get('ZERO_OVERLAY_ROOT_RELEASE')
    assert requested, 'PREPARATION ONLY: different binding review and a fresh committed ROOT release required'
    descriptor = Path(requested).absolute()
    assert descriptor.is_relative_to(REPOSITORY / AUTHOR_PATH), 'Explicit owned committed ROOT descriptor required'
    descriptor_bytes = regular(descriptor)
    release = json.loads(descriptor_bytes)
    assert release['rootAuthorized'] is True, 'Runtime pending; no reuse of the exhausted execution-v1 release'
    assert isinstance(release['rootAuthorization'], str) and release['rootAuthorization']
    descriptor_path = descriptor.relative_to(REPOSITORY).as_posix()
    descriptor_commit = git('log', '-1', '--format=%H', '--', descriptor_path).decode().strip()
    assert descriptor_commit not in [freeze_commit, '8d58de4e08b9a50a8305b17686bd842a9e7d2d5e']
    assert blob(descriptor_commit, descriptor_path) == descriptor_bytes
    assert release['bindingPreparationCommit'] == freeze_commit
    assert release['bindingFreezeSha256'] == sha(regular(OWNER / 'EXECUTION-FREEZE.json'))
    assert release['privateStatusProfileSha256'] == sha(regular(OWNER / 'PRIVATE-STATUS.json'))
    assert release['authorFreezeCommit'] == AUTHOR_COMMIT
    assert release['independentReviewCommit'] == ADMISSION_COMMIT
    assert release['independentReviewPath'] == ADMISSION_PATH
    for key in ['candidateManifestSha256', 'sourceManifestSha256', 'compiledManifestSha256', 'packageManifestSha256', 'candidateRoot', 'packageRoot']:
        assert release[key] == preparation[key], key
    assert release['outputRoot'] == str(Path(preparation['temporary']) / 'raw')
    assert release['allowedCohorts'] == ['surface', 'lifecycle', 'controls']
    assert release['noPromotion'] is True
    review_commit = release['bindingReviewCommit']
    assert isinstance(review_commit, str) and len(review_commit) == 40
    assert review_commit not in [freeze_commit, AUTHOR_COMMIT, ADMISSION_COMMIT, descriptor_commit]
    review = json.loads(blob(review_commit, release['bindingReviewPath']))
    assert review['verdict'] == 'ALLOW_REPLAY_OF_EXACT_STATUS_BINDING'
    assert isinstance(review['reviewerIdentity'], str) and review['reviewerIdentity']
    assert review['reviewerIdentity'] != 'zero-cap-overlay-author'
    for key in ['bindingPreparationCommit', 'bindingFreezeSha256', 'privateStatusProfileSha256', 'authorFreezeCommit', 'candidateManifestSha256', 'sourceManifestSha256', 'compiledManifestSha256', 'packageManifestSha256']:
        assert review[key] == release[key], key
    return descriptor, descriptor_bytes
