import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const owned = 'tests/commands/expr-stress/diagnostics-review';
const historical = 'tests/commands/expr-stress/extension-review/after-abort-fix/replay';
const harness = '50b1e560';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => spawnSync('git', args, {encoding:'utf8', maxBuffer:64*1024*1024});
const get = (commit, path) => { const result=git('show',`${commit}:${path}`); assert.equal(result.status,0,result.stderr); return result.stdout; };
const put = (path, data) => {
  assert(path.startsWith(`${owned}/`)); assert(!existsSync(path));
  const text=typeof data==='string'?data:json(data);
  const result=spawnSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line=>`+${line}`).join('\n')}\n*** End Patch\n`,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
};
const reviewOriginal=get(harness,`${historical}/review.mjs`);
const reviewBound=reviewOriginal.replaceAll(historical,`${owned}/replay`).replace("'../../../../../..'","'../../../../..'");
put(`${owned}/replay/review.mjs`,reviewBound);
const {nativeReplay, boundedNative, compare, verifyFrozen}=await import('./replay/review.mjs');
const before=verifyFrozen();
const nine=[];
for(const [id,commit,path] of [
  ['original95','35aa8054','tests/commands/expr-stress/frozen/evidence/original-20260827/oracle.json'],
  ['extension-original20','92fe8a63','tests/commands/expr-stress/extension-review/frozen/evidence/native-20260827/oracle.json']
]) {
  const receipt=JSON.parse(get(commit,path));
  const native=receipt.profiles.find(profile=>profile.id==='gnu-9.7-darwin-C');
  const baseline=JSON.parse(get(harness,`${historical}/acceptance-27a77935/${id}-report.json`)).profiles.find(profile=>profile.id===native.id);
  for(const expected of native.results) {
    const actual=baseline.results.find(row=>row.id===expected.id);
    if(expected.stderrBase64!==actual.stderrBase64) nine.push({cohort:id,originalCommit:commit,originalPath:path,profile:native.id,argv:expected.argvUtf8Hex.map(hex=>Buffer.from(hex,'hex').toString()),expected,oldObserved:actual,classification:'Historical observation only; never copied as new outcome.'});
  }
}
assert.equal(nine.length,9);
put(`${owned}/freeze/nine-unchanged.json`,nine);
const native=await nativeReplay();
assert.equal(native.qualification,'PASS NATIVE REPLAY ONLY',json(native));
put(`${owned}/freeze/native-original-replay.json`,native);
const inputs=JSON.parse(readFileSync(`${owned}/inputs.json`));
const original=JSON.parse(get('35aa8054','tests/commands/expr-stress/frozen/evidence/original-20260827/oracle.json'));
const fixture=mkdtempSync(join(tmpdir(),'expr-diagnostics-native-'));
const rows=[];
try {
  for(const input of inputs.native) {
    const expected=await boundedNative(original.identities.gnu.actualPath,input.argv,fixture,original.profiles[0].environment,'expr');
    assert.equal(expected.failure,null); assert.equal(expected.signal,null);
    rows.push({...input,argvUtf8Hex:input.argv.map(arg=>Buffer.from(arg).toString('hex')),expected});
  }
  assert.deepEqual(readdirSync(fixture),[]);
} finally { rmSync(fixture,{recursive:true}); }
put(`${owned}/freeze/independent-native.json`,{profile:'GNU9.7 Darwin/C, not GNU/Linux',identity:original.identities.gnu,environment:original.profiles[0].environment,rows,cleanup:{fixture,removed:!existsSync(fixture)}});
assert.deepEqual(verifyFrozen(),before);
put(`${owned}/freeze/seal.json`,{createdAt:new Date().toISOString(),candidateInspected:false,candidateAcceptance:0,baselineSource:'27a7793526830768484885afba5832bf8bb248b5',harnessCommit:git('rev-parse',`${harness}^{commit}`).stdout.trim(),nine:9,independentNative:rows.length,runtime:inputs.runtime.length,inputsSha256:hash(readFileSync(`${owned}/inputs.json`)),prepareSha256:hash(readFileSync(`${owned}/prepare.mjs`)),reviewBinding:{originalSha256:hash(reviewOriginal),boundSha256:hash(reviewBound),deltas:['owned output prefix','root depth only']},protectedFreezes:before,policy:'Exact C diagnostics closure separate from retained locale10/nullable5of8. AST-first precedence recorded, not forced fix. Runtime baseline observations must be captured before candidate inspection. No new regression expectations inspected.'});
console.log(json({frozen:true,nine:nine.length,independentNative:rows.length,runtime:inputs.runtime.length,nativeQualification:native.qualification}));
