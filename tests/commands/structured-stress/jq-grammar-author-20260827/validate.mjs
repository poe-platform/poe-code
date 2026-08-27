import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync,readdirSync } from 'node:fs';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';
const directory='tests/commands/structured-stress/jq-grammar-author-20260827';
const prefix=process.argv[2];
assert.match(prefix,/^[a-z0-9-]+$/u);
const before=sourceSnapshot();
const jobs=[];
for(const mode of ['main','legacy','neighbors','extra','equality','context','arithmetic']) jobs.push([`${mode}-command`,'node','--import','tsx',`${directory}/replay.mjs`,mode,`${prefix}-${mode}.json`]);
for(const name of ['boundaries-1','boundaries-2','boundaries-3','author114','historical238','author-nearby117','author-evidence2','review-evidence4','author-safety-1','author-safety-2','author-safety-3']) {
  const prior=JSON.parse(readFileSync(new URL(`../jq-42-independent-final/r2-${name}.json`,import.meta.url)));
  jobs.push([name,...prior.command]);
}
const allTests=[];
function walk(path) {
  for(const entry of readdirSync(path,{withFileTypes:true})) {
    const child=`${path}/${entry.name}`;
    if(entry.isDirectory()) { if(child!==directory) walk(child); }
    else if(entry.name.endsWith('.test.ts')) allTests.push(child);
  }
}
walk('tests/commands/structured');walk('tests/commands/structured-stress');
jobs.push(['broad-unchanged','node','--unhandled-rejections=strict','--import','tsx','--test',...allTests.sort()]);
jobs.push(['new-author','node','--unhandled-rejections=strict','--import','tsx','--test',`${directory}/grammar.test.ts`,`${directory}/legacy.test.ts`,`${directory}/scan-boundaries.test.ts`,`${directory}/limits.test.ts`]);
jobs.push(['scoped-types','node','node_modules/typescript/bin/tsc','-p',`${directory}/tsconfig.json`,'--pretty','false']);
jobs.push(['global-types','npm','run','typecheck']);
jobs.push(['build-command','node',`${directory}/build-smoke.mjs`,`${prefix}-build.json`]);
const results=[];
for(const [name,...command] of jobs) {
  const result=spawnSync(process.execPath,[`${directory}/command.mjs`,`${prefix}-${name}`,...command],{encoding:'utf8',timeout:200000,maxBuffer:1024*1024});
  assert.ifError(result.error);console.log(result.stdout.trim());
  const recorded=JSON.parse(readFileSync(new URL(`${prefix}-${name}.json`,import.meta.url)));
  results.push({name,status:recorded.status,structuredStable:recorded.structuredStable,productStable:recorded.productStable,structuredBefore:recorded.before.structuredSha256,structuredAfter:recorded.after.structuredSha256,productBefore:recorded.before.productSha256,productAfter:recorded.after.productSha256});
}
const after=sourceSnapshot();
artifact(`${prefix}-checkpoint.json`,{before,after,results,structuredStable:results.every(row=>row.structuredStable&&row.structuredBefore===before.structuredSha256&&row.structuredAfter===before.structuredSha256),productStable:results.every(row=>row.productStable&&row.productBefore===before.productSha256&&row.productAfter===before.productSha256),caveat:'Author execution, not independent review. Stable phase hashes do not prove clean committed HEAD, absence of temporary ABA changes, or correctness of unrelated concurrently edited filesystem/shell code.'});
