import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { authenticateSourceTests, inventory } from './integrity.mjs';
import { addEvidence, owned, root, git, sha256, json, verifyFrozen } from './replay/review.mjs';

assert.equal(process.argv[2],'capture-and-cleanup');
const mode=process.argv[3];
assert(['preparation-only','candidate-executed'].includes(mode));
const report={mode,startedAt:new Date().toISOString(),freezeCommit:'d0fb3ef0bc9c3c04cae829a47454c10e565ad971',stages:[],protected:verifyFrozen(),cleanup:[],limits:'Complete source/test and installed inventories include added entries; no whole-repository or entire archive-tree append-proof claim.'};
const ownRoot=owned.replace(/\/replay$/,'');
const frozenNames=git('ls-tree','-r','--name-only',report.freezeCommit,'--',ownRoot).toString().trim().split('\n');
report.frozenFiles=frozenNames.map(path=>{const actual=sha256(readFileSync(path));assert.equal(actual,sha256(git('show',`${report.freezeCommit}:${path}`)));return{path,sha256:actual};});
const expectedFreeze=frozenNames.filter(path=>path.startsWith(`${ownRoot}/freeze/`)).map(path=>path.slice(`${ownRoot}/freeze/`.length)).sort();
assert.deepEqual(inventory(`${ownRoot}/freeze`).map(entry=>entry.path).sort(),expectedFreeze);
report.ownFreezeAddedEntriesChecked=true;
const devdeps=JSON.parse(readFileSync(`${owned}/devdeps-authentication.json`));
for(const tree of devdeps.currentToolTrees)assert.deepEqual(inventory(join(root,'node_modules',tree.path)).map(({path,sha256})=>({path,sha256})),tree.files);
report.developmentDependencyTreesUnchangedIncludingAddedEntries=true;
const stages=readdirSync(owned).filter(name=>existsSync(`${owned}/${name}/stage.json`)).map(name=>({label:name,...JSON.parse(readFileSync(`${owned}/${name}/stage.json`))}));
for(const stage of stages){
  assert(!stage.failure);
  const sourceTests=authenticateSourceTests(stage);
  const installed=inventory(stage.installed).map(({path,sha256})=>({path,sha256}));
  assert.deepEqual(installed,stage.installedFiles);
  assert.equal(sha256(readFileSync(join(stage.sourceRoot,'candidate.tar'))),stage.archiveSha256);
  assert.equal(sha256(readFileSync(join(stage.sourceRoot,stage.pack.filename))),stage.packageSha256);
  for(const input of stage.buildInputs)assert.equal(sha256(readFileSync(join(stage.source,input.path))),input.sha256);
  for(const input of stage.devtools)assert.equal(sha256(readFileSync(join(root,'node_modules',input.path))),input.sha256);
  const manifest={label:stage.label,commit:stage.commit,sourceTests,sourceTestsDigest:sha256(json(sourceTests)),installedFiles:installed,installedDigest:sha256(json(installed)),sourceTreeGitId:stage.sourceTreeGitId,archiveSha256:stage.archiveSha256,packageSha256:stage.packageSha256,sourceAndTestAddedEntriesChecked:true,installedAddedEntriesChecked:true};
  addEvidence(`${owned}/final-inventory-${stage.label}.json`,manifest);
  report.stages.push({...manifest,sourceTests:undefined,installedFiles:undefined});
}
for(const stage of stages)for(const path of [stage.sourceRoot,stage.destinationRoot]){
  assert(resolve(path).startsWith(`${resolve(tmpdir())}/expr-final-`));
  assert(path!==root&&!root.startsWith(`${path}/`));
  rmSync(path,{recursive:true});
  report.cleanup.push({path,removed:!existsSync(path),ownedStage:stage.label});
}
report.gitStatus=git('status','--short').toString();
report.completedAt=new Date().toISOString();
addEvidence(`${owned}/final-integrity-cleanup.json`,report);
console.log(json({mode,stages:report.stages.map(({label,commit})=>({label,commit})),cleanup:report.cleanup}));
