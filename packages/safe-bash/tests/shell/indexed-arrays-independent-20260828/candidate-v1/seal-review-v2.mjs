import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { census, digest, verifyTree } from './boundary-app.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), work = path.join(here, 'observer-v2-run-HzBTcw');
const expected = new Map([
  ['RESULT.json', 'cfa98a0f8e14359cdd160fb316326d2ef88ada7cb2f096fa6bbd462868749dbc'],
  ['MECHANISMS-RESULT.json', '61ffc6ed8a27d158dc920562d0ff9a530608ac69ab3a3d04f4f306f11a303d3f'],
  ['layouts-v1/RESULT.json', '45d238f3c592c4aa9f7603a40c14de85daba71abfa0fd2e99e65c63a21377058'],
  ['mutants-v1/RESULT.json', '622b5d570add05f1b2b5cb2ef0394d12bedf1638066c7e66b079ee3b4d778f8f']
]);
const children = [], results = {};
for (const [name, hash] of expected) {
  const bytes = fs.readFileSync(path.join(work, name)); assert.equal(digest(bytes), hash);
  const result = JSON.parse(bytes); results[name] = result;
  if (result.install) children.push(result.install);
  if (result.outer) children.push(result.outer, result.capture.run);
  for (const row of result.runs ?? []) children.push(row.outer, row.capture.run);
}
assert.equal(children.length, 25); assert.equal(new Set(children.map(child => child.pid)).size, 25);
for (const child of children) {
  assert.ok(child.closeObserved && child.groupAbsent && !child.fault && !child.signal && !child.spawnError);
  assert.throws(() => process.kill(-child.pid, 0), error => error.code === 'ESRCH', 'no current group for captured owned child');
}
const sourceManifest = JSON.parse(fs.readFileSync(path.join(work, 'MECHANISMS-MANIFEST.json')));
const movedManifest = JSON.parse(fs.readFileSync(path.join(work, 'layouts-v1/moved-MANIFEST.json')));
for (const tree of [...sourceManifest.trees, ...movedManifest.trees]) verifyTree(tree);
assert.equal(digest(fs.readFileSync(sourceManifest.node.path)), sourceManifest.node.sha256);
const encodedTool = fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64'));
assert.equal(digest(encodedTool), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const decodedTool = gunzipSync(Buffer.from(encodedTool.toString(), 'base64'));
assert.equal(digest(decodedTool), '1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce'); verifyTool(JSON.parse(decodedTool));
const finalTree = { root: work, entries: census(work) }, records = {};
for (const [name, entry] of Object.entries(finalTree.entries)) {
  if (entry.directory) continue;
  const artifact = name.endsWith('.json') && !name.split('/').some(component => ['app', 'moved-app', 'selected-source', 'cache'].includes(component));
  const mutation = name === 'mutants-v1/U01/app/node_modules/virtual-bash/dist/shell/arrays/ledger.js';
  if (artifact || mutation) {
    const bytes = fs.readFileSync(path.join(work, name)); assert.equal(digest(bytes), entry.sha256);
    records[name] = { ...entry, base64: bytes.toString('base64') };
  }
}
for (const name of expected.keys()) assert.ok(records[name]);
const payload = Buffer.from(JSON.stringify({ kind: 'array-observer-v2-bounded-review-capture', finalTree, records, sourceCompleteness: '269 selected inputs bound by manifests, not a whole Git archive', retainedOriginalPackageCapsule: { path: 'ADMISSION-02.json.gz.base64', encodedSha256: '26f232de331bd326e018b2c152405777795c1ea982cd671bda8237c3ea2c8e5a', decodedSha256: 'adfc29d7b8df6b8fd350e4cc39eeb00fde0301bb13eda2be87a1e41000972288', packageSha256: sourceManifest.packageSha256 } }));
assert.ok(payload.length <= 48 * 1024 * 1024);
const encoded = Buffer.from(gzipSync(payload).toString('base64') + '\n'); assert.ok(encoded.length <= 8 * 1024 * 1024);
const output = path.join(here, 'OBSERVER-V2-REVIEW-01.json.gz.base64');
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${output}\n+${encoded.toString().trimEnd()}\n*** End Patch\n`, timeout: 30000, maxBuffer: 1024 * 1024 });
assert.equal(digest(fs.readFileSync(output)), digest(encoded));
const recovered = gunzipSync(Buffer.from(fs.readFileSync(output, 'utf8'), 'base64')); assert.equal(digest(recovered), digest(payload));
for (const record of Object.values(JSON.parse(recovered).records)) { const bytes = Buffer.from(record.base64, 'base64'); assert.equal(bytes.length, record.bytes); assert.equal(digest(bytes), record.sha256); }
verifyTree(finalTree);
const summary = { capturedRecords: Object.keys(records).length, encodedSha256: digest(encoded), decodedSha256: digest(payload), encodedBytes: encoded.length, decodedBytes: payload.length, node: sourceManifest.node, packageSha256: sourceManifest.packageSha256, childCount: children.length, children: children.map(({ pid, code, closeObserved, groupAbsent }) => ({ pid, code, closeObserved, groupAbsent })), finalStageEntries: Object.keys(finalTree.entries).length, originalCandidateTreesVerified: true, npmClosureVerified: true, unsafeStop: true, unsafeReason: 'Declared mutant compiled bytes lacked final LF; apply_patch staged LF, exact admission refused before mutant load', mutatedModulesLoaded: 0, mutantKills: 0, results: Object.fromEntries(expected), cleanup: { path: work, beforeCensusSha256: digest(Buffer.from(JSON.stringify(finalTree))), removed: false } };
fs.rmSync(work, { recursive: true }); assert.throws(() => fs.lstatSync(work), error => error.code === 'ENOENT'); summary.cleanup.removed = true;
const summaryPath = path.join(here, 'OBSERVER-V2-REVIEW-01-SUMMARY.json'), text = JSON.stringify(summary, null, 2) + '\n';
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${summaryPath}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, timeout: 10000 });
console.log(JSON.stringify({ summaryPath, encodedSha256: summary.encodedSha256, decodedSha256: summary.decodedSha256, records: summary.capturedRecords, childCount: children.length, cleanup: summary.cleanup, sha256: digest(Buffer.from(text)) }));
