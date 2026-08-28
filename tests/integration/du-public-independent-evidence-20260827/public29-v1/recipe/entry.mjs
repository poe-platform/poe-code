import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPublicCases, callableCaseIds } from './public-cases.mjs';
import { runExtra } from './runtime-cases.mjs';

const config = JSON.parse(readFileSync(process.env.DU_CONFIG));
const bindings = JSON.parse(readFileSync(new URL('./replay-bindings.json', import.meta.url)));
const r07 = JSON.parse(readFileSync(new URL('./R07.json', import.meta.url)));
const root = await import('virtual-bash');
const du = await import('virtual-bash/commands/du');
for (const name of ['createDuCommand', 'createDuCommands', 'duCommands']) assert.equal(root[name], du[name]);
assert.deepEqual(Object.keys(du).sort(), ['createDuCommand', 'createDuCommands', 'duCommands']);
let recorded = 0, details;
if (callableCaseIds.includes(config.caseId)) await runPublicCases({ root, du, bindings, selectedId: config.caseId, record: async row => { assert.equal(row.id, config.caseId); recorded++; details = row; } });
else { details = await runExtra(config.caseId, root, bindings, r07); recorded++; }
assert.equal(recorded, 1);
console.log(JSON.stringify({ id: config.caseId, profile: config.profile, status: 'assertions-and-owned-cleanup-completed', details, root: import.meta.resolve('virtual-bash'), du: import.meta.resolve('virtual-bash/commands/du'), node: process.version, actualCaseExecutions: 1 }));
