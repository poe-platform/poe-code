import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const own=path.resolve('tests/compatibility/bash-ere-engine-independent-20260829/r01-v1');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const rootResult=JSON.parse(fs.readFileSync(path.join(own,'FINAL-RESULT.json'),'utf8'));
const deadline=1788004266367;if(Date.now()>deadline)throw new Error('inclusive publication deadline');
const rows=[];
for(const name of ['HANDOFF.md','FINAL-RESULT.json','GROUP-MAP.json','FINAL-PRESEAL.json','PRESEAL.md','launch.mjs','novel.mjs','summarize.mjs','summarize-v2.mjs','inspect-result.mjs','raw/summarize.stderr','raw/summarize-v2.stdout','ACTUAL-LAUNCH/events.jsonl']){
 const file=path.join(own,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16777216)throw new Error('evidence regular bound');const bytes=fs.readFileSync(file);rows.push({path:name,bytes:bytes.length,mode:stat.mode&511,sha256:sha(bytes)});
}
const bytes=fs.readFileSync(rootResult.result.sourceResult);if(sha(bytes)!==rootResult.result.resultSha256)throw new Error('result changed');
const record={sourceCommit:rootResult.sourceCommit,verdict:rootResult.verdict,presealCommit:rootResult.presealCommit,productResultSha256:sha(bytes),rows,publication:new Date().toISOString(),inclusiveDeadline:deadline,actualKnownExecutionGraph:36,sourcePhaseKnownStartsUpperBound:40,actualPhaseKnownStartsIncludingPublicationUpperBound:60,capKnownActualStarts:96,productReruns:0};
fs.writeFileSync(path.join(own,'FINAL-SEAL.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(record));
