import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, json, describe } from './common.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)); const repository = path.resolve(own, '../../../..');
const sourceCommit = process.argv[2]; assert.match(sourceCommit, /^[0-9a-f]{40}$/); assert.equal(process.argv.length, 3);
const bytes = fs.readFileSync(path.join(own, 'PRESEAL.json')); const seal = JSON.parse(bytes); const sealSha256 = sha(bytes);
for (const [name, expected] of Object.entries(seal.files)) assert.deepEqual(describe(path.join(own, name)), expected, name);
for (const [name, expected] of Object.entries(seal.sourceBindings)) assert.deepEqual(describe(path.join(repository, name)), expected, name);
const command = `exec -c ${seal.node.path} --no-warnings ${path.join(own, 'controller.mjs')} ${sourceCommit} ${sealSha256}`;
const grant = { binding: { authorization: 'ROOT AP753 ONE REVIEW', attempt: 1, candidate: seal.candidate, sealSha256, sourceCommit }, command, cwd: repository, login: false,
  authority: 'ROOT message received 2026-08-28: accepts557b61ed6/6+4/4+startuprefusals and authorizes concrete candidate753 review after complete54-job preseal committed, with no further root roundtrip if constraints fit. Exact source753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d/tree6a59ca403c5411344dea2ee057909ba179bf7043/full882f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95. ONE actual review;110min incl cleanup;70 all owned processes;peak4 total;128MiB combined capture;512MiB work;case30s/build120s. Safety/integrity/capture/unknown-retirement STOP without retry.',
  historicalIntegrity: 'All original58be27/70HOLD, peak>=3 violation,32+80 fixtures, all38/40 diagnostic history and intermediate harness HOLDs remain immutable. This grant neither accepts the product nor authorizes root/default integration.' };
const temporary = path.join(own, 'ROOT-GO.pending'); const target = path.join(own, 'ROOT-GO.json'); assert.equal(fs.existsSync(target), false);
const descriptor = fs.openSync(temporary, 'wx', 0o644); try { fs.writeFileSync(descriptor, json(grant)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
assert.equal(fs.existsSync(target), false); fs.renameSync(temporary, target);
const directory = fs.openSync(own, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
assert.deepEqual(JSON.parse(fs.readFileSync(target)), grant);
console.log(JSON.stringify({ command, workdir: repository, login: false, grant: describe(target), sealSha256, sourceCommit }));
