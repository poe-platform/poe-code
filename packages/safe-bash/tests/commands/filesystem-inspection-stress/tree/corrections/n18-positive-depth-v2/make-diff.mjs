import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const before = await readFile(join(directory, 'history/v1-predicate.mjs'), 'utf8');
const after = await readFile(join(directory, 'n18-predicate.mjs'), 'utf8');
assert.equal(hash(before), 'f4671ade2c36b0c4aaa6fddf04f37d9ebe593f2d28aaadd8061f284ad12b0691');
assert.ok(before.endsWith('\n') && after.endsWith('\n'));
const oldLines = before.split('\n').slice(0, -1);
const newLines = after.split('\n').slice(0, -1);
const lengths = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1));
for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
  for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) lengths[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
    ? lengths[oldIndex + 1][newIndex + 1] + 1 : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
}
const operations = [];
let oldIndex = 0;
let newIndex = 0;
while (oldIndex < oldLines.length || newIndex < newLines.length) {
  const position = { oldLine: oldIndex + 1, newLine: newIndex + 1 };
  if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
    operations.push({ ...position, tag: ' ', text: oldLines[oldIndex++] }); newIndex++;
  } else if (newIndex < newLines.length && (oldIndex === oldLines.length || lengths[oldIndex][newIndex + 1] > lengths[oldIndex + 1][newIndex])) {
    operations.push({ ...position, tag: '+', text: newLines[newIndex++] });
  } else operations.push({ ...position, tag: '-', text: oldLines[oldIndex++] });
}
const regions = [];
for (const [index, operation] of operations.entries()) {
  if (operation.tag === ' ') continue;
  const start = Math.max(0, index - 3);
  const end = Math.min(operations.length, index + 4);
  const prior = regions.at(-1);
  if (prior && start <= prior.end) prior.end = end;
  else regions.push({ start, end });
}
const output = ['--- v1/n18-predicate.mjs', '+++ v2/n18-predicate.mjs'];
for (const region of regions) {
  const body = operations.slice(region.start, region.end);
  output.push(`@@ -${body[0].oldLine},${body.filter((entry) => entry.tag !== '+').length} +${body[0].newLine},${body.filter((entry) => entry.tag !== '-').length} @@`);
  output.push(...body.map((entry) => `${entry.tag}${entry.text}`));
}
const difference = `${output.join('\n')}\n`;
const metadata = { algorithm: 'bounded line LCS, minimum inserted/deleted line operations; context-only unified hunks',
  v1Sha256: hash(before), v2Sha256: hash(after), diffSha256: hash(difference),
  derivedRunnerSha256: hash(await readFile(join(directory, 'derived/run.mjs'))),
  copiedV1TestsSha256: hash(await readFile(join(directory, 'predicate.test.mjs'))),
  insertedLines: operations.filter((entry) => entry.tag === '+').length, deletedLines: operations.filter((entry) => entry.tag === '-').length, operations };
assert.equal(metadata.derivedRunnerSha256, '1fd45d8397f19122139c86c2d3321436346c90997448f997073029ef42ac11dd');
await writeFile(join(directory, 'helper.diff'), difference, { flag: 'wx' });
await writeFile(join(directory, 'helper-delta.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ v2PredicateSha256: metadata.v2Sha256, exactDiffSha256: metadata.diffSha256, insertedLines: metadata.insertedLines, deletedLines: metadata.deletedLines, unchangedDerivedRunner: true }));
