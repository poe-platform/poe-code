import argparse
import base64
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile


ROOT = Path('/Users/kjopek/Workspace/safe-bash')
OWNED = ROOT / 'tests/comparison/breadth-continuation-independent-20260828'
AUTHOR = 'a045139b62164dbae923475bdca93ef109b926ff'
PRIOR = '17735a5eabf65a6398a64aef81e67fee2405733e'
CANDIDATE = '67eab12e315054907ef4ef435c6bbca2f59e0c36'
PACKET = 'tests/comparison/breadth-continuation-20260828/'
INVENTORY = 'tests/comparison/next-gap-inventory-20260828/'
COMPARISON = 'benchmarks/reports/current-comparison-20260827/'
EXPECTED_MANIFEST = '19526e0eb11478107b73026bdcc5d3b309f4cfb38c57a93c7cfea1672e75e923'
checks = []
sources = {}


def git(*arguments):
    if arguments[0] not in {'show', 'ls-tree', 'rev-parse', 'status', 'diff'}:
        raise ValueError('Only read-only Git operations are allowed')
    return subprocess.check_output(['/usr/bin/git', *arguments], cwd=ROOT, timeout=30)


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def check(label, condition, detail=None):
    checks.append({'label': label, 'passed': bool(condition), 'detail': detail})


def frozen(commit, filename):
    key = commit + ':' + filename
    if key not in sources:
        if PurePosixPath(filename).is_absolute() or '..' in PurePosixPath(filename).parts:
            raise ValueError('Unsafe Git path')
        if 'xan-module' in filename or PurePosixPath(filename).name == 'AGENTS.md':
            raise ValueError('Excluded source')
        content = git('show', key)
        entry = git('ls-tree', commit, '--', filename).decode().strip()
        live = ROOT / filename
        live_info = live.lstat() if live.exists() else None
        live_hash = sha256(live.read_bytes()) if live_info and stat.S_ISREG(live_info.st_mode) else None
        sources[key] = {
            'commit': commit, 'path': filename, 'gitEntry': entry,
            'bytes': len(content), 'sha256': sha256(content),
            'currentSha256': live_hash, 'currentMatchesFrozen': live_hash == sha256(content),
            '_content': content,
        }
    return sources[key]['_content']


def data(commit, filename):
    return json.loads(frozen(commit, filename))


def file_identity(filename):
    try:
        info = filename.lstat()
        record = {'path': str(filename), 'bytes': info.st_size, 'mode': stat.S_IMODE(info.st_mode)}
        if not stat.S_ISREG(info.st_mode):
            return {**record, 'status': 'not-regular', 'sha256': None}
        digest = hashlib.sha256()
        with filename.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        return {**record, 'status': 'available', 'sha256': digest.hexdigest()}
    except FileNotFoundError:
        return {'path': str(filename), 'status': 'unavailable-ENOENT', 'sha256': None}


def archive_identity(filename, expected_hash):
    record = file_identity(filename)
    check('archive bytes: ' + filename.name, record['sha256'] == expected_hash)
    if record['status'] == 'available':
        with tarfile.open(filename, 'r:gz') as archive:
            entries = [
                {'path': member.name, 'size': member.size, 'mode': member.mode,
                 'type': member.type.decode('ascii'), 'linkname': member.linkname}
                for member in archive
            ]
        record['members'] = entries
        record['memberCount'] = len(entries)
        record['uniqueMemberNames'] = len({entry['path'] for entry in entries})
        record['unsafePaths'] = [entry['path'] for entry in entries if
                                 PurePosixPath(entry['path']).is_absolute() or
                                 '..' in PurePosixPath(entry['path']).parts]
        record['postSha256'] = file_identity(filename)['sha256']
        check('archive stable: ' + filename.name, record['postSha256'] == record['sha256'])
    record['qualification'] = 'Hash and archive metadata only; no extraction, import, build or execution.'
    return record


parser = argparse.ArgumentParser(description='Data-only review; never executes repository modules or specimens.')
parser.add_argument('--output', required=True)
arguments = parser.parse_args()
output = (OWNED / arguments.output).resolve()
if output.parent != OWNED or output.exists():
    raise ValueError('Output must be a new direct child of the owned directory')
start = {
    'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'head': git('rev-parse', 'HEAD').decode().strip(),
    'status': git('status', '--porcelain=v1').decode(),
    'stagedNameStatus': git('diff', '--cached', '--name-status').decode(),
    'ownedStatus': git('status', '--porcelain=v1', '--', str(OWNED.relative_to(ROOT))).decode(),
}

