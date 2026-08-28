import assert from 'node:assert/strict';
import path from 'node:path';
import { put, sha, regular } from '../common.mjs';
import { bindRetained, workers, here, parent, role } from './binding.mjs';

const { auth, oldSeal } = bindRetained();
const fixture = workers();
const originalCase = JSON.parse(regular(path.join(parent, 'CASES.json'))).literal.find(row => row.id === 'F11');
assert.deepEqual(originalCase, { id: 'F11', script: 'a=(stable); CDPATH=/search; cd project >/dev/null; pushd /w >/dev/null; popd >/dev/null; printf \'%s|%s\\n\' "$PWD" "$a"', stdout: '/search/project|stable\n', exitCode: 0 });
const roles = [...oldSeal.roles, ...['binding.mjs', 'prepare.mjs', 'run.mjs', 'DELTA.json', 'PRESEAL.md'].map(name => role(path.join(here, name))), role(path.join(parent, 'evidence-v1/AUDIT.json'))];
const policy = { ...oldSeal.policy, maxConcurrency: 1, totalElapsedMsIncludingCleanup: 300000, reservedCleanupMs: 45000, maxOtherSupervisedChildren: 8, maxProductWorkers: 8, maxTotalCapturedChildBytes: 16 * 1024 * 1024, maxWorkingBytes: 128 * 1024 * 1024, maxPersistedEvidenceBytes: 16 * 1024 * 1024 };
const seal = { kind: 'root-authorized F11-v2 continuation only', priorEvidence: '560394bb2df7ca2504ff9de965fc78f360da3746', candidate: auth.derived, base: auth.base, array: auth.array, packageSha256: auth.packageSha256, packageBytes: auth.packageBytes, members: 874, inputs: 272, roles, node: auth.node, correctedWorkerSha256: sha(fixture.corrected), originalWorkerSha256: sha(fixture.original), originalCase, policy, expectedChildren: 4, maximumChildren: 8, peak: 1, expectedRows: ['source-build-F11-v2', 'source-build-original-missing-parent', 'installed-F11-v2', 'moved-F11-v2'], label: 'COHERENT78-F11-V2-20260828-01', noBuildInstallCompiler: true, originalOutcomeUnchanged: '93/93 author,69/72 novel,30/30 types; original F11 failures remain' };
const bytes = Buffer.from(JSON.stringify(seal, null, 2) + '\n');
put(path.join(here, 'SEAL.json'), bytes);
console.log(JSON.stringify({ sealSha256: sha(bytes), candidate: seal.candidate, packageSha256: seal.packageSha256, children: 4, productExecutions: 0, originalWorkerSha256: seal.originalWorkerSha256, correctedWorkerSha256: seal.correctedWorkerSha256 }));
