import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admitCandidate, authorizeThenLoad, api, sha256 } from './binding.mjs';
import { authenticateFixture } from './fixture-data.mjs';
import { compareObservation, exerciseSix } from './module-adapter.mjs';
import { acceptSupervisor, nativeRecipe, runNative } from './native-adapter.mjs';

const base = new URL('./', import.meta.url);
const records = JSON.parse(readFileSync(new URL('records.json', base)));
const preseal = JSON.parse(readFileSync(new URL('PRESEAL.json', base)));
for (const file of preseal.files) assert.equal(sha256(readFileSync(new URL(file.path, base))), file.sha256, `preseal ${file.path}`);
const results = [];
async function control(id, action) {
  try { await action(); results.push({ id, status: 'PASS_SYNTHETIC_ONLY' }); }
  catch (error) { results.push({ id, status: 'FAIL_PREPARATION', name: error?.name, message: error?.message }); }
}
const preparationSha256 = sha256(readFileSync(new URL('PRESEAL.json', base)));
function inertBinding() {
  const files = new Map([
    ['emitted/git.mjs', Buffer.from('export {};\n')], ['source/git.ts', Buffer.from('inert source bytes; not compiled\n')],
    ['package.json', Buffer.from('{"name":"synthetic-only-not-a-product","type":"module"}\n')],
  ]);
  const packet = {
    schema: 'git-candidate-for-preparation-v3', candidateCommit: 'a'.repeat(40), kind: 'source-emitted', archiveSha256: 'b'.repeat(64),
    census: 'EXACT_ALL_ENTRIES_NO_LIVE_OVERLAY', liveFallback: false, api, context: { cwd: '/repo', env: {}, stdinBase64: '' },
    files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes), type: 'file', mode: 0o644 })),
    sourceFiles: ['source/git.ts'], packageFiles: ['package.json'], entry: 'emitted/git.mjs', imports: { 'emitted/git.mjs': [] }, builtins: [],
    node: { path: '/SYNTHETIC_ONLY/node', sha256: 'c'.repeat(64), version: 'INERT_NOT_PROBED' },
    compiler: { path: '/SYNTHETIC_ONLY/tsc.js', sha256: 'd'.repeat(64), version: 'INERT_NOT_PROBED' },
    build: { receiptSha256: 'e'.repeat(64), argv: ['NEVER_EXECUTE_SYNTHETIC'] }, toolBindings: { sha256: 'f'.repeat(64) },
    moduleSpecifier: './emitted/git.mjs', packageResolutionSha256: '1'.repeat(64),
  };
  const seal = () => {
    const bytes = Buffer.from(JSON.stringify(packet));
    return { bytes, go: { action: 'ROOT_GIT_CANDIDATE_EXECUTE', authorization: 'SYNTHETIC INERT MEMORY ONLY NOT AUTHORITY', packetSha256: sha256(bytes), preparationSha256, candidateCommit: packet.candidateCommit, archiveSha256: packet.archiveSha256, kind: packet.kind } };
  };
  return { files, packet, seal };
}
function actualFor(row) { return { exitCode: row.exitCode, stdout: Buffer.from(row.stdoutBase64, 'base64'), stderr: Buffer.alloc(0), tree: structuredClone(records.tree), cwd: row.cwd, env: {} }; }
const literalCaptures = [
  'M  README.md\nD  obsolete.txt\n M src/app.txt\n?? notes.txt\n', 'src/app.txt\n', 'README.md\nobsolete.txt\n', 'two\n',
  '1cec77171d8321d533b3aa50b7a1a9df02b10816 Second\ndde68226091aa6adddca45e02370c5127430e55a Initial\n', 'README.md\0src/app.txt\0',
];
const mockNamespace = {
  createGitCommand() { return { name: 'git', async execute(context) {
    const index = records.workflows.findIndex(row => JSON.stringify(row.args) === JSON.stringify(context.args));
    assert.ok(index >= 0);
    await context.fs.readFile('/repo/.git/index', { signal: context.signal });
    await context.stdout.write(Buffer.from(literalCaptures[index]));
    return { exitCode: 0 };
  } }; },
  createGitCommands() { return [mockNamespace.createGitCommand()]; },
  gitCommands() { return { name: 'inert-mock', setup(host) { host.commands.register(mockNamespace.createGitCommand()); } }; },
};
await control('S01-fixture-data', () => {
  for (const record of Object.values(records.records)) {
    const bytes = Buffer.from(record.base64, 'base64');
    assert.equal(bytes.length, record.bytes); assert.equal(sha256(bytes), record.sha256);
  }
  assert.equal(records.records.supervisor.sha256, '3e624d9dd62d30a134540078a0ee3df4b8fdbd16d3f817c75f9583ba60dbcd08');
  const data = authenticateFixture(records);
  assert.equal(data.objects, 11); assert.equal(data.indexBytes, 184);
  for (const row of records.workflows) {
    const recipe = nativeRecipe('/SYNTHETIC_ONLY/unused-root', row);
    assert.deepEqual(recipe.semanticArgs, row.args); assert.equal(recipe.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(recipe.env.PATH, '/SYNTHETIC_ONLY/unused-root/empty/bin'); assert.equal(recipe.shell, false);
  }
});
await control('S02-six-inert-observations', async () => assert.equal((await exerciseSix(mockNamespace, records)).length, 6));
await control('N01-no-GO-no-import', async () => {
  let imports = 0;
  await assert.rejects(authorizeThenLoad(undefined, undefined, new Map(), preparationSha256, () => { imports++; }), /HOLD/);
  assert.equal(imports, 0);
});
await control('N02-wrong-packet-hash', () => {
  const sample = inertBinding(), { bytes, go } = sample.seal(); go.packetSha256 = '0'.repeat(64);
  assert.throws(() => admitCandidate(bytes, go, sample.files, preparationSha256), /binding/);
});
await control('N03-wrong-module-hash-no-import', async () => {
  const sample = inertBinding(), { bytes, go } = sample.seal(); sample.files.set('emitted/git.mjs', Buffer.from('mutated inert bytes'));
  let imports = 0;
  await assert.rejects(authorizeThenLoad(bytes, go, sample.files, preparationSha256, () => { imports++; }), /candidate bytes/);
  assert.equal(imports, 0);
});
for (const [id, mutate] of [
  ['N04-wrong-exports', packet => { packet.api = ['wrongExport']; }],
  ['N05-wrong-cwd', packet => { packet.context.cwd = '/foreign'; }],
  ['N06-ambient-env', packet => { packet.context.env = { GIT_DIR: '/foreign' }; }],
  ['N07-missing-package', packet => { packet.packageFiles = []; }],
  ['N08-unbound-relative-import', packet => { packet.imports['emitted/git.mjs'] = [{ specifier: './missing.mjs', to: 'emitted/missing.mjs' }]; }],
  ['N09-unbound-tool', packet => { delete packet.node; }],
  ['N10-installed-resolution-missing', packet => { packet.kind = 'installed'; delete packet.packageResolutionSha256; }],
  ['N11-moved-root-unproven', packet => { packet.kind = 'moved'; packet.originalRootAbsent = false; }],
]) await control(id, () => {
  const sample = inertBinding(); mutate(sample.packet); const { bytes, go } = sample.seal();
  assert.throws(() => admitCandidate(bytes, go, sample.files, preparationSha256));
});
await control('N12-namespace-exports', async () => {
  const sample = inertBinding(), { bytes, go } = sample.seal(); let inertLoads = 0;
  await assert.rejects(authorizeThenLoad(bytes, go, sample.files, preparationSha256, () => { inertLoads++; return { wrong: () => undefined }; }), /runtime exports/);
  assert.equal(inertLoads, 1);
});
for (const [id, mutate] of [
  ['N13-wrong-stdout-bytes', actual => { actual.stdout = Buffer.from('clean\n'); }],
  ['N14-wrong-stderr-bytes', actual => { actual.stderr = Buffer.from('unexpected diagnostic\n'); }],
  ['N15-wrong-status', actual => { actual.exitCode = 1; }],
  ['N16-added-namespace-effect', actual => { actual.tree.push({ path: '.git/index.lock', type: 'file', mode: 0o644, bytes: 0, sha256: sha256(Buffer.alloc(0)) }); }],
]) await control(id, () => {
  const row = records.workflows[0], actual = actualFor(row); mutate(actual);
  assert.throws(() => compareObservation(row, actual, records.tree));
});
await control('N17-late-PASS-nonzero', () => assert.throws(() => acceptSupervisor({ status: 1, message: 'PASS', clean: true }), /nonzero child/));
await control('N18-native-no-GO-no-dispatch', async () => {
  let calls = 0;
  await assert.rejects(runNative(undefined, undefined, { runH11() { calls++; }, revalidate() { calls++; } }, records, preparationSha256), /HOLD/);
  assert.equal(calls, 0);
});
const receipt = { schema: 'git-preparation-synthetic-v3', presealSha256: preparationSha256, results, positives: 2, negatives: 18, total: 20, passed: results.filter(row => row.status === 'PASS_SYNTHETIC_ONLY').length, actualProductImports: 0, nativeGitWorkflows: 0, supervisorChildren: 0, builds: 0, compilerInvocations: 0, materializedRepositories: 0 };
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (receipt.passed !== 20) process.exitCode = 1;
