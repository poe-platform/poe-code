import base64
import collections
import datetime
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[3]

def sha(data): return hashlib.sha256(data).hexdigest()

def census(root):
    result = []
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink()
        result.append({'path': str(path), 'directory': True, 'bytes': 0} if path.is_dir() else
                      {'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())})
    return result

def add(name, value):
    text = json.dumps(value, indent=2) + '\n'
    patch = '*** Begin Patch\n*** Add File: ' + str((ROOT/name).relative_to(REPO)) + '\n'
    patch += ''.join('+' + line + '\n' for line in text.splitlines()) + '*** End Patch\n'
    subprocess.run(['apply_patch'], input=patch, text=True, cwd=REPO, check=True)

seal = json.loads((ROOT/'PRESEAL.json').read_text())
for row in seal['files']: assert sha((ROOT/row['path']).read_bytes()) == row['sha256']
old = []
for tree in seal['oldTrees']:
    actual = census(pathlib.Path(tree['root'])); assert actual == tree['rows'], tree['root']
    old.append({'root': tree['root'], 'entries': len(actual), 'directories': sum(row.get('directory',False) for row in actual), 'unchanged': True})
transforms = json.loads((ROOT/'TRANSFORMS.json').read_text())
for item in transforms['moduleTransforms']:
    original = base64.b64decode(item['originalBase64']).decode(); assert sha(original.encode()) == item['originalSha256']
    altered = original
    for change in item['changes']:
        assert altered.count(change['before']) == 1
        altered = altered.replace(change['before'], change['after'])
    assert sha((item['prefix'] + altered).encode()) == item['transformedSha256']
    assert item['prefix'] + altered == base64.b64decode(item['transformedBase64']).decode()
    for change in reversed(item['changes']): altered = altered.replace(change['after'],change['before'],1)
    assert altered == original
case = transforms['caseOverlay']; altered = (ROOT/'cases.mjs').read_text()
assert sha(altered.encode()) == case['transformedSha256']
altered = altered[len(case['prefix']):]
for change in reversed(case['changes']): altered = altered.replace(change['after'],change['before'],1)
assert sha(altered.encode()) == case['sha256']
receipt = json.loads((ROOT/'RUN-01/RECEIPT.json').read_text())
assert receipt['status'] == 'PASS' and receipt['boundsSatisfied']
for child in receipt['children']:
    assert child['exit']['code'] == 0 and child['exit']['signal'] is None
    assert child['cleanupSettled'] and child['closeObserved'] and child['stdoutClosed'] and child['stderrClosed']
    assert child['signals'] == []
raw = [json.loads(line) for line in (ROOT/'RUN-01/child-2.stdout.jsonl').read_text().splitlines()]
cases = [row for row in raw if row['kind'] == 'case']
assert [row['id'] for row in cases] == ['A57','A60','H09'] and all(row['passed'] for row in cases)
summary = next(row for row in raw if row['kind']=='summary'); assert summary['unrun'] == []
modules = json.loads((ROOT/'RUN-01/MODULES.json').read_text())
assert sha((ROOT/'RUN-01/MODULES.json').read_bytes()) == receipt['moduleManifestSha256BeforeLoad']
member_map = {row['path']:row for row in modules['files']}
for row in modules['files']: assert sha(pathlib.Path(row['path']).read_bytes()) == row['sha256']
loads = [json.loads(line) for line in (ROOT/'RUN-01/loads.jsonl').read_text().splitlines()]
from urllib.parse import unquote, urlparse
for row in loads:
    if row['kind']=='module-load': assert row['sha256'] == member_map[unquote(urlparse(row['url']).path)]['sha256']
assert sum(row.get('role')=='instrumented-emitted-module' for row in loads)==5
scope_rows = []
for row in cases:
    report = row['afterNotification']; events = report['events']; counts = dict(collections.Counter(event['event'] for event in events))
    assert report['valid'] and row['restoration']['restored'] and row['restoration']['valid']
    assert all(resource['closed'] and resource['destroyed'] and resource['closeDelivered'] and not resource['returnPending'] and not resource['readerPending'] for resource in report['resources'])
    assert all(context['verdict']=='PASS' for context in report['contexts'])
    scope_rows.append({'id':row['id'], 'classification':row['classification'], 'passed':row['passed'], 'elapsedMs':row['elapsedMs'],
                      'streams':len(report['resources']), 'contexts':len(report['contexts']), 'eventCount':len(events), 'identityCount':report['identityCount'],
                      'eventsByRole':counts, 'beforeNotification':row['beforeNotification']['resources'],
                      'afterNotification':report['resources'], 'restoration':row['restoration']})
index = subprocess.check_output(['git','diff','--cached','--name-status','-z'],cwd=REPO).decode(); assert index == seal['foreignIndexBefore']
clock = json.loads((ROOT/'RUN-01/PUBLICATION-CLOCK.json').read_text())
capture = census(ROOT/'RUN-01')
prep_wall = (datetime.datetime.fromisoformat(seal['frozenWall'])-datetime.datetime.fromisoformat(seal['preparationFirstWall'].replace('Z','+00:00'))).total_seconds()*1000
audit = {'classification':'postrun DATA audit; no additional candidate execution', 'presealCommit':'d89960828b9945900f09344a80c7ca9397de5b7d',
 'hashes':{name:sha((ROOT/name).read_bytes()) for name in ['PRESEAL.json','adapter.mjs','TRANSFORMS.json','loader.mjs','compile.mjs','bootstrap.mjs','worker.mjs','RUN-01/MODULES.json','RUN-01/loads.jsonl']},
 'candidateGit':seal['candidateGit'],'derivedBase':seal['base'],'composition':seal['sourceSelection'],'runtimeRebase':transforms['runtimeRebase'],
 'result':summary,'cases':scope_rows,'actualLoads':loads,'emittedTransforms':modules['transforms'],
 'loadCounts':dict(collections.Counter(row['kind'] for row in loads)),
 'actualModuleRoles':dict(collections.Counter(row.get('role') for row in loads if row['kind']=='module-load')),
 'resources':{'totalProcesses':3,'spawnedDirectChildren':2,'syntaxChildren':0,'negativeControlChildren':0,'peak':2,
 'allNaturalExitZero':True,'signals':[],'childAndStdioClosed':True,'inclusiveBeforeReceiptMs':receipt['inclusiveBeforeReceiptMs'],
 'afterReceiptWriteMs':clock['afterReceiptWriteMs'],'finalClockWriteTailMeasured':False,
 'captureBytesIncludingReceipts':sum(row['bytes'] for row in capture if '/app/' not in row['path']),
 'emittedWorkBytes':sum(row['bytes'] for row in capture if '/app/' in row['path']),
 'ownedBytesBeforeAuditPublication':sum(row['bytes'] for row in census(ROOT)),
 'preparationObservedWallMs':prep_wall,'preparationSuccessfulScriptMs':seal['preparationScriptMs'],'preparationAttempts':seal['preparationAttempts']},
 'oldTrees':old,'foreignIndexPreserved':True,'captures':capture,
 'dynamicCoverageLimits':['acquire-close-hook and finalizer-close-hook installation branches were not taken; their joins were observed',
 'writer-close-delivered fallback was not taken; all15 raw write callbacks occurred; prior19+5 and12 controls remain separate evidence',
 'only A57/A60/H09 candidate routes executed; no independent acceptance or unmodified semantic credit',
 'all71 capacity planning is finite and fail-closed, not proof every unexecuted schedule fits'],
 'noNativeAllocationOrUniversalCleanupClaim':True}
add('AUDIT.json',audit)
prior=json.loads((ROOT.parent/'adapter-v9/CONTINUATION-PROPOSED.json').read_text())
proposal={'status':'UNAPPROVED_PROPOSAL_FOR_PLATO_REVIEW; 284 EXECUTION HELD','authorPilotPreseal':audit['presealCommit'],
 'candidateGit':seal['candidateGit'],'derivedBase':seal['base'],'packageSha256':json.loads((ROOT/'PACKAGE-DATA.json').read_text())['packageSha256'],
 'bindingHashes':audit['hashes'],'exactModuleIdentities':modules['files'],'instrumentedMembership':{'completedAuthorOnly':['A57','A60','H09'],'streams':15,'unmodifiedSemanticCredit':0},
 'independentNextReview':{'scope':'review these exact source/loaded hashes, route/raw events and bounded author pilot; any replay needs independent preseal/ROOT authority','commandPromoted':False},
 'unmodifiedSemanticContinuation':{'layouts':[{'name':name,'groups':[f'A{number:02}' for number in range(1,61)]+[f'H{number:02}' for number in range(1,12)]} for name in ['source','compiled','manual-staged','physically-moved']],
 'totalGroups':284,'oldSourceRepeated':69,'oldUnexecutedStillUnrun':215,'directChildren':15,
 'otherChildren':{'typesPositive':1,'typesNegative':4,'mutants':3,'bindingNegatives':3},'nativeGitHeld':6,
 'exactPriorRecipeData':prior['priorExactRecipeData'],'executeCommand':None,
 'requirements':['original candidate source/emits for all four semantic layouts; NEVER v10 instrumented emits silently substituted',
 'separate proposed source-conditional private-writer join proof vs directly observed mechanical probes',
 'Plato review of full71 route/capacity treatment, including unexecuted direct Session/Real/cancellation/error paths',
 'new exact source loader/worker semantic-observer binding and finite600s/32MiB/256MiB/peak2/15-child seal before any284 execution']},
 'readiness':'three-case mechanical integration implemented and author-qualified; full284 executable semantic gate NOT yet sealed/admitted',
 'remainingBoundary':'instrumented private-Promise proof cannot supply dynamic private timestamps in unchanged modules; full71 conditional proof and noninstrumented worker integration require independent review',
 'historyPreserved':{'v5Created':289,'v5CloseEvents':288,'v5SemanticPasses':69,'v5Unexecuted':215,'v6Failure':'R02','v7Failure':'R05','old19Plus5':'unchanged','v9Controls12':'unchanged'}}
add('CONTINUATION-PROPOSED.json',proposal)
print(json.dumps({'hashes':audit['hashes'],'result':summary,'resources':audit['resources'],'actualModuleRoles':audit['actualModuleRoles']},indent=2))