manifest = data(AUTHOR, PACKET + 'MANIFEST.json')
check('author manifest equals user-supplied SHA256', sha256(frozen(AUTHOR, PACKET + 'MANIFEST.json')) == EXPECTED_MANIFEST)
packet_names = ['MANIFEST.json'] + [entry['path'] for entry in manifest['files']]
tree_names = git('ls-tree', '-r', '--name-only', AUTHOR, '--', PACKET).decode().splitlines()
check('exact frozen packet membership', sorted(tree_names) == sorted(PACKET + name for name in packet_names))
check('exact current packet membership', sorted(os.listdir(ROOT / PACKET)) == sorted(packet_names))
for entry in manifest['files']:
    content = frozen(AUTHOR, PACKET + entry['path'])
    live_info = (ROOT / PACKET / entry['path']).lstat()
    check('packet seal: ' + entry['path'], sha256(content) == entry['sha256'] and len(content) == entry['bytes'])
    check('packet current bytes/mode: ' + entry['path'],
          sources[AUTHOR + ':' + PACKET + entry['path']]['currentMatchesFrozen'] and
          stat.S_IMODE(live_info.st_mode) == entry['mode'] and stat.S_ISREG(live_info.st_mode))

bindings = data(AUTHOR, PACKET + 'BINDINGS.json')
for entry in bindings['inputBindings']:
    content = frozen(entry['commit'], entry['path'])
    check('immutable input: ' + entry['path'], len(content) == entry['bytes'] and
          sha256(content) == entry['sha256'] and
          sources[entry['commit'] + ':' + entry['path']]['gitEntry'].startswith(entry['mode'] + ' blob '))

old = data(PRIOR, INVENTORY + 'BREADTH.json')
eligibility = data(AUTHOR, PACKET + 'ELIGIBILITY.json')
legacy = data(AUTHOR, PACKET + 'LEGACY-RECIPES.json')
workflows = data(AUTHOR, PACKET + 'WORKFLOWS.json')
controls = data(AUTHOR, PACKET + 'CONTROLS.json')
readiness = data(AUTHOR, PACKET + 'READINESS.json')
old_by_id = {row['id']: row for row in old['rows']}
audit = data(PRIOR, INVENTORY + 'ARCHIVE-AUDIT.json')
audit_by_path = {row['path']: row for row in audit['observations']}
historical = data(AUTHOR, COMPARISON + 'cohorts/historical-breadth.json')
historical_by_id = {row['id']: row for row in historical if row['section'] == 'cases' and
                    row['recipe']['cohort'] in {'historical-unmeasured', 'additional-optional'}}
check('all 54 historical IDs and order', [row['id'] for row in eligibility['rows']] == list(old_by_id) and len(old_by_id) == 54)
check('54 unique original cohort case IDs', set(historical_by_id) == set(old_by_id) and len(historical_by_id) == 54)
check('eligibility category counts', dict(collections.Counter(row['eligibility'] for row in eligibility['rows'])) == eligibility['counts'])
selected_ids = [row['id'] for row in eligibility['rows'] if row['eligibility'].startswith('eligible-')]
check('23 selected, 31 held/excluded', len(selected_ids) == 23 and len(eligibility['rows']) - len(selected_ids) == 31)
check('unchanged selected order', [row['id'] for row in legacy['rows']] == selected_ids)
historical_rows = []
for row in eligibility['rows']:
    original = old_by_id[row['id']]
    check('historical score flags: ' + row['id'], row['historicalTargetOperational'] == original['historical']['ours']['operationalCredit'] and
          row['historicalComparatorOperational'] == original['historical']['baseline']['operationalCredit'])
    if row['id'] != 'xan-positive':
        check('unchanged all-ID expected hash: ' + row['id'], sha256(compact(original['recipe']['expected'])) == row['expectedJsonSha256'])
        check('original cohort recipe: ' + row['id'], original['recipe'] == historical_by_id[row['id']]['recipe'])
    for engine in row.get('rawBindings', {}):
        bound = row['rawBindings'][engine]
        observation = audit_by_path[bound['evidence']]
        check('prior raw-record binding: ' + row['id'] + ':' + engine,
              observation['sha256'] == bound['sha256'] == original['historical'][engine]['sha256'])
    historical_rows.append({key: row[key] for key in ['id', 'recipeHash', 'expectedJsonSha256', 'eligibility', 'historicalTargetOperational', 'historicalComparatorOperational', 'rawBindings'] if key in row})
for row in legacy['rows']:
    check('selected full recipe bytes: ' + row['id'], compact(row['recipe']) == compact(old_by_id[row['id']]['recipe']) and
          sha256(compact(row['recipe'])) == row['recipeHash'] and row['recipe']['budgetMs'] == 30000)
