import base64
import gzip
import hashlib
import json
import os
import pathlib
import stat
import subprocess

SOURCE = 'e35d83ca97f6aa4f32b2cb8542f5e711458f6aeb'
EVIDENCE = '149d0fcb550f160fcfbe290417ed7b5e0f70873f'
PRESEAL = '6b959e543d57eb88e550825cae9b276b6941d908'
PRIOR = '96daebc077381fb63ab6447a26ab707ce790ff25'
PRODUCT = 'f5e9fc49b6abb38e180cc9de16c95fced102ff75'
BASE = 'tests/integration/full-gate-20260827/unified76-driver/'
LAUNCHER = BASE + 'launcher-v3/'
OWNED = pathlib.Path('tests/integration/full-gate-20260827/unified76-driver-independent/historical-eligibility-v16/review-v1')

def git(*arguments):
    result = subprocess.run(['git', '--no-replace-objects', *arguments], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    assert len(result.stdout) <= 32 * 1024 * 1024
    return result.stdout

def blob(revision, path):
    return git('show', revision + ':' + path)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def compact(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()

def tree(revision):
    rows = {}
    for raw in git('ls-tree', '-rlz', revision).split(b'\0'):
        if not raw:
            continue
        metadata, path = raw.split(b'\t', 1)
        mode, kind, object_id, size = metadata.decode().split()
        assert kind == 'blob'
        rows[path.decode()] = dict(mode=mode, blob=object_id, bytes=int(size))
    return rows

packet_path = BASE + 'chmod-eligibility-v1/SOURCE-CANDIDATE.json'
packet = json.loads(blob(EVIDENCE, packet_path))
assert packet['source'] == SOURCE and packet['product'] == PRODUCT
assert packet['authorPreseal'] == PRESEAL[:8]
source_tree = tree(SOURCE)
prior_tree = tree(PRIOR)
product_tree = tree(PRODUCT)
seal = json.loads(blob(SOURCE, LAUNCHER + 'DRIVER.json'))
assert digest(compact(seal)) == packet['driverSha256'] == 'f192ca9330a440d33e49544e135a04305a48e84ce85858f902860aafa2ccd4f9'
assert len(packet['files']) == 41
assert {row['path'] for row in packet['files']} == {LAUNCHER + name for name in seal['files']} | {LAUNCHER + 'DRIVER.json'}
files = []
for claimed in packet['files']:
    path = claimed['path']
    metadata = source_tree[path]
    data = blob(SOURCE, path)
    assert metadata['mode'] == '100644'
    assert all(claimed[key] == metadata[key] for key in ('blob', 'bytes'))
    assert len(data) == metadata['bytes'] and digest(data) == claimed['sha256']
    name = path.removeprefix(LAUNCHER)
    if name != 'DRIVER.json':
        assert seal['files'][name] == digest(data)
    files.append({**claimed, 'mode': metadata['mode'], 'priorByteIdentical': path in prior_tree and metadata == prior_tree[path]})
assert sum(row['priorByteIdentical'] for row in files) == 32
strict_bytes = gzip.decompress(base64.b64decode(blob(SOURCE, LAUNCHER + 'PROFILE.json.gz.base64')))
assert digest(strict_bytes) == packet['strictProfileSha256']
strict = json.loads(strict_bytes)
assert compact(strict) == strict_bytes
assert blob(SOURCE, LAUNCHER + 'PROFILE.json.gz.base64') == blob(PRIOR, LAUNCHER + 'PROFILE.json.gz.base64')
policy = json.loads(blob(SOURCE, LAUNCHER + 'ELIGIBILITY.json'))
compressed = base64.b64decode(policy['captureBase64'])
assert compressed == blob('55db52a45e583017fba50c02ad64bddce2feb251', policy['binding']['source'])
assert digest(compressed) == policy['binding']['compressedSha256']
decoded = gzip.decompress(compressed)
assert digest(decoded) == policy['binding']['decodedSha256'] and len(decoded) == 6659
record = json.loads(decoded)
eligibility = dict(profile=policy['profile'], policySha256=digest(compact(policy)), binding=policy['binding'], status='HISTORICAL_UNQUALIFIED', freshCapabilityClaim=False, admissionProbesRepeated=False, nativeSemanticPassCount=None, automaticTestAttribution=False, canonicalSelectionChanged=False, obligations=[dict(id='NA-' + row['mode'], observation='HISTORICAL', status='UNSUPPORTED_HOST_OPERATION', nativeParity='UNQUALIFIED', scope='the recorded FILE operation only', original=row) for row in record['probes']], original=record)
assert digest(compact(eligibility)) == packet['historicalEligibilitySha256']
effective = {**strict, 'historicalEligibility': eligibility}
assert digest(compact(effective)) == packet['profileSha256'] == 'fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510'
assert strict['candidate'] == PRODUCT and len(strict['canonicalFiles']) == 632
scope = {row['path']: {key: row[key] for key in ('mode', 'blob', 'bytes')} for row in strict['scopeInputs']}
assert scope == product_tree
canonical = [{'path': path, **product_tree[path]} for path in strict['canonicalFiles']]
assert len(set(strict['canonicalFiles'])) == 632
assert strict['expectedPackageSha256'] == packet['expectedPackageSha256'] == 'c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd'
helper = 'tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs'
assert digest(blob(PRODUCT, helper)) == '60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db'
unchanged = ['os-instruction-fence.mjs', 'fenced-supervisor.mjs', 'OS-INSTRUCTION-FENCE.json', 'worker.mjs', 'phase-runner.mjs', 'process-observer.mjs', 'supervise.mjs', 'projection.mjs', 'INSTRUCTION-PROJECTION.json', 'TOOL-ROUTES.json', 'tool-routing.mjs', 'external.mjs', 'external-admission.mjs', 'EXTERNAL.json.gz.base64', 'EXTERNAL-RECEIPT.json', 'CANDIDATE.json']
for name in unchanged:
    assert blob(SOURCE, LAUNCHER + name) == blob(PRIOR, LAUNCHER + name)
external = json.loads(gzip.decompress(base64.b64decode(blob(SOURCE, LAUNCHER + 'EXTERNAL.json.gz.base64'))))
node = external['tools'][0]
assert node['origin'] == '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node'
observed = os.lstat(node['origin'])
assert stat.S_ISREG(observed.st_mode) and os.path.realpath(node['origin']) == node['physical']
hasher = hashlib.sha256()
with open(node['origin'], 'rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        hasher.update(chunk)
assert hasher.hexdigest() == node['sha256'] and observed.st_size == node['bytes'] and stat.S_IMODE(observed.st_mode) == node['mode']
runtime_modules = ['historical-eligibility.mjs', 'maintained-prerequisites.mjs', 'policy.mjs', 'tap.mjs', 'admission.mjs', 'common.mjs', 'profile.mjs', 'transport.mjs', 'projection.mjs', 'phase-runner.mjs', 'supervise.mjs', 'build-types.mjs', 'inventory.mjs']
runtime_data = ['ELIGIBILITY.json', 'CANDIDATE.json', 'PROFILE.json.gz.base64']
result = dict(schema=1, source=SOURCE, evidence=EVIDENCE, authorPreseal=PRESEAL, initialHead='d6369210fccf5623c786bd9d4c9409a6384d0ad3', observedAt='2026-08-28T06:49:01-0500', handoff=BASE + 'chmod-eligibility-v1/HANDOFF.md', packetPath=packet_path, packetSha256=digest(blob(EVIDENCE, packet_path)), driverSha256=packet['driverSha256'], effectiveProfileSha256=packet['profileSha256'], strictProfileSha256=packet['strictProfileSha256'], eligibilityReceiptSha256=packet['historicalEligibilitySha256'], historicalCaptureSha256=digest(decoded), files=files, unchangedRuntimeMembers=32, explicitlyUnchangedFenceRoutes=unchanged, canonicalCount=632, canonicalIdentitySha256=digest(compact(canonical)), completeLogicalMetadataEntries=len(scope), helperSha256=digest(blob(PRODUCT, helper)), node={**node, 'observedStat': dict(device=observed.st_dev, inode=observed.st_ino, mode=stat.S_IMODE(observed.st_mode), bytes=observed.st_size), 'freshHashOnlyNoProbe': True}, runtimeModules=runtime_modules, runtimeData=runtime_data, authoritiesNotReexecuted=['native51', 'OS/system-library qualifications', 'A10', 'package reproduction', 'full projection execution', 'private guards'], noCandidateImportsYet=True)
payload = json.dumps(result, indent=2) + '\n'
patch = '*** Begin Patch\n*** Add File: ' + str(OWNED / 'BINDINGS.json') + '\n' + ''.join('+' + line + '\n' for line in payload.splitlines()) + '*** End Patch\n'
subprocess.run(['apply_patch', patch], check=True)
print(json.dumps({key: result[key] for key in ('source', 'evidence', 'driverSha256', 'effectiveProfileSha256', 'strictProfileSha256', 'unchangedRuntimeMembers', 'canonicalCount', 'completeLogicalMetadataEntries')}))
