import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { admit, census, digest, tarInventory, verifyTree } from './boundary-app.mjs';
import { supervise } from '../executor-v1/supervisor.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../../../..');
const prefix = 'tests/shell/indexed-arrays-independent-20260828/candidate-v1';
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
const preseal = git('log', '-1', '--format=%H', '--', `${prefix}/MUTANTS-V1-PRESEAL.md`).toString().trim();
for (const name of ['MUTANTS-V1-PRESEAL.md', 'mutant-phase-v1.mjs']) assert.equal(digest(fs.readFileSync(path.join(here, name))), digest(git('show', `${preseal}:${prefix}/${name}`)));
const work = path.join(here, 'observer-v2-run-HzBTcw'), priorPath = path.join(work, 'MECHANISMS-MANIFEST.json'), priorGo = path.join(work, 'MECHANISMS-GO.json');
assert.equal(digest(fs.readFileSync(path.join(work, 'MECHANISMS-RESULT.json'))), '61ffc6ed8a27d158dc920562d0ff9a530608ac69ab3a3d04f4f306f11a303d3f');
const prior = admit(priorPath, digest(fs.readFileSync(priorPath)), priorGo, digest(fs.readFileSync(priorGo))).manifest;
const encoded = fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64')); assert.equal(digest(encoded), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const decoded = gunzipSync(Buffer.from(encoded.toString(), 'base64')); assert.equal(digest(decoded), '1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce'); const npm = JSON.parse(decoded); verifyTool(npm);
const put = (filename, bytes, mode = 0o644) => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx', mode }); };
const phase = path.join(work, 'mutants-v1'); fs.mkdirSync(phase);
const report = { preseal, originalPackageSha256: prior.packageSha256, runs: [], variants: [], unsafeStop: false };
const controls = [
  { id: 'U01', predicate: 'M01', member: 'dist/shell/arrays/ledger.js', before: 'count > Number.MAX_SAFE_INTEGER - cursor', after: 'count > Number.MAX_SAFE_INTEGER', hitBefore: '            const count = requested === true ? 1 : requested;', hitAfter: '            __arrayMutantHit();\n            const count = requested === true ? 1 : requested;' },
  { id: 'U02', predicate: 'M04', member: 'dist/shell/arrays/bindings.js', before: '        if (--watch.observers !== 0)', after: '        __arrayMutantHit();\n        if (--watch.observers !== -1)' },
  { id: 'U04', predicate: 'M06', member: 'dist/shell/arrays/bindings.js', before: '        if (--this.references === 0)\n            this.admission.release();', after: '        __arrayMutantHit();\n        if (--this.references >= 0)\n            this.admission.release();' },
  { id: 'U12', predicate: 'M07', member: 'dist/shell/arrays/ledger.js', before: '        return this.completion;', after: '        __arrayMutantHit();\n        return this.completion.then(() => undefined);' }
];
function replaceOnce(text, before, after) { assert.equal(text.split(before).length, 2, 'exactly one mutation site'); return text.replace(before, after); }
function changedTar(original, target, replacement) {
  const raw = gunzipSync(original, { maxOutputLength: 64 * 1024 * 1024 }), blocks = []; let hits = 0;
  for (let offset = 0; offset + 512 <= raw.length && raw[offset] !== 0;) {
    const header = Buffer.from(raw.subarray(offset, offset + 512));
    const name = header.subarray(0, 100).toString().split('\0')[0], size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/su, '').trim(), 8);
    const data = name === `package/${target}` ? replacement : raw.subarray(offset + 512, offset + 512 + size);
    if (name === `package/${target}`) {
      hits++; header.fill(0, 124, 136); header.write(data.length.toString(8).padStart(11, '0'), 124, 'ascii');
      header.fill(32, 148, 156); const sum = header.reduce((total, value) => total + value, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    }
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512)); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(hits, 1); blocks.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(blocks));
}
async function run(label, manifest, ids, mutant) {
  const manifestPath = path.join(phase, `${label}-MANIFEST.json`), bytes = Buffer.from(JSON.stringify(manifest)), manifestSha = digest(bytes); put(manifestPath, bytes);
  const goPath = path.join(phase, `${label}-GO.json`), goBytes = Buffer.from(JSON.stringify({ action: 'execute-array-candidate', rootReceipt: preseal, candidate: manifest.candidate, manifestSha256: manifestSha })); put(goPath, goBytes);
  admit(manifestPath, manifestSha, goPath, digest(goBytes)); verifyTool(npm);
  const output = path.join(phase, `${label}-RUN.json`);
  const outer = await supervise(prior.node.path, [path.join(manifest.harnessRoot, 'run.mjs'), manifestPath, manifestSha, goPath, digest(goBytes), output, 'mechanical', JSON.stringify(ids)], { cwd: manifest.harnessRoot, env: { PATH: path.dirname(prior.node.path), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 180000, maxBytes: 2 * 1024 * 1024 });
  const capture = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : undefined; report.runs.push({ label, outer, capture });
  assert.ok(outer.closeObserved && outer.groupAbsent && !outer.fault && !outer.signal && !outer.spawnError && capture && !capture.unsafeStop, 'unsafe mutant/positive lifecycle or receipts');
  assert.equal(outer.code, 0); assert.equal(mutant ? capture.verdict.mutantKilled : capture.verdict.accepted, true);
  for (const tree of manifest.trees) verifyTree(tree); verifyTool(npm); assert.equal(digest(fs.readFileSync(prior.node.path)), prior.node.sha256);
}
try {
  await run('positive-before', prior, controls.map(control => control.predicate), false);
  const originalTar = fs.readFileSync(prior.packageTar), inventory = tarInventory(originalTar), appTree = prior.trees.find(tree => tree.root === prior.harnessRoot);
  for (const control of controls) {
    const directory = path.join(phase, control.id), app = path.join(directory, 'app'), artifacts = path.join(directory, 'artifacts');
    fs.mkdirSync(app, { recursive: true }); fs.mkdirSync(artifacts);
    for (const [name, entry] of Object.entries(appTree.entries)) {
      const destination = path.join(app, name);
      if (entry.directory) fs.mkdirSync(destination, { recursive: true, mode: entry.mode });
      else put(destination, fs.readFileSync(path.join(prior.harnessRoot, name)), entry.mode);
    }
    assert.deepEqual(census(app), appTree.entries);
    const memberPath = path.join(app, 'node_modules/virtual-bash', control.member), original = fs.readFileSync(memberPath, 'utf8');
    let changed = replaceOnce(original, control.before, control.after);
    if (control.hitBefore) changed = replaceOnce(changed, control.hitBefore, control.hitAfter);
    changed = `import { createHash as __arrayHash } from 'node:crypto';\nimport { readFileSync as __arrayRead } from 'node:fs';\nimport { fileURLToPath as __arrayPath } from 'node:url';\nlet __arrayHits = 0;\nfunction __arrayMutantHit() { if (++__arrayHits === 1) process.stdout.write(JSON.stringify({ activation: { id: ${JSON.stringify(control.id)}, path: __arrayPath(import.meta.url), sha256: __arrayHash('sha256').update(__arrayRead(new URL(import.meta.url))).digest('hex'), hits: 1 } }) + '\\n'); }\n` + changed;
    execFileSync('apply_patch', [`*** Begin Patch\n*** Update File: ${memberPath}\n@@\n${original.trimEnd().split('\n').map(line => '-' + line).join('\n')}\n${changed.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`], { cwd: repository, timeout: 10000 });
    assert.equal(fs.readFileSync(memberPath, 'utf8'), changed);
    const variant = changedTar(originalTar, control.member, Buffer.from(changed)), variantInventory = tarInventory(variant);
    assert.deepEqual(Object.keys(variantInventory), Object.keys(inventory));
    for (const name of Object.keys(inventory)) if (name !== control.member) assert.deepEqual(variantInventory[name], inventory[name]);
    assert.equal(variantInventory[control.member].mode, inventory[control.member].mode);
    const tarPath = path.join(artifacts, 'virtual-bash.tgz'); put(tarPath, variant);
    const type = JSON.parse(fs.readFileSync(prior.astTypes.receiptPath));
    const typePath = path.join(directory, 'DECLARATION-INHERITANCE.json');
    const inherited = { ...type, packageSha256: digest(variant), inheritedFrom: { path: prior.astTypes.receiptPath, sha256: prior.astTypes.receiptSha256 }, qualification: 'Identical declaration bytes/modes only; no variant compiler/build run', variant: control.id }; put(typePath, JSON.stringify(inherited));
    const remap = filename => filename.startsWith(prior.harnessRoot + '/') ? app + filename.slice(prior.harnessRoot.length) : filename === prior.packageTar ? tarPath : filename;
    const manifest = { ...prior, harnessRoot: app, packageRoot: path.join(app, 'node_modules/virtual-bash'), packageTar: tarPath, packageSha256: digest(variant), adapter: { path: remap(prior.adapter.path) }, requiredFiles: prior.requiredFiles.map(remap), trees: [{ root: app, entries: census(app) }, prior.trees.find(tree => tree.root === prior.sourceRoot), { root: artifacts, entries: census(artifacts) }], astTypes: { ...prior.astTypes, receiptPath: typePath, receiptSha256: digest(fs.readFileSync(typePath)) }, mutant: { id: control.id, path: memberPath, sha256: digest(Buffer.from(changed)), requiredFailed: [control.predicate] } };
    for (const key of ['rootModule','runtimeModule','rootDeclaration','workerModule','vectorsFile','controlsFile','holdoutsFile','baselineFile']) manifest[key] = remap(prior[key]);
    report.variants.push({ ...control, originalSha256: digest(Buffer.from(original)), changedSha256: digest(Buffer.from(changed)), packageSha256: digest(variant), members: Object.keys(variantInventory).length, unchangedMembers: Object.keys(inventory).length - 1 });
    await run(control.id, manifest, [control.predicate], true);
  }
  await run('positive-after', prior, controls.map(control => control.predicate), false);
  for (const tree of prior.trees) verifyTree(tree);
} catch (error) { report.unsafeStop = true; report.error = String(error?.stack ?? error); }
const bytes = Buffer.from(JSON.stringify(report)); put(path.join(phase, 'RESULT.json'), bytes);
console.log(JSON.stringify({ phase, unsafeStop: report.unsafeStop, runs: report.runs.map(row => ({ label: row.label, accepted: row.capture?.verdict.accepted, mutantKilled: row.capture?.verdict.mutantKilled, failed: row.capture?.verdict.failed, errors: row.capture?.verdict.errors })), error: report.error, sha256: digest(bytes) }));
process.exitCode = report.unsafeStop ? 78 : 0;
