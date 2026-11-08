import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo


ROOT = Path('/Users/kjopek/Workspace/safe-bash')
OWNED = Path(__file__).resolve().parent
AUTHOR = 'eb468a7e5283525e48a282c40dd98ec7617c4307'
PRIOR = '157eb678f8bcb9ed18fd308a21771aa4d6a032ce'
RECIPE = '29f7f3f0074dbaf41b99e69581364d0c6f1021ae'
PACKET = 'tests/comparison/breadth-continuation-20260828'
OVERLAY = PACKET + '/executor-overlay-v2'
PREPARATION = PACKET + '/executor-preparation-v1'
INDEPENDENT = 'tests/comparison/breadth-continuation-independent-20260828'
SEAL_HASH = '0485cdb55542cd3f90237256f45eee2082003a90b4ba9d1d7827e3212b562b01'
checks = []
artifacts = {}
cache = {}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*arguments):
    if arguments[0] not in {'show', 'ls-tree', 'rev-parse', 'status', 'diff'}:
        raise ValueError('Read-only Git allowlist')
    return subprocess.check_output(['git', *arguments], cwd=ROOT)


def permitted(filename):
    if any(part.upper() == 'AGENTS.MD' for part in Path(filename).parts):
        raise ValueError('Instruction member content forbidden')


def frozen(commit, filename):
    permitted(filename)
    key = commit + ':' + filename
    if key not in cache:
        data = git('show', key)
        cache[key] = data
        artifacts[key] = {'commit': commit, 'path': filename, 'bytes': len(data), 'sha256': digest(data)}
    return cache[key]


def document(commit, filename):
    return json.loads(frozen(commit, filename))


def check(identifier, condition, detail=None):
    checks.append({'id': identifier, 'holds': bool(condition), **({'detail': detail} if detail is not None else {})})


def live_bytes(filename):
    permitted(filename)
    location = ROOT / filename
    current = ROOT
    for part in Path(filename).parts:
        current = current / part
        if stat.S_ISLNK(current.lstat().st_mode):
            raise ValueError('Refuse live symlink: ' + filename)
    metadata = location.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError('Refuse nonregular live content: ' + filename)
    return location.read_bytes(), stat.S_IMODE(metadata.st_mode)


def members(directory):
    found = []
    for current, directories, files in os.walk(ROOT / directory, followlinks=False):
        for name in sorted(directories + files):
            location = Path(current) / name
            kind = 'symlink' if location.is_symlink() else 'directory' if location.is_dir() else 'file'
            found.append((location.relative_to(ROOT / directory).as_posix(), kind))
    return sorted(found)


def expected_members(filenames):
    result = {(filename, 'file') for filename in filenames}
    for filename in filenames:
        for parent in Path(filename).parents:
            if str(parent) != '.':
                result.add((parent.as_posix(), 'directory'))
    return sorted(result)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def stable(entry):
    result = {'path': entry['path'], 'type': entry['type'], 'mode': entry['mode'] & 0o7777}
    if entry['type'] == 'file':
        permitted(entry['path'])
        result.update(size=entry['size'], sha256=digest(base64.b64decode(entry['base64'], validate=True)))
    if entry['type'] == 'symlink':
        result['target'] = entry['target']
    return result


def outside(entry):
    return entry['path'] != '/fixture' and not entry['path'].startswith('/fixture/')


