import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {root,work,owned,sha,save} from './safe-bash-five-review-tools.mjs';
assert.ok(existsSync('/tmp/safe-bash-five-source-checkpoint.ready'));
const destination=join(root,owned);
const snapshot=JSON.parse(readFileSync(join(work,'snapshot.json')));
save(join(destination,'snapshot-inputs.json'),{at:snapshot.at,cwd:snapshot.cwd,headBefore:snapshot.headBefore,headAfter:snapshot.headAfter,dirty:snapshot.dirty,index:snapshot.index,node:snapshot.node,closures:snapshot.closures,hashes:snapshot.frozen,beforeDigest:sha(JSON.stringify(snapshot.liveBefore)),afterDigest:sha(JSON.stringify(snapshot.liveAfter)),frozenDigest:sha(JSON.stringify(snapshot.frozen)),copyDrift:snapshot.copyDrift,copyDifferences:snapshot.copyDifferences});
const compact=name=> {
  const value=JSON.parse(readFileSync(join(work,name)));
  const {sourceBefore,sourceAfter,beforeRestoring,...record}=value;
  return {...record,inputHashReference:'snapshot-inputs.json',...(sourceBefore?{beforeDigest:sha(JSON.stringify(sourceBefore)),afterDigest:sha(JSON.stringify(sourceAfter))}:{}),...(beforeRestoring?{preHistoricalTestRestoreDigest:sha(JSON.stringify(beforeRestoring))}:{})};
};
for(const name of ['five-replay.json','target-verification.json','source-checkpoint.json','profile-correction.json','sgid-archive-check.json','independent-human-native.json','table-inputs.json']) save(join(destination,name),compact(name));
for(const name of ['safe-bash-five-readonly-audit.txt','safe-bash-five-source-review.txt']) save(join(destination,name),readFileSync('/tmp/'+name,'utf8'));
const scripts=['tools','replay','targets','archive-check','profile-correction','checkpoint','table-inputs','table','current-helper','archive'];
for(const name of scripts) save(join(destination,'scripts',`safe-bash-five-review-${name}.mjs`),readFileSync(`/tmp/safe-bash-five-review-${name}.mjs`,'utf8'));
const commands=JSON.parse(readFileSync(join(work,'target-verification.json'))).commands;
commands.push(JSON.parse(readFileSync(join(work,'profile-correction.json'))));
if(existsSync(join(work,'table-verification.json'))) {
  save(join(destination,'table-verification.json'),compact('table-verification.json'));
  commands.push(...JSON.parse(readFileSync(join(work,'table-verification.json'))).commands);
}
if(existsSync(join(work,'table-current-helper-verification.json'))) {
  save(join(destination,'table-current-helper-verification.json'),compact('table-current-helper-verification.json'));
  commands.push(JSON.parse(readFileSync(join(work,'table-current-helper-verification.json'))).command);
  save(join(destination,'safe-bash-five-table-helper-blocker.txt'),readFileSync('/tmp/safe-bash-five-table-helper-blocker.txt','utf8'));
}
const logs=commands.map(command=> {
  const stdout=readFileSync(join(work,command.name+'.stdout')),stderr=readFileSync(join(work,command.name+'.stderr'));
  assert.equal(sha(stdout),command.stdoutSha256);assert.equal(sha(stderr),command.stderrSha256);
  return {name:command.name,stdoutBase64:stdout.toString('base64'),stderrBase64:stderr.toString('base64'),stdoutSha256:sha(stdout),stderrSha256:sha(stderr)};
});
save(join(destination,'execution-logs.json'),logs);
console.log('Archived independent review evidence; commands with exact raw byte logs:',logs.length);
