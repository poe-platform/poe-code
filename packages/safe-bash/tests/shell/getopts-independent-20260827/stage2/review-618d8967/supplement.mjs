import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { own, work, save, inventory, run } from './harness.mjs';

const packed = JSON.parse(fs.readFileSync(path.join(work, 'PACKAGE.json')));
const { moved, product } = packed;
for (const name of ['middleware-correction-v3.mjs', 'mutant-loader.mjs']) fs.copyFileSync(path.join(own, name), path.join(moved, name));
const rows = [];
rows.push(await run('middleware-corrected-v3', [process.execPath, '--test', path.join(moved, 'middleware-correction-v3.mjs')], moved));
for (const [id, pattern] of [['cursor-publication', '^frozen N05:'], ['task-checkpoint', '^I08 tiny final flush']]) {
  rows.push(await run(`mutant-${id}`, [process.execPath, '--unhandled-rejections=strict', '--experimental-loader', path.join(moved, 'load-audit.mjs'), '--experimental-loader', path.join(moved, 'mutant-loader.mjs'), '--test', '--test-name-pattern', pattern, path.join(moved, 'independent-public.mjs')], moved, { env: { REVIEW_PACKAGE: product, REVIEW_SOURCE: path.join(work, 'source'), REVIEW_OWN: own, REVIEW_OBSERVATIONS: path.join(work, `mutant-${id}-observations.json`), REVIEW_TRACE: path.join(work, `mutant-${id}-loads.jsonl`), REVIEW_MUTANT: id, REVIEW_MUTANT_RECORD: path.join(work, `mutant-${id}-binding.json`) } }));
}
assert.deepEqual(inventory(product), packed.installed);
save(path.join(work, 'SUPPLEMENT.json'), { rows, installedUnchangedIncludingNewEntries: true, classification: 'Separate corrected D03 control and two bounded in-memory mutants using already passing frozen controls; never product fixes or new candidate identities.' });
