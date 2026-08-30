import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { authenticate, digest } from '../../candidate-v1/boundary-app.mjs';
import { additiveHoldouts } from './holdouts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const predecessor = 'a634bd339253b02cb85f9353c0b6cfda7195e3f7224ce65d1ee21ed00b7b2b65';
const prior = JSON.parse(authenticate(path.join(here, '../preparation-v3/SEAL.json'), predecessor));
for (const role of prior.roles) authenticate(path.join(own, role.path), role.sha256);
const scope = JSON.parse(authenticate(path.join(own, 's06-successor-v1/SCOPE-BINDING-v2.json'), prior.scopeSha256));
const names = new Set(prior.roles.map(role => role.path));
for (const name of ['SEAL.json','DATA-CAPTURE.json','PREPARATION-LAUNCH-CAPTURE.json']) names.add(`s06-successor-v1/preparation-v3/${name}`);
for (const name of fs.readdirSync(here).sort()) if (/\.(mjs|json|md)$/u.test(name) && !/^(?:SEAL|RESULT|CONTROL-CAPTURE|LAUNCH-CAPTURE|DATA-CAPTURE)/u.test(name)) names.add(`s06-successor-v1/preparation-v4/${name}`);
const roles = [...names].sort().map(name => {
  const filename = path.join(own, name); assert.equal(fs.realpathSync(filename), filename); const stat = fs.lstatSync(filename); assert.ok(stat.isFile());
  const bytes = fs.readFileSync(filename); return { path: name, bytes: bytes.length, mode: stat.mode & 0o777, sha256: digest(bytes) };
});
const roleFor = name => { const role = roles.find(row => row.path === `s06-successor-v1/preparation-v4/${name}`); assert.ok(role); return role; };
const harnessMutants = JSON.parse(fs.readFileSync(path.join(here, 'MUTANT-BINDING.json')));
for (const mutation of harnessMutants.variants) {
  let text = authenticate(path.join(here, 'controller.mjs'), mutation.originalSha256).toString();
  for (const edit of mutation.edits) { assert.equal(text.split(edit.before).length, 2, 'one exact harness mutation site'); text = text.replace(edit.before, edit.after); }
  assert.equal(digest(Buffer.from(text)), mutation.sha256); assert.equal(authenticate(path.join(here, mutation.file), mutation.sha256).toString(), text);
}
const appRoles = prior.appRoles.map(role => role.destination === 'worker.mjs' ? { destination: 'worker.mjs', ...roleFor('worker.mjs') } : role);
for (const name of ['holdouts.mjs','H12-OVERLAY.json']) appRoles.push({ destination: name, ...roleFor(name) });
const original = JSON.parse(fs.readFileSync(path.join(own, 'executor-v1/HOLDOUTS.json'))), overlay = JSON.parse(fs.readFileSync(path.join(here, 'H12-OVERLAY.json')));
const holdoutIds = additiveHoldouts(original, overlay).map(row => row.id); assert.equal(holdoutIds.length, 16);
const jobs = prior.jobs.map(job => job.layout && job.cohort === 'holdouts' ? { ...job, ids: holdoutIds } : job);
assert.equal(jobs.length, 26); assert.equal(jobs.filter(job => job.layout && job.cohort === 'holdouts').length, 3);
const faultNames = [...fs.readFileSync(path.join(here, 'controller-controls.mjs'), 'utf8').matchAll(/await check\('([^']+)'/gu)].map(match => match[1]); assert.equal(faultNames.length, 43); assert.equal(new Set(faultNames).size, 43);
const seal = { ...prior, kind: 'complete-array-successor-preparation-v4', status: 'repair and additive H12 preseal; NOT actual candidate GO', predecessorSealSha256: predecessor, roles, appRoles, node: scope.tools.node, cohorts: { ...prior.cohorts, holdouts: holdoutIds }, jobs,
  counts: { ...prior.counts, holdoutsPerLayout: 16, extraH12Held: 0, originalH12HeldHistoryPreserved: true, expectedTotalProcessesIncludingCoordinator: 346, maximumProcessesIncludingCoordinator: 374 },
  harnessMutants,
  preparation: { cases: faultNames, wholeControllerAndH12Controls: 43, loadedHarnessMutants: 2, positiveBeforeAfterPredicates: 4, noGrantRefusal: 1, maxPrimaryChildren: 6, maxNestedLaunchAttempts: 36, maxTotalChildren: 42, maxElapsedMs: 180000, maxChildCaptureBytes: 2097152, maxTotalCaptureBytes: 8388608, maxScratchBytes: 16777216, permitted: 'owned synthetic Node children only; no candidate build/install/compiler/runtime/native/private execution' },
  launch: { file: roleFor('dispatch.mjs').path, sha256: roleFor('dispatch.mjs').sha256, action: 'execute-array-successor-v4', arguments: ['ABSOLUTE_GO_FILE','GO_FILE_SHA256','THIS_SEAL_SHA256','UNIQUE_LABEL'], requiredGrantKeys: ['action','sealSha256','candidate','packageSha256','rootReceipt'], rootReceipt: 'real durable40-character grant commit supplied AFTER root release; dispatcher format-checks only, never invent approval' },
  deadline: { origin: 'performance.timeOrigin before initial admission/module execution; fixed110 minutes, no reset', totalElapsedMs: 6600000, publication: 'FINAL payload is provisional; acceptance additionally requires bounded terminal publication and zero coordinator exit', cooperativeQualification: 'pending publications are raced to remaining deadline; monotonic checks surround synchronous reads/writes. No claim to preempt an uncooperative kernel/host primitive. Deadline violations remain unsafe, never an extra passing tail.' },
  limitations: [...prior.limitations.filter(text => !text.startsWith('H12 assignment-context')), 'H12-v2 is root-ratified default-IFS project profile only; original H12 never ran and its held bytes remain untouched. No nondefault/empty IFS or native/G8 implication.', '43 whole-controller/H12 fault controls and two loaded harness mutants are not array runtime/mechanism acceptance. All actual candidate execution remains pending ROOT GO.'] };
const text = JSON.stringify(seal, null, 2) + '\n'; assert.equal(fs.existsSync(path.join(here, 'SEAL.json')), false);
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path.join(here, 'SEAL.json')}\n${text.slice(0,-1).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, timeout: 10000, maxBuffer: 1048576 });
console.log(JSON.stringify({ sealSha256: digest(Buffer.from(text)), dispatcherSha256: seal.launch.sha256, roles: roles.length, appRoles: appRoles.length, holdoutIds, primary: 73, gitExpected: 272, childCeiling: 373, includingCoordinator: 374, actualProductExecutions: 0 }));
