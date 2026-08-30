import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PRODUCT} from './policy.mjs';

export const ORIGINAL_BUILD = [
  '  assert.equal(existsSync(join(report.root, "dist")), false, "current consumer gate requires a cold isolated candidate");',
  '  step(report, "current-consumers-build", process.execPath, [compiler, "-p", "tsconfig.build.json"]);',
].join('\n');

export const REUSED_BUILD = [
  '  assert.equal(report.sourceCommit, "'+PRODUCT+'");',
  '  assert.equal(report.approvedBuild.candidate, report.sourceCommit);',
  '  assert.equal(report.approvedBuild.productionBuilds, 1);',
  '  assert.equal(report.approvedBuild.buildStatus, 0);',
  '  assert.deepEqual(manifest(report.root, "dist"), report.approvedBuild.files, "reuse exactly the driver-managed authenticated emitted package");',
  '  report.productionBuildsInThisPhase = 0;',
].join('\n');

const imports = Object.freeze([
  '../tests/plugins/stream-five-public/harness.mjs',
  '../tests/plugins/stream-five-public/current-profile.mjs',
  '../tests/plugins/qualified-current-release/consumers.mjs',
  '../tests/plugins/qualified-current-release/runtime-coverage.mjs',
  '../tests/plugins/qualified-current-release/snapshot.mjs',
]);

export function renderBuiltConsumerRunner(original, expectedSha256, sourceRoot) {
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(original),expectedSha256,'selected current-consumer runner bytes changed');
  assert.equal(original.split(ORIGINAL_BUILD).length,2,'exact historical cold/build seam required');
  let amended=original.replace(ORIGINAL_BUILD,REUSED_BUILD);
  const bindings=[];
  for(const specifier of imports){
    const before='from '+JSON.stringify(specifier)+';';
    assert.equal(amended.split(before).length,2,'explicit runner import must occur once');
    const physical=resolve(sourceRoot,'scripts',specifier),after='from '+JSON.stringify(pathToFileURL(physical).href)+';';
    amended=amended.replace(before,after);bindings.push({specifier,path:physical,after});
  }
  return{source:amended,originalSha256:expectedSha256,executedSha256:sha(amended),imports:bindings,buildReplacement:{before:ORIGINAL_BUILD,after:REUSED_BUILD},qualification:'Versioned external harness only. Product source and consumer fixture/config bodies remain unchanged. Controller must independently authenticate approvedBuild before invocation.'};
}

export function renderConsumerEntry(runner,input,report){
  return[
    "import{readFileSync,writeFileSync}from'node:fs';",
    'import{currentConsumers}from '+JSON.stringify(pathToFileURL(runner).href)+';',
    'const report=JSON.parse(readFileSync('+JSON.stringify(input)+'));',
    'try{currentConsumers(report);}finally{writeFileSync('+JSON.stringify(report)+',JSON.stringify(report,null,2)+'+JSON.stringify('\n')+",{flag:'wx'});}",
  ].join('\n')+'\n';
}
