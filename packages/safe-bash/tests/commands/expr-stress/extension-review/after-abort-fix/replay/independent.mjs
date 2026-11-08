import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addEvidence, owned, root, sha256, verifyFrozen } from './review.mjs';
import { command } from './stage.mjs';
import { containedJob } from './watchdog.mjs';

const label = process.argv[2];
if (!label) { verifyFrozen(); console.log('Read-only verification; new explicit capture label required.'); process.exit(0); }
assert(/^[a-z0-9-]+$/.test(label));
const destination = `${owned}/${label}`;
assert(!existsSync(destination));
const stage = JSON.parse(readFileSync(`${owned}/candidate-27a77935/stage.json`));
const consumer = dirname(dirname(stage.installed));
const source = readFileSync(`${owned}/independent-consumer.mts.data`, 'utf8');
const config = { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, types: ['node'], typeRoots: [join(root, 'node_modules/@types')], noEmitOnError: true }, files: [`${label}.mts`] };
for (const [path, text] of [[join(consumer, `${label}.mts`), source], [join(consumer, `${label}.json`), JSON.stringify(config, null, 2)]]) {
  assert(!existsSync(path));
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const typecheck = await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, `${label}.json`)], consumer);
addEvidence(`${destination}/typecheck.json`, { sourceSha256: sha256(source), source, config, ...typecheck });
assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);
const emitted = join(consumer, `${label}.mjs`);
addEvidence(`${destination}/emitted.mjs.data`, readFileSync(emitted, 'utf8'));
const rows = [];
async function run(id, payload) {
  const outer = await containedJob(pathToFileURL(emitted).href, payload);
  const value = outer.state === 'returned' && outer.value?.state === 'fulfilled' ? outer.value.value : null;
  rows.push({ id, payload, outer, passed: value?.passed === true && value.activeBeforeSafetyCleanup === 0 });
  if (!rows.at(-1).passed) console.log(JSON.stringify(rows.at(-1)));
}
for (const phase of ['pre', 'active']) {
  await run(`typed-synthetic-undefined-${phase}`, { mode: 'synthetic', reason: 'undefined', phase });
  for (const mode of ['native-expr', 'native-legacy']) for (const reason of ['undefined', 'zero', 'null', 'false', 'empty', 'error']) await run(`${mode}-${phase}-${reason}`, { mode, reason, phase });
}
for (const maxSteps of [399505, 399506, 399507]) await run(`index-work-${maxSteps}`, { mode: 'index', maxSteps });
await run('index-large-positive', { mode: 'index', positive: true });
await run('index-large-cancellation', { mode: 'index', cancel: true });
addEvidence(`${destination}/controls.json`, { candidate: stage.commit, sourceSha256: sha256(source), emittedSha256: sha256(readFileSync(emitted)), subcases: rows.length, failed: rows.filter(row => !row.passed).map(row => row.id), rows, primaryReferences: ['https://dom.spec.whatwg.org/#abortcontroller', 'https://nodejs.org/download/release/latest-jod/docs/api/globals.html#abortsignalreason'], independence: 'New fully typed EventTarget consumer and five bounded index probes. Author111 archived tests are separate, not holdouts. Native AbortSignal.any gets only native signals.' });
console.log(JSON.stringify({ subcases: rows.length, failed: rows.filter(row => !row.passed).map(row => row.id) }));