check('old 13/54 vs 47/54 derived from rows', sum(row['historicalTargetOperational'] for row in eligibility['rows']) == 13 and
      sum(row['historicalComparatorOperational'] for row in eligibility['rows']) == 47)
receipt = data(PRIOR, COMPARISON + 'measurement-review/FINAL_REVIEW_RECEIPT.json')
check('historical receipt confirms 13/54, 47/54, 50 raw',
      receipt['separateTables']['breadth']['virtual-bash']['targets']['operationalCredit'] == 13 and
      receipt['separateTables']['breadth']['just-bash']['targets']['operationalCredit'] == 47 and
      receipt['separateTables']['breadth']['just-bash']['targets']['predicateMatches'] == 50)
profiles = data(PRIOR, COMPARISON + 'cohorts/profiles.json')['breadth']
check('legacy environment retained', bindings['legacyProfile']['environment'] == profiles['environment'])
check('legacy target limits retained', bindings['legacyProfile']['target']['limits'] == profiles['configurations']['ours']['default']['limits'])
check('legacy comparator profile retained', bindings['legacyProfile']['comparator'] == profiles['configurations']['baseline']['default'])
inventory = data(PRIOR, INVENTORY + 'SOURCE-INVENTORY.json')
check('78 independently declared names retained', bindings['target']['defaultNames'] == inventory['defaultNames'] and len(set(bindings['target']['defaultNames'])) == 78)
for gate in readiness['gates']:
    for row in gate['originalRecipes']:
        check('future gate recipe unchanged: ' + row['id'], row['recipe'] == old_by_id[row['id']]['recipe'] and row['id'] not in selected_ids)

literal_stdout = [b'alpha\nbeta\n', b'alpha\nbeta\ngamma\n', bytes([0, 255, 65, 10, 13, 128, 0]),
                  b'n:3\n', b'# Release\n###### Notes\n', b'4\ta.txt\n6\tb.txt\n',
                  b'/fixture/bin/tool\n', b'payload: OK\n', b'kept\n', b'a.txt\nb.txt\n']
workflow_records = []
for row, expected_stdout in zip(workflows['rows'], literal_stdout, strict=True):
    expected = row['expected']
    decoded = base64.b64decode(expected['stdoutBase64'], validate=True)
    check('independent literal stdout: ' + row['id'], decoded == expected_stdout)
    check('literal status/stderr/namespace policy: ' + row['id'], expected['exitCode'] == 0 and expected['stderrBase64'] == '' and
          expected['preserveInitialBytesAndPermissionBits'] and expected['exactFinalNamespace'] and not expected['compareNewFileModes'])
    workflow_records.append({'id': row['id'], 'stdoutHex': decoded.hex(), 'scriptSha256': sha256(row['script'].encode()),
                             'addedFiles': {name: {'hex': base64.b64decode(value['base64'], validate=True).hex(),
                                                  'sha256': sha256(base64.b64decode(value['base64'], validate=True))}
                                            for name, value in expected['addedFiles'].items()},
                             'absent': expected['absent'], 'semanticExecution': False})
check('W03 exact seven-byte chunk declaration', workflows['rows'][2]['inputChunkLengths'] == [1, 2, 1, 3] and
      base64.b64decode(workflows['rows'][2]['stdinBase64']) == literal_stdout[2])
check('W08 independent mathematical digest', base64.b64decode(workflows['rows'][7]['expected']['addedFiles']['sums']['base64']) ==
      (sha256(b'abc\n') + '  payload\n').encode())
check('12 unexecuted proposed controls', len(controls['rows']) == 12 and all(row['executions'] == 0 for row in controls['rows']))

closure_path = COMPARISON + 'measurement-freeze/baseline-closure.json'
closure = data(AUTHOR, closure_path)
authentication = data(AUTHOR, COMPARISON + 'measurement-freeze/baseline-authentication.json')
freeze = data(AUTHOR, COMPARISON + 'measurement-freeze/FREEZE_MANIFEST.json')
for filename in ['baseline-closure.json', 'baseline-authentication.json']:
    entry = next(entry for entry in freeze['files'] if entry['path'] == filename)
    check('historical freeze seals ' + filename, sha256(frozen(AUTHOR, COMPARISON + 'measurement-freeze/' + filename)) == entry['sha256'])
closure_records = []
for entry in closure['files']:
    relative = PurePosixPath(entry['path'])
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Unsafe closure path')
    filename = Path(closure['root']) / entry['path']
    if relative.name == 'AGENTS.md':
        info = filename.lstat() if filename.exists() else None
        record = {'path': str(filename), 'status': 'instruction-file-metadata-only', 'sha256': None,
                  'available': info is not None, 'bytes': info.st_size if info else None}
    else:
        record = file_identity(filename)
        record['matchesExpected'] = record['sha256'] == entry['sha256'] and record.get('bytes') == entry['bytes'] and record.get('mode') == entry['mode']
    closure_records.append(record)

