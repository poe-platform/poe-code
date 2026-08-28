import base64
import gzip
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
OWN = ROOT / 'tests/integration/full-gate-20260827/unified76-driver-independent/supervisor-repair-v17'
PREFIX = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/'
SOURCE = 'f03c260269dfd8ee10666f7fd2560655f8e14a38'
BASE = 'e35d83ca97f6aa4f32b2cb8542f5e711458f6aeb'
EVIDENCE = '89c735fcdfe6e09bc88bb41535bad421e7e0cbd9'

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=20)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def blob(commit, name):
    return git('show', commit + ':' + name)

def normalized(value):
    return sha(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())

packet_path = 'tests/integration/full-gate-20260827/unified76-driver/supervisor-fault-v1/SOURCE-CANDIDATE.json'
packet = json.loads(blob(EVIDENCE, packet_path))
driver = json.loads(blob(SOURCE, PREFIX + 'DRIVER.json'))
assert normalized(driver) == 'aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424'
assert len(packet['files']) == 41
records = []
for expected in packet['files']:
    name = expected['path']
    data = blob(SOURCE, name)
    mode, kind, object_id = git('ls-tree', SOURCE, '--', name).decode().split('\t')[0].split()
    actual = dict(path=name, blob=object_id, mode=mode, bytes=len(data), sha256=sha(data))
    assert actual == expected and mode == '100644' and kind == 'blob'
    if name != PREFIX + 'DRIVER.json':
        assert driver['files'][name[len(PREFIX):]] == sha(data)
    actual['unchangedFromE35'] = data == blob(BASE, name)
    records.append(actual)
changed = [row['path'][len(PREFIX):] for row in records if not row['unchangedFromE35']]
assert sorted(changed) == ['DRIVER.json', 'supervise.mjs']
external_data = gzip.decompress(base64.b64decode(blob(SOURCE, PREFIX + 'EXTERNAL.json.gz.base64')))
external = json.loads(external_data)
fence = json.loads(blob(SOURCE, PREFIX + 'OS-INSTRUCTION-FENCE.json'))
tools = []
for name, expected in [
    ('/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node', '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0'),
    ('/bin/ps', '1e46cdb824858eb32e4c85ca920ba31b4541a814a133980d8b3484f39942276c'),
    (fence['binary']['path'], fence['binary']['sha256']),
]:
    file = pathlib.Path(name)
    actual = sha(file.read_bytes())
    assert actual == expected and not file.is_symlink()
    assert expected in json.dumps(external) or expected == fence['binary']['sha256']
    tools.append(dict(path=name, realpath=str(file.resolve()), sha256=actual, bytes=file.stat().st_size, mode=oct(file.stat().st_mode & 0o777)))
old_owned = {}
old_prefix = 'tests/integration/full-gate-20260827/unified76-driver-independent/'
for name in git('ls-tree', '-r', '--name-only', 'HEAD', '--', old_prefix).decode().splitlines():
    if '/supervisor-repair-v17/' not in name:
        assert (ROOT / name).read_bytes() == blob('HEAD', name)
        old_owned[name] = sha((ROOT / name).read_bytes())
result = dict(schema=1, source=SOURCE, base=BASE, evidence=EVIDENCE,
    harness=git('rev-parse', '63aae753').decode().strip(), preseal=git('rev-parse', '0f41d342').decode().strip(),
    requirementsCommit=git('rev-parse', 'caaa4012').decode().strip(),
    driverSha256=normalized(driver), effectiveProfileSha256=driver['profileSha256'],
    candidate=driver['candidate'], packageSha256=packet['expectedPackageSha256'],
    packet=dict(path=packet_path, sha256=sha(blob(EVIDENCE, packet_path))),
    files=records, changedShipping=changed, unchangedShipping=39,
    tools=tools, observerArgv=['-axo', 'pid=,ppid=,pgid=,lstart=,command='],
    externalDecodedSha256=sha(external_data), osQualification=fence,
    oldSupervisorSha256=sha(blob(BASE, PREFIX + 'supervise.mjs')),
    priorOwnedHashes=old_owned, gitIndexSha256=sha(git('diff', '--cached', '--binary')),
    controller=dict(path=sys.executable, realpath=str(pathlib.Path(sys.executable).resolve()), sha256=sha(pathlib.Path(sys.executable).read_bytes())),
    method='Pure Git/JSON/file hashing only. No candidate import or tool executable probe. Existing library metadata qualification carried, not fresh OS attestation.')
text = json.dumps(result, indent=2) + '\n'
patch = '*** Begin Patch\n*** Add File: ' + str(OWN.relative_to(ROOT) / 'BINDINGS.json') + '\n' + ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
subprocess.run(['apply_patch'], input=patch.encode(), cwd=ROOT, check=True)
print(json.dumps(dict(files=len(records), unchanged=39, changed=changed, tools=len(tools), priorArtifacts=len(old_owned), driver=result['driverSha256'])))