def run():
    seal = document(AUTHOR, OVERLAY + '/SEAL.json')
    check('author-seal', digest(frozen(AUTHOR, OVERLAY + '/SEAL.json')) == SEAL_HASH)
    bound_files = {entry['path']: entry for entry in seal['files']}
    filenames = sorted([*bound_files, 'SEAL.json', 'VALIDATION.json'])
    tree = git('ls-tree', '-r', '--name-only', AUTHOR, '--', OVERLAY).decode().splitlines()
    check('frozen-overlay-exact-membership', tree == [OVERLAY + '/' + name for name in filenames])
    declared_live = {}
    for filename in filenames:
        data = frozen(AUTHOR, OVERLAY + '/' + filename)
        expected = bound_files.get(filename)
        if expected:
            check('sealed:' + filename, len(data) == expected['bytes'] and digest(data) == expected['sha256'])
        declared_live[OVERLAY + '/' + filename] = (data, expected['mode'] if expected else 0o644)
    bindings = document(AUTHOR, OVERLAY + '/BINDINGS.json')
    for reference in bindings['references']:
        data = frozen(reference['commit'], reference['path'])
        check('reference:' + reference['path'], len(data) == reference['bytes'] and digest(data) == reference['sha256'])
    prior_seal = document(PRIOR, INDEPENDENT + '/SEAL.json')
    check('prior-receipt-identical', prior_seal == bindings['peerHistory']['seal'])
    check('prior-latest-retained', [bindings['peerHistory']['latest'][key] for key in ['assertions', 'passed', 'failed']] == [402, 400, 2])
    check('prior-first-retained', [bindings['peerHistory']['first'][key] for key in ['assertions', 'passed', 'failed']] == [394, 391, 3])
    for entry in prior_seal['files']:
        data = frozen(PRIOR, INDEPENDENT + '/' + entry['path'])
        check('prior-protected:' + entry['path'], len(data) == entry['bytes'] and digest(data) == entry['sha256'])
        declared_live[INDEPENDENT + '/' + entry['path']] = (data, entry['mode'])
    declared_live[INDEPENDENT + '/SEAL.json'] = (frozen(PRIOR, INDEPENDENT + '/SEAL.json'), 0o644)
    prior_text = frozen(PRIOR, INDEPENDENT + '/README.md').decode()
    check('old-scores-retained-in-prior', '13/54' in prior_text and '47/54' in prior_text)
    preparation_files = set()
    for parent in seal['parentManifests']:
        filename = PREPARATION + '/' + parent['path']
        data = frozen(AUTHOR, filename)
        check('parent-seal:' + parent['path'], digest(data) == parent['sha256'])
        declared_live[filename] = (data, 0o644)
        preparation_files.add(parent['path'])
        for entry in json.loads(data)['files']:
            filename = PREPARATION + '/' + entry['path']
            data = frozen(AUTHOR, filename)
            check('parent-member:' + entry['path'], len(data) == entry['bytes'] and digest(data) == entry['sha256'])
            declared_live[filename] = (data, entry.get('mode', 0o644))
            preparation_files.add(entry['path'])
    for delta_name in ['ADAPTER-DELTA.json', 'CONTROL-DELTA.json']:
        delta = document(AUTHOR, OVERLAY + '/' + delta_name)
        original_name = Path(delta['base']['path']).name
        source = frozen(RECIPE, PREPARATION + '/' + original_name).decode()
        check(delta_name + ':pristine', digest(source.encode()) == delta['base']['sha256'])
        for ordinal, change in enumerate(delta['changes'], 1):
            before = change.get('replaceAllBefore', change.get('before'))
            after = change.get('replaceAllAfter', change.get('after'))
            expected = change.get('expectedCount', 1)
            check(delta_name + ':edit-' + str(ordinal), source.count(before) == expected)
            source = source.replace(before, after)
        patched = frozen(AUTHOR, OVERLAY + '/' + delta['patched']['path'])
        check(delta_name + ':exact-generated-output', source.encode() == patched and digest(patched) == delta['patched']['sha256'])
    workflows = document('a045139b62164dbae923475bdca93ef109b926ff', PACKET + '/WORKFLOWS.json')
    check('workflows-still-original', frozen(AUTHOR, PACKET + '/WORKFLOWS.json') == compact(workflows) or document(AUTHOR, PACKET + '/WORKFLOWS.json') == workflows)
    check('workflows-byte-identical', frozen(AUTHOR, PACKET + '/WORKFLOWS.json') == frozen('a045139b62164dbae923475bdca93ef109b926ff', PACKET + '/WORKFLOWS.json'))
    w03 = next(row for row in workflows['rows'] if row['id'] == 'W03')
    telemetry = document(AUTHOR, OVERLAY + '/TELEMETRY.json')
    check('w03-exact-row-hash', digest(compact(w03)) == telemetry['originalWorkflowSha256'])
    check('w03-exact-expectation', w03['expected'] == telemetry['sharedExpectations'] and digest(compact(w03['expected'])) == telemetry['sharedExpectationSha256'])
    check('w03-script-and-input', telemetry['sharedScript'] == w03['script'] == 'timeout 0 cat | tee copied' and telemetry['sharedStdinBase64'] == w03['stdinBase64'] == 'AP9BCg2AAA==')
    check('w03-owned-chunk-arithmetic', telemetry['engines']['virtual-bash']['chunkLengths'] == [1, 2, 1, 3] and sum([1, 2, 1, 3]) == len(base64.b64decode(w03['stdinBase64'])))
    check('unsupported-comparator-remains-unqualified', all(telemetry['engines']['just-bash'][key] == 'UNQUALIFIED' for key in ['chunks', 'dispatch', 'iteratorCleanup', 'timers']))
    namespaces = document(AUTHOR, OVERLAY + '/NAMESPACES.json')['engines']
    for engine, expected in [('virtual-bash', (4, 0, 68, 65536)), ('just-bash', (191, 6436, 255, 71972))]:
        profile = namespaces[engine]
        check(engine + ':bounds', (len(profile['scaffolding']), profile['scaffoldingBytes'], profile['maxTotalEntries'], profile['maxTotalReadBytes']) == expected)
        check(engine + ':owned-budget', profile['maxWorkflowEntries'] == 64 and profile['maxWorkflowBytes'] == 65536 and profile['maxDepth'] == 32 and profile['maxSnapshotMetadataBytes'] == 131072)
        check(engine + ':scaffolding-unique-outside', len({entry['path'] for entry in profile['scaffolding']}) == len(profile['scaffolding']) and all(outside(entry) for entry in profile['scaffolding']))
        check(engine + ':payload-total', sum(entry.get('size', 0) for entry in profile['scaffolding'] if entry['type'] == 'file') == expected[1])
        reference = profile['provenance']
        data = frozen(reference['revision'], reference['path'])
        check(engine + ':historical-census-binding', digest(data) == reference['fileSha256'])
        report = json.loads(data)['report']
        for phase in ['before', 'after']:
            projection = [stable(entry) for entry in report[phase]['entries'] if outside(entry)]
            check(engine + ':historical-' + phase + '-projection', projection == profile['scaffolding'])
    reference = bindings['namespaceCrossChecks'][0]['provenance']
    report = document(reference['revision'], reference['path'])['report']
    check('column-crosscheck', all([stable(entry) for entry in report[phase]['entries'] if outside(entry)] == namespaces['just-bash']['scaffolding'] for phase in ['before', 'after']))
    amendment = bindings['setupAmendment']
    check('setup-accounting', amendment['semanticInvocations'] == 33 * 3 == 99 and amendment['targetSetupExecCeiling'] == 33 * 2 == 66 and amendment['extraC11SetupExecs'] == 2 and amendment['noCountersReset'] is True)
    controls = document(AUTHOR, OVERLAY + '/CONTROL-DELTA.json')
    control_source = frozen(AUTHOR, OVERLAY + '/controls.mjs').decode()
    check('twelve-concrete-families', re.findall(r"await control\('(C\d\d)'", control_source) == controls['familyIds'] == [f'C{number:02d}' for number in range(1, 13)])
    check('no-author-runtime-credit', all(value == 0 for value in bindings['executionCounts'].values()) and controls['executed'] == 0 and telemetry['executions'] == 0 and seal['actualAuthorization'] is False)
    reviewed = {
        AUTHOR: [OVERLAY + '/' + name for name in ['adapter.mjs', 'admission.mjs', 'namespace.mjs', 'telemetry.mjs', 'predicates.mjs', 'controls.mjs', 'control-extensions.mjs', 'README.md']],
        RECIPE: [PREPARATION + '/' + name for name in ['core.mjs', 'supervisor.mjs', 'observe-load.mjs', 'prepare.mjs', 'predicates.mjs']],
        '67eab12e315054907ef4ef435c6bbca2f59e0c36': ['src/shell/shell.ts'],
        'a045139b62164dbae923475bdca93ef109b926ff': [PACKET + '/EXECUTION.md'],
    }
    for commit, filenames in reviewed.items():
        for filename in filenames:
            frozen(commit, filename)
    observed_memberships = []
    for phase in ['before', 'after']:
        for filename, (expected_data, mode) in declared_live.items():
            data, actual_mode = live_bytes(filename)
            check(phase + ':current-declared:' + filename, data == expected_data and actual_mode == mode)
        overlay_members = members(OVERLAY)
        preparation_members = members(PREPARATION)
        check(phase + ':overlay-new-entry-guard', overlay_members == expected_members([*bound_files, 'SEAL.json', 'VALIDATION.json']))
        check(phase + ':preparation-new-entry-guard', preparation_members == expected_members(preparation_files))
        observed_memberships.append({'phase': phase, 'overlayEntries': len(overlay_members), 'preparationEntries': len(preparation_members), 'overlayMembershipSha256': digest(compact(overlay_members)), 'preparationMembershipSha256': digest(compact(preparation_members))})
    return {'checks': checks, 'artifacts': list(artifacts.values()), 'memberships': observed_memberships}


