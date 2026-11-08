import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/integration/agent-bash-coherent-author-20260829';
const scope = path.join(root, relative, 'stage-b1-r3');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename, expected, maximum = 262144) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= maximum);
  if (expected) assert.equal(stat.size, expected.bytes);
  const body = fs.readFileSync(filename); assert.equal(body.length, stat.size);
  if (expected) assert.equal(hash(body), expected.sha256);
  return body;
}
const write = (filename, value) => fs.writeFileSync(path.join(scope, filename), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const identity = filename => { const body = read(filename); return { bytes: body.length, sha256: hash(body) }; };
const oldRoot = path.join(root, relative, 'stage-b1-r2');
const oldSeal = JSON.parse(read(path.join(oldRoot, 'PRESEAL.json'), { bytes: 17692, sha256: '007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc' }));
const authority = filename => { const entry = oldSeal.files.find(entry => entry.path === `${relative}/stage-b1-r2/${filename}`); assert.ok(entry); return entry; };
if (process.argv[2] === 'patch') {
  const run = read(path.join(oldRoot, 'run.mjs'), authority('run.mjs')).toString();
  const oldLine = "      const harness = path.join(consumer, 'harness'), scripts = path.join(harness, 'node'); fs.mkdirSync(scripts, { recursive: true });";
  assert.equal(run.split(oldLine).length, 2);
  const revised = run.replace("import fs from 'node:fs';", "import fs from 'node:fs';\nimport { createLayoutHarness } from './layout.mjs';").replace(oldLine, '      const { harness, scripts } = createLayoutHarness(consumer, layout);');
  const bootstrap = read(path.join(oldRoot, 'bootstrap.mjs'), authority('bootstrap.mjs')).toString();
  const launch = read(path.join(oldRoot, 'launch.sh'), authority('launch.sh')).toString().replaceAll('stage-b1-r2/bootstrap.mjs', 'stage-b1-r3/bootstrap.mjs').replaceAll('20260829-r2.launch.', '20260829-r3.launch.');
  let patch = '*** Begin Patch\n';
  for (const [name, text] of [['run.mjs', revised], ['bootstrap.mjs', bootstrap], ['launch.sh', launch]]) {
    assert.ok(text.endsWith('\n'));
    patch += `*** Add File: ${relative}/stage-b1-r3/${name}\n` + text.slice(0, -1).split('\n').map(line => '+' + line).join('\n') + '\n';
  }
  patch += '*** End Patch\n'; fs.writeFileSync(path.join(scope, 'source.patch'), patch, { flag: 'wx' });
  write('EXPECTED-SOURCE.json', [['run.mjs', revised], ['bootstrap.mjs', bootstrap], ['launch.sh', launch]].map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text), sha256: hash(Buffer.from(text)) })));
  const sourceIdentity = { bytes: 137864, sha256: 'ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae' };
  const source = JSON.parse(read(path.join(root, relative, 'v2/SOURCE.json'), sourceIdentity));
  assert.ok(Array.isArray(source.inputs));
  const sources = [];
  for (const filename of ['src/contracts/command.ts', 'src/shell/shell.ts', 'src/commands/node/index.ts']) {
    const entry = source.inputs.find(entry => entry.path === filename); assert.ok(entry);
    const body = read(path.join('/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source', filename), entry);
    sources.push({ path: filename, bytes: body.length, sha256: hash(body), authority: sourceIdentity });
  }
  const results = [];
  for (const layout of ['source-built', 'installed']) {
    const capture = path.join('/private/tmp/safe-bash-coherent-b1-public15-20260829-r2/capture', layout === 'source-built' ? '01-workflow-source-built.stdout' : '02-workflow-installed.stdout');
    const body = read(capture); const record = { path: capture, bytes: body.length, sha256: hash(body) };
    write(`${layout}-raw-receipt.json`, record);
    const parsed = JSON.parse(body); const caseRow = parsed.rows.find(row => row.id === 'C18'); assert.ok(caseRow);
    results.push({ layout, identity: record, row: caseRow });
  }
  write('C18-SOURCE-DATA.json', { sources, results, nativeOrProductExecution: 0, qualification: 'Captured wrapper omits original cause; first failing assertion is source-supported, not directly observed error stack.' });
  console.log(JSON.stringify({ phase: 'patch', utc: new Date().toISOString(), pid: process.pid, sourceCount: source.inputs.length }));
} else if (process.argv[2] === 'seal') {
  const expected = JSON.parse(read(path.join(scope, 'EXPECTED-SOURCE.json')));
  for (const entry of expected) read(path.join(scope, entry.path), entry);
  const names = ['run.mjs', 'bootstrap.mjs', 'launch.sh', 'layout.mjs'];
  const seal = structuredClone(oldSeal);
  seal.workRoot = '/private/tmp/safe-bash-coherent-b1-public15-20260829-r3'; assert.equal(fs.existsSync(seal.workRoot), false);
  for (const name of names) seal.files.push({ path: `${relative}/stage-b1-r3/${name}`, ...identity(path.join(scope, name)) });
  seal.successor = { kind: 'layout-only', previous: { path: `${relative}/stage-b1-r2/PRESEAL.json`, bytes: 17692, sha256: '007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc' }, C18: 'UNCHANGED_PENDING_ROOT_FIXTURE_DECISION', publication: 'Old final-slot binding/UTC/authority NOT TRANSFERRED; fresh review required' };
  seal.actualAuthorization = 'PENDING_DIFFERENT_REVIEW_AND_FRESH_ROOT_GO';
  write('PRESEAL.json', seal);
  const b0 = JSON.parse(read(path.join(root, oldSeal.b0.path), oldSeal.b0, 1048576));
  const control = { schema: 'B1-r3-layout-control-preseal-v1', scratch: '/private/tmp/coherent-b1-r3-layout-controls-owned', node: { path: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', bytes: b0.node.bytes, sha256: b0.node.sha256 }, groups: ['L01', 'L02', 'L03', 'L04'], knownNodeControllers: 1, productImports: 0, Workers: 0, seconds: 30, files: ['layout.mjs', 'controls.mjs'].map(name => ({ path: name, ...identity(path.join(scope, name)) })) };
  assert.equal(fs.existsSync(control.scratch), false); write('CONTROL-PRESEAL.json', control);
  const preseal = identity(path.join(scope, 'PRESEAL.json')), controls = identity(path.join(scope, 'CONTROL-PRESEAL.json'));
  write('SEAL-RECEIPT.json', { utc: new Date().toISOString(), pid: process.pid, preseal, controls, unchangedStageFiles: hash(Buffer.from(JSON.stringify(oldSeal.stageFiles))), actualCalls: 0 });
  console.log(JSON.stringify({ preseal, controls, utc: new Date().toISOString(), pid: process.pid }));
} else throw new Error('unknown source preparation phase');
