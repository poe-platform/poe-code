import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {root,work,sha,save} from './safe-bash-five-review-tools.mjs';
const priorRoot='/tmp/safe-bash-table-review-owned/closed';
const previous=JSON.parse(readFileSync(join(root,'tests/commands/table-text-stress/review/acceptance.json')));
const inputs=JSON.parse(readFileSync('/tmp/safe-bash-table-review-owned/closed-inputs.json'));
const author=previous.commands.find(command=>command.name==='closed-author311').args.filter(path=>path.endsWith('.test.ts'));
const independent=previous.commands.find(command=>command.name==='closed-independent').args.filter(path=>path.endsWith('.test.ts'));
const dependencyPaths=['tests/commands/table-text-stress/support.ts','tests/commands/table-text-stress/cases.ts','tests/commands/table-text-stress/frozen-corpus.json','tests/commands/table-text-stress/first-discrepancy.json','tests/commands/table-text-stress/tsconfig.json','tests/integration/adapter-tools-diagnostics/reference.json','tests/integration/adapter-tools/fixtures.ts','tests/integration/adapter-tools/preflight-review/preflight.ts','tests/fs/webdav/mock.ts','tests/commands/structured-stress/split-increment/evidence.ts','tests/commands/structured-stress/split-increment/native.json','tests/commands/structured-stress/final-increment/fresh-native.json'];
const paths=[...new Set([...author,...independent,...dependencyPaths,...Object.keys(inputs.frozen).filter(path=>path.startsWith('tests/commands/table-text/')||path.startsWith('src/commands/table-text/'))])];
const records=[];
for(const path of paths) {
  assert.ok(existsSync(join(priorRoot,path)),path);
  const bytes=readFileSync(join(priorRoot,path));
  assert.equal(sha(bytes),inputs.frozen[path],path);
  save(join(work,'table-frozen',path),bytes.toString());
  assert.equal(sha(readFileSync(join(work,'table-frozen',path))),inputs.frozen[path]);
  records.push({path,frozenSha256:sha(bytes),currentSha256:sha(readFileSync(join(root,path)))});
}
const originalBuilt=readFileSync('/tmp/safe-bash-table-review-built.mjs','utf8');
save(join(work,'table-frozen/built-replay.mjs'),originalBuilt);
save(join(work,'table-inputs.json'),{at:new Date().toISOString(),priorRoot,priorAcceptanceSha256:sha(readFileSync(join(root,'tests/commands/table-text-stress/review/acceptance.json'))),author,independent,records,builtReplaySha256:sha(originalBuilt),priorMutationProof:'tests/commands/table-text-stress/review/mutation-results-verified.json',limitation:'Preparation only; no table corpus execution before root phase release.'});
console.log(JSON.stringify({prepared:records.length,drift:records.filter(row=>row.currentSha256!==row.frozenSha256)}));
