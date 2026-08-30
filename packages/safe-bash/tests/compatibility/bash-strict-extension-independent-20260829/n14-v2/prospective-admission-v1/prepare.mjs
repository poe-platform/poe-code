import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const directory = path.dirname(new URL(import.meta.url).pathname);
const parent = path.dirname(directory);
const stdout = fs.openSync(path.join(directory, 'prep/prepare.stdout.raw'), 'wx');
const stderr = fs.openSync(path.join(directory, 'prep/prepare.stderr.raw'), 'wx');
const events = fs.openSync(path.join(directory, 'prep/prepare.events.jsonl'), 'wx');
const emit = value => fs.writeSync(events, JSON.stringify({ at: Date.now(), ...value }) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
emit({ event: 'capture-open', pid: process.pid });
const children = [];
function run(executable, args, input) {
  const result = spawnSync(executable, args, { cwd: directory, input, stdio: ['pipe', stdout, stderr], timeout: 30000, env: { ...process.env, NODE_OPTIONS: '' } });
  children.push({ pid: result.pid, executable, args, status: result.status, signal: result.signal, error: result.error ? String(result.error) : null });
  emit({ event: 'child-completed', ...children.at(-1) });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null);
}
try {
  const finalBytes = fs.readFileSync(path.join(parent, 'FINAL-MANIFEST-v2.json'));
  assert.equal(hash(finalBytes), '026c4a76cd442793276730ca83bafdfcf74e4779138e754537308fc3b8a09b39');
  const priorBytes = fs.readFileSync(path.join(parent, 'FINAL-MANIFEST.json'));
  assert.equal(hash(priorBytes), JSON.parse(finalBytes).priorManifestSha256);
  const resultBytes = fs.readFileSync(path.join(parent, 'actual-v2/evidence/RESULT.json'));
  const binding = JSON.parse(priorBytes).files.find(member => member.path === 'actual-v2/evidence/RESULT.json');
  assert.equal(resultBytes.length, binding.bytes); assert.equal(hash(resultBytes), binding.sha256);
  const members = JSON.parse(resultBytes).package.members;
  assert.equal(members.length, 954);
  const memberText = JSON.stringify(members, null, 2) + '\n';
  const original = fs.readFileSync(path.join(directory, 'package-admission.mjs'), 'utf8');
  const needle = "    if (digest !== authority.sha256) refuse('HASH');";
  assert.equal(original.split(needle).length, 2);
  const mutant = original.replace(needle, "    operations.decode(compressed, { maxOutputLength: decodedLimit });\n" + needle);
  const additions = [['EXPECTED-MEMBERS.json', memberText], ['ordering-mutant.mjs', mutant], ['restored-admission.mjs', original]];
  const patch = '*** Begin Patch\n' + additions.map(([name, text]) => '*** Add File: ' + path.join(directory, name) + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n';
  run('/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], patch);
  assert.equal(hash(fs.readFileSync(path.join(directory, 'restored-admission.mjs'))), hash(Buffer.from(original)));
  const sources = ['package-admission.mjs', 'parse-manifest.mjs', 'controls.mjs', 'outer.mjs', 'prepare.mjs', 'ordering-mutant.mjs', 'restored-admission.mjs'];
  for (const name of sources) run(process.execPath, ['--check', path.join(directory, name)]);
  const nodeStat = fs.lstatSync(process.execPath);
  assert.ok(nodeStat.isFile());
  const toolHash = createHash('sha256');
  const descriptor = fs.openSync(process.execPath, 'r');
  try { const chunk = Buffer.alloc(65536); let bytes; while ((bytes = fs.readSync(descriptor, chunk)) !== 0) toolHash.update(chunk.subarray(0, bytes)); }
  finally { fs.closeSync(descriptor); }
  const node = { path: process.execPath, bytes: nodeStat.size, sha256: toolHash.digest('hex') };
  assert.equal(node.sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  const files = Object.fromEntries([...sources, 'ARTIFACT.json', 'EXPECTED-MEMBERS.json', 'PRESEAL.md'].map(name => { const bytes = fs.readFileSync(path.join(directory, name)); return [name, { bytes: bytes.length, sha256: hash(bytes) }]; }));
  const preseal = { schema: 1, files, node, artifactSha256: '3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49', artifactBytes: 872281, expectedMembers: 954, priorManifest: hash(priorBytes), priorResult: hash(resultBytes), controls: 12, realArtifactAdmissions: 1, actualInflationsMaximum: 1, extraction: 0, productImports: 0, scratch: 'actual-v1/work', outer: 'outer.mjs', child: 'controls.mjs', actualProcessCount: 2, actualPeak: 2, rootKnownProcessMaximum: 48, rootSeconds: 1500, innerSeconds: 90, cleanupSeconds: 5, captureCap: 8388608, decodedCap: 67108864, aggregateLogicalBufferCap: 100663296, mutant: { source: 'ordering-mutant.mjs', insertedBefore: needle, restored: 'restored-admission.mjs' }, scope: 'Prospective harness proof only; original attempt remains noncompliant; no rescore744.' };
  const text = JSON.stringify(preseal, null, 2) + '\n';
  const sealPatch = '*** Begin Patch\n*** Add File: ' + path.join(directory, 'PRESEAL.json') + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n*** Add File: ' + path.join(directory, 'PRESEAL.sha256') + '\n+' + hash(text) + '\n*** End Patch\n';
  run('/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch', [], sealPatch);
  emit({ event: 'sealed', sha256: hash(text), children: children.length });
  fs.writeSync(stdout, JSON.stringify({ node, preseal: hash(text), children, members: members.length }) + '\n');
  process.stdout.write(JSON.stringify({ preseal: hash(text), children: children.length, members: members.length }) + '\n');
} catch (reason) {
  fs.writeSync(stderr, String(reason?.stack ?? reason) + '\n');
  emit({ event: 'failure', reasonPresent: true, reason: String(reason?.stack ?? reason) });
  process.exitCode = 1;
} finally {
  emit({ event: 'capture-closure', children });
  fs.closeSync(stdout); fs.closeSync(stderr); fs.closeSync(events);
}
