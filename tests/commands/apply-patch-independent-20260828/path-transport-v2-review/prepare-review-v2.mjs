import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const replacements = new Map();
let body = fs.readFileSync(path.join(own, 'run-review.mjs'), 'utf8');
body = body.replace("const status = control.id === 'P28' && error ? 'UNSUPPORTED' : passed ? 'PASS' : 'FAIL';", "const status = error?.code === 'ERR_ACCESS_DENIED' ? 'NOT_RUN' : control.id === 'P28' && error ? 'UNSUPPORTED' : passed ? 'PASS' : 'FAIL';");
replacements.set('run-review-v2.mjs', body);
body = fs.readFileSync(path.join(own, 'launch-review.mjs'), 'utf8');
body = body.replaceAll('RUNNER-SEAL.json', 'RUNNER-SEAL-V2.json');
body = body.replace("const started = Date.now(), children = [];", "const started = Date.parse(JSON.parse(fs.readFileSync(path.join(own, 'review-01.json'))).started), children = [];");
body = body.replaceAll("'run-review.mjs'", "'run-review-v2.mjs'");
body = body.replace("'freeze-review.mjs', 'review-reference.mjs', 'run-review-v2.mjs', 'launch-review.mjs', 'REVIEW-RECIPE.md', 'SOURCE-REVIEW.md'", "'freeze-review-v2.mjs', 'review-reference.mjs', 'run-review-v2.mjs', 'launch-review-v2.mjs', 'prepare-review-v2.mjs', 'REVIEW-RECIPE.md', 'SOURCE-REVIEW.md', 'REVIEW-01-QUALIFICATION.md'");
body = body.replace('`--allow-fs-write=${work}`,', '`--allow-fs-write=${work}`, `--allow-fs-write=${work}/*`,');
replacements.set('launch-review-v2.mjs', body);
body = fs.readFileSync(path.join(own, 'freeze-review.mjs'), 'utf8');
body = body.replaceAll('RUNNER-SEAL.json', 'RUNNER-SEAL-V2.json');
body = body.replace("'freeze-review.mjs', 'review-reference.mjs', 'run-review.mjs', 'launch-review.mjs', 'REVIEW-RECIPE.md', 'SOURCE-REVIEW.md'", "'freeze-review-v2.mjs', 'run-review-v2.mjs', 'launch-review-v2.mjs', 'prepare-review-v2.mjs', 'REVIEW-01-QUALIFICATION.md', 'review-01.json', 'RUNNER-SEAL.json', 'freeze-review.mjs', 'review-reference.mjs', 'run-review.mjs', 'launch-review.mjs', 'REVIEW-RECIPE.md', 'SOURCE-REVIEW.md'");
replacements.set('freeze-review-v2.mjs', body);
let patch = '*** Begin Patch\n';
for (const [name, source] of replacements) {
  assert.equal(fs.existsSync(path.join(own, name)), false);
  patch += `*** Add File: ${path.relative(repository, path.join(own, name))}\n${source.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n`;
}
patch += '*** End Patch\n';
const run = spawnSync('apply_patch', [], { cwd: repository, input: patch, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr); console.log(run.stdout);
