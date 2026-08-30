import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path('/Users/kjopek/Workspace/safe-bash')
PARENT = ROOT / 'tests/integration/full-gate-20260827/unified76-driver-independent/supervisor-repair-v17'
OWN = PARENT / 'continuation-v2'
PREFIX = 'tests/integration/full-gate-20260827/unified76-driver/launcher-v3/'
PRIOR = 'fb6f048d801935d7ebd79ff412f93c9eb387eb88'

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, timeout=20)

def sha(data):
    return hashlib.sha256(data).hexdigest()

old = json.loads(git('show', PRIOR + ':' + str((PARENT/'BINDINGS.json').relative_to(ROOT))))
files = []
for expected in old['files']:
    name = expected['path']
    data = git('show', old['source'] + ':' + name)
    mode, kind, object_id = git('ls-tree', old['source'], '--', name).decode().split('\t')[0].split()
    actual = dict(path=name, mode=mode, blob=object_id, bytes=len(data), sha256=sha(data), unchangedFromE35=data==git('show', old['base']+':'+name))
    assert actual == expected and mode == '100644' and kind == 'blob'
    files.append(actual)
driver = json.loads(git('show', old['source'] + ':' + PREFIX + 'DRIVER.json'))
assert sha(json.dumps(driver,separators=(',',':')).encode()) == old['driverSha256']
for tool in old['tools']:
    file=pathlib.Path(tool['path'])
    assert not file.is_symlink() and str(file.resolve())==tool['realpath']
    assert sha(file.read_bytes())==tool['sha256']
prior_hashes={}
scope='tests/integration/full-gate-20260827/unified76-driver-independent/'
for name in git('ls-tree','-r','--name-only',PRIOR,'--',scope).decode().splitlines():
    data=git('show',PRIOR+':'+name)
    assert (ROOT/name).read_bytes()==data
    prior_hashes[name]=sha(data)
result={key:old[key] for key in ['source','base','evidence','harness','driverSha256','effectiveProfileSha256','candidate','packageSha256','tools','observerArgv','osQualification']}
result.update(schema=2, priorSeal=PRIOR, initialHead=git('rev-parse','HEAD').decode().strip(), files=files,
    shippingCount=41, unchangedShipping=39, changedShipping=['supervise.mjs','DRIVER.json'],
    priorOwnedHashes=prior_hashes, priorBindingSha256=sha(git('show',PRIOR+':'+str((PARENT/'BINDINGS.json').relative_to(ROOT)))),
    initialIndexSha256=sha(git('diff','--cached','--binary')), initialIndexPaths=git('diff','--cached','--name-only').decode().splitlines(),
    controller=dict(path=sys.executable,realpath=str(pathlib.Path(sys.executable).resolve()),sha256=sha(pathlib.Path(sys.executable).read_bytes())),
    observation='2026-08-28 America/Chicago; post-original failed cohort, pre-continuation imports/controls. Metadata/hash only; no fresh native identity executable probes.')
text=json.dumps(result,indent=2)+'\n'
patch='*** Begin Patch\n*** Add File: '+str((OWN/'BINDINGS.json').relative_to(ROOT))+'\n'+''.join('+'+line+'\n' for line in text.splitlines())+'*** End Patch\n'
subprocess.run(['apply_patch'],input=patch.encode(),cwd=ROOT,check=True)
print(json.dumps(dict(files=41,unchanged=39,priorArtifacts=len(prior_hashes),tools=len(old['tools']))))