parser = argparse.ArgumentParser(description='Independent data-only review; never imports specimen code.')
parser.add_argument('--output', required=True)
arguments = parser.parse_args()
if not re.fullmatch(r'evidence-[a-z0-9-]+', arguments.output):
    parser.error('Choose a unique direct-child evidence-* name')
destination = OWNED / arguments.output
destination.mkdir(exist_ok=False)
initial = {'observedHeadNotAuthority': git('rev-parse', 'HEAD').decode().strip(), 'ownedStatus': git('status', '--porcelain=v1', '--', str(OWNED.relative_to(ROOT))).decode(), 'stagedPaths': git('diff', '--cached', '--name-only').decode().splitlines()}
failure = None
try:
    result = run()
except Exception as error:
    failure = {'type': type(error).__name__, 'message': str(error)}
    result = {'checks': checks, 'artifacts': list(artifacts.values())}
result.update(schema='independent-overlay-v2-static-review-v1', date=datetime.now(ZoneInfo('America/Chicago')).isoformat(), authorCommit=AUTHOR, priorReceiptCommit=PRIOR, authorSealSha256=SEAL_HASH, checkerSha256=digest(Path(__file__).read_bytes()), initialGit=initial, fault=failure, counts={'checks': len(checks), 'holds': sum(item['holds'] for item in checks), 'doesNotHold': sum(not item['holds'] for item in checks)}, executions={'product': 0, 'comparator': 0, 'nativeOracle': 0, 'timing': 0, 'controls': 0, 'repositoryModules': 0}, qualification='Static integrity/data statements only; not executable readiness, runtime passes, closure admission, or rootGO.')
(destination / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'output': str(destination.relative_to(ROOT)), 'counts': result['counts'], 'fault': failure}))
raise SystemExit(1 if failure or result['counts']['doesNotHold'] else 0)
