import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function verifyConsumerSelection(source,profile,read=path=>{
  const file=join(source,path),stat=lstatSync(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=8*1024*1024,'bounded current-consumer metadata/evidence input');return readFileSync(file);
}){
  const load=path=>import(pathToFileURL(join(source,path)));
  const{selectedPaths}=await load('tests/plugins/stream-five-public/harness.mjs');
  const{archiveInputs,currentConsumerPaths,negativeGroups,ownerPath}=await load('tests/plugins/qualified-current-release/consumers.mjs');
  const{verifyInventory}=await load('tests/plugins/qualified-current-release/inventory-check.mjs');
  const inventory=JSON.parse(read(join(ownerPath,'inventory.json'))),tracked=profile.scopeInputs.map(row=>row.path),currentPaths=currentConsumerPaths();
  const counts=verifyInventory(inventory,tracked,currentPaths,negativeGroups.map(group=>group.path),read);
  const selected=[...new Set([...selectedPaths,'README.md',ownerPath,'scripts/verify-current-consumers.mjs',...archiveInputs,...currentPaths,...negativeGroups.flatMap(group=>[group.path,group.expected])])];
  const tests=profile.scopeInputs.filter(row=>row.path.startsWith('tests/')&&!row.path.startsWith(ownerPath+'/evidence/')&&selected.some(prefix=>row.path===prefix||row.path.startsWith(prefix+'/')));
  assert.ok(tests.every(row=>row.mode!=='120000'&&row.bytes<=8*1024*1024),'all original selected consumer test files must fit the bounded metadata profile; never silently omit oversized files');
  return{inventory,counts,tests,selected,qualification:'Original candidate snapshot inventory validator and exact selection semantics executed without creating a second archive or build; larger whole-tree preservation stays with streamed guards.'};
}
