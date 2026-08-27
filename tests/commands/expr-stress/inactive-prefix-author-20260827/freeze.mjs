import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv[2], '--freeze', 'explicit --freeze required; never run by canonical tests');
const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const accepted = '21220b465537bf45ffcfb36740956a69f43bf75e';
const independent = 'e9ff18dcdd403c68550c9ad9ea69d2edce5403a3';
const prefix = 'tests/commands/expr-stress/sequencing-design-20260827';
const evaluator = 'src/commands/expr/evaluate.ts';
const test = 'tests/commands/expr/inactive-prefix.test.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
const source = git('show', `${accepted}:${evaluator}`);
assert.deepEqual(readFileSync(join(root, evaluator)), source, 'freeze before changing evaluator');
mkdirSync(join(owned, 'freeze'));
const files = {};
for (const [target, data] of [
  ['accepted-source.tar.gz', git('show', `${independent}:${prefix}/freeze/accepted-source.tar.gz`)],
  ['cases.json', git('show', `${independent}:${prefix}/freeze/cases.json`)],
  ['independent-driver.mjs', git('show', `${independent}:${prefix}/driver.mjs`)],
  ['independent-receipt.json', git('show', `${independent}:${prefix}/freeze/receipt.json`)],
  ['evaluate.before.ts.data', source],
  ['inactive-prefix.test.ts.data', readFileSync(join(root, test))],
]) {
  writeFileSync(join(owned, 'freeze', target), data, { flag: 'wx' });
  files[target] = hash(data);
}
const independentReceipt = JSON.parse(readFileSync(join(owned, 'freeze/independent-receipt.json')));
assert.equal(files['accepted-source.tar.gz'], independentReceipt.sourceArchiveSha256);
assert.equal(files['cases.json'], independentReceipt.casesSha256);
assert.equal(files['independent-driver.mjs'], independentReceipt.filesSha256['driver.mjs']);
writeFileSync(join(owned, 'freeze/receipt.json'), `${JSON.stringify({
  frozenAt: new Date().toISOString(), accepted, independent,
  liveHeadAtFreeze: git('rev-parse', 'HEAD').toString().trim(), evaluator, test, files,
  policy: 'Immutable accepted archive plus only new author test; candidate overlays only evaluate.ts. Other live files never copied. Compressed/data snapshots are not canonical TypeScript inputs.',
  authorDriverHashes: Object.fromEntries(['freeze.mjs', 'capture.mjs'].map(file => [file, hash(readFileSync(join(owned, file)))])),
}, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ accepted, independent, files }));