prior_package = data(AUTHOR, 'tests/integration/timeout-curl-safejs-20260828/BINDINGS.json')['package']
comparator_tar = Path(authentication['tar']['root']) / authentication['tar']['path']
archives = [archive_identity(comparator_tar, bindings['comparator']['priorArchive']['sha256']),
            archive_identity(Path(prior_package['pack']['physical']), bindings['target']['packSha256'])]
check('public package receipt candidate and pack', prior_package['candidate'] == CANDIDATE and
      prior_package['pack']['sha256'] == bindings['target']['packSha256'])
for filename in ['breadth.mjs', 'engine-child.mjs', 'observe-load.mjs', 'assessment.mjs']:
    frozen(AUTHOR, COMPARISON + 'execution/' + filename)
execution_binding = data(AUTHOR, COMPARISON + 'measurement-freeze/execution-binding.json')
check('archived comparator closure binds same manifest', execution_binding['engines']['just-bash']['closure'] == closure)
runner_records = []
for entry in execution_binding['runner']['files']:
    if entry['path'] in {'breadth.mjs', 'engine-child.mjs', 'observe-load.mjs', 'assessment.mjs'}:
        content = frozen(AUTHOR, COMPARISON + 'execution/' + entry['path'])
        identity = file_identity(Path(execution_binding['runner']['root']) / entry['path'])
        check('old runner frozen bytes: ' + entry['path'], sha256(content) == entry['sha256'])
        check('old staged runner available: ' + entry['path'], identity['sha256'] == entry['sha256'])
        runner_records.append(identity)

for name in packet_names:
    check('protected packet still matches frozen: ' + name, (ROOT / PACKET / name).read_bytes() == frozen(AUTHOR, PACKET + name))
check('protected packet no new entries', sorted(os.listdir(ROOT / PACKET)) == sorted(packet_names))
result = {
    'schema': 'independent-breadth-static-review-v2', 'authorCommit': AUTHOR, 'candidate': CANDIDATE,
    'manifestSha256': EXPECTED_MANIFEST, 'startedState': start,
    'checkerSha256': sha256(Path(__file__).read_bytes()),
    'currentPacketNames': sorted(os.listdir(ROOT / PACKET)),
    'unsealedCurrentPacketEntries': sorted(set(os.listdir(ROOT / PACKET)) - set(packet_names)),
    'counts': {'staticAssertions': len(checks), 'staticAssertionsPassed': sum(row['passed'] for row in checks),
               'staticAssertionsFailed': sum(not row['passed'] for row in checks), 'packetFiles': len(packet_names),
               'authorInputBindings': len(bindings['inputBindings']), 'historicalIDs': len(eligibility['rows']),
               'selectedRecipes': len(legacy['rows']), 'heldExcluded': 31, 'proposedWorkflows': 10, 'proposedControls': 12,
               'closureDeclaredFiles': len(closure_records),
               'closureFilesHashModeMatched': sum(row.get('matchesExpected', False) for row in closure_records)},
    'executionCounts': dict.fromkeys(['product', 'comparator', 'nativeOracle', 'existingHarness', 'install', 'build',
                                    'network', 'privateEngine', 'timingCohort', 'sortSamples'], 0),
    'checks': checks, 'eligibility': historical_rows, 'categoryCounts': eligibility['counts'],
    'workflows': workflow_records, 'closureFiles': closure_records, 'oldRunnerFiles': runner_records,
    'closureQualification': 'Declared files only. AGENTS content not read. No new-entry census or load proof; not an admitted closure.',
    'archives': archives,
    'sources': [{key: value for key, value in entry.items() if key != '_content'} for entry in sources.values()],
    'limits': ['No product/comparator/native imports or execution; only Python standard-library data operations and read-only Git.',
               'Historical raw archive not reopened; 106 historical raw references cross-checked against a bound prior audit; XAN remains opaque.',
               'New literal review is not a runtime or native-oracle result.',
               'No private repository reads. Exact comparator staging and target archive paths were read only as data.',
               'No full current candidate gate, provider test, performance or superiority result.'],
    'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
output.mkdir()
(output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'output': str(output.relative_to(ROOT)), 'counts': result['counts'],
                  'failedChecks': [row for row in checks if not row['passed']]}))
raise SystemExit(1 if any(not row['passed'] for row in checks) else 0)
