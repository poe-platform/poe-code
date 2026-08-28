import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const own = path.dirname(fileURLToPath(import.meta.url));
const old = path.join(path.dirname(own), 'candidate-753-review-executor-v1');
const repository = path.resolve(own, '../../../..');
function text(directory, name, maximum = 200000) {
  assert.match(name, /^[A-Za-z0-9_.-]+\.(mjs|json)$/);
  const filename = path.join(directory, name), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= (name === 'VARIANTS.json' ? 404120 : maximum));
  const value = new TextDecoder('utf8', { fatal: true }).decode(fs.readFileSync(filename)); assert.ok(!value.includes('\0')); return value;
}
function replace(source, before, after) { assert.equal(source.split(before).length, 2, before); return source.replace(before, after); }
const names = ['common.mjs', 'path-bytes.mjs', 'composition.mjs', 'package-data.mjs', 'dispatch.mjs', 'legacy.mjs', 's54.mjs', 'variants.mjs', 'guard.mjs', 'build.mjs', 'BINDINGS.json', 'PACKAGE-INVENTORY.json', 'JOBS.json', 'VERSIONED-ROWS.json', 'VARIANTS.json'];
const bodies = Object.fromEntries(names.map(name => [name, text(old, name)]));
let loader = text(old, 'loader.mjs');
loader = "import { decode } from './manifest.mjs';\n" + loader;
loader += '\nexport function installPacketLoader(packet, authority) { const job = decode(packet, authority); return { job, loads: installLoader(job) }; }\n';
bodies['loader.mjs'] = loader;
let bootstrap = text(old, 'bootstrap.mjs');
bootstrap = replace(bootstrap, "import { installLoader } from './loader.mjs';", "import { installLoader } from './loader.mjs';\nimport { readPacket } from './manifest.mjs';\nimport { authority } from './authority.mjs';");
bootstrap = replace(bootstrap, 'const job = JSON.parse(fs.readFileSync(process.argv[2]));', 'const job = readPacket(process.argv[2], authority);');
bodies['bootstrap.mjs'] = bootstrap;
let controller = text(old, 'controller.mjs');
controller = "import { encode, serialize, measure, frameSize, CAP } from './manifest.mjs';\nimport { authority } from './authority.mjs';\n" + controller;
controller = replace(controller, "for (const name of ['bootstrap.mjs', 'loader.mjs', 'dispatch.mjs', 'legacy.mjs', 's54.mjs'])", "for (const name of ['bootstrap.mjs', 'loader.mjs', 'manifest.mjs', 'authority.mjs', 'dispatch.mjs', 'legacy.mjs', 's54.mjs'])");
controller = replace(controller, "['guard.mjs', 'loader.mjs', 'common.mjs']", "['guard.mjs', 'loader.mjs', 'manifest.mjs', 'common.mjs']");
controller = replace(controller, "['bootstrap.mjs', 'loader.mjs', 'dispatch.mjs', 'legacy.mjs', 's54.mjs', 'author.mjs'", "['bootstrap.mjs', 'loader.mjs', 'manifest.mjs', 'authority.mjs', 'dispatch.mjs', 'legacy.mjs', 's54.mjs', 'author.mjs'");
controller = replace(controller, 'graphs.push({ ...variant, changes: undefined, bindings: undefined, product, manifest });', 'const { changes, bindings, ...metadata } = variant; graphs.push({ ...metadata, product, manifest });');
controller = replace(controller, 'runtimeJobs.push({ ...planned, consumer, filename, code, diagnostic, binding: describe(filename) });', 'runtimeJobs.push({ ...planned, consumer, filename, code, ...(diagnostic === undefined ? {} : { diagnostic }), binding: describe(filename) });');
controller = replace(controller, 'put(filename, job);', 'put(filename, serialize(encode(job, actualPackage, binding.selectedInputs, authority)));');
controller = replace(controller, "put(path.join(own, 'RUNTIME-SEAL.json'), runtimeSeal, true);", "const normalized = encode(runtimeSeal, actualPackage, binding.selectedInputs, authority);\n  const normalizedBytes = measure(normalized);\n  frameSize([{ oid: '0'.repeat(40), kind: 'blob', bytes: normalizedBytes }, { oid: '1'.repeat(40), kind: 'blob', bytes: describe(path.join(own, 'BUILD-RECEIPT.json')).bytes }, { oid: '2'.repeat(40), kind: 'commit', bytes: 65536 }], Math.min(CAP, 128 * 1024 * 1024 - persisted));\n  put(path.join(own, 'RUNTIME-SEAL.json'), serialize(normalized), true);");
controller = replace(controller, "const runtimeRequests = [runtimeCommit, ...entries.map(entry => entry.blob)]; const runtimeRaw = await git('runtime-objects', ['cat-file', '--batch'], runtimeRequests.join('\\n') + '\\n');", "const runtimeRequests = [runtimeCommit, ...entries.map(entry => entry.blob)];\n  const sizes = await git('runtime-sizes', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], runtimeRequests.join('\\n') + '\\n');\n  const sizeLines = new TextDecoder('utf8', { fatal: true }).decode(sizes).split('\\n'); assert.equal(sizeLines.pop(), ''); assert.equal(sizeLines.length, runtimeRequests.length);\n  const records = sizeLines.map((line, index) => { const match = /^([0-9a-f]{40}) (blob|commit) (0|[1-9][0-9]*)$/.exec(line); assert.ok(match); assert.equal(match[1], runtimeRequests[index]); return { oid: match[1], kind: match[2], bytes: Number(match[3]) }; });\n  assert.ok(records[0].bytes <= 65536, 'commit metadata reservation');\n  frameSize(records, Math.min(CAP, 128 * 1024 * 1024 - persisted));\n  const runtimeRaw = await git('runtime-objects', ['cat-file', '--batch'], runtimeRequests.join('\\n') + '\\n');");
bodies['controller.mjs'] = controller;
const patch = '*** Begin Patch\n' + Object.entries(bodies).map(([name, body]) => `*** Add File: ${path.relative(repository, path.join(own, name))}\n${body.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n`).join('') + '*** End Patch\n';
assert.ok(Buffer.byteLength(patch) < 2 * 1024 * 1024);
fs.writeFileSync(path.join(own, 'SOURCE.patch'), patch, { flag: 'wx' });
console.log(JSON.stringify({ kind: 'source-generation-only', files: Object.keys(bodies).length, patchBytes: Buffer.byteLength(patch), patchSha256: createHash('sha256').update(patch).digest('hex') }));
