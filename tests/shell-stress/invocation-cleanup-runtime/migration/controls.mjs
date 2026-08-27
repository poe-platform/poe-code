import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { assertCommittedInputs, assertInputsUnchanged, captureInputs, copyRegularTools, digest, fixturePath, helperPath, preparePublicSnapshot, probePath } from './binding.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'cleanup-binding-control-'));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(lstat(root), { code: 'ENOENT' });
  });
  for (const [path, text] of Object.entries({
    'src/fixture.ts': 'export const value = 1;\n',
    'package.json': '{"type":"module"}',
    'package-lock.json': '{}',
    'tsconfig.build.json': '{"extends":"./tsconfig.json"}',
    'tsconfig.json': '{"compilerOptions":{"strict":true}}',
    [fixturePath]: 'canonical fixture marker\n',
    [probePath]: 'probe marker\n',
    [helperPath]: 'binding helper marker\n',
  })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, { flag: 'wx' });
  }
  return { root, captured: await captureInputs(root) };
}

test('binding unit: unchanged captured inputs and an explicit expectation agree', async context => {
  const { root, captured } = await fixture(context);
  await assertInputsUnchanged(root, captured.files);
  assertCommittedInputs(captured, { format: 'public-cleanup-committed-v1', revision: '1'.repeat(40), tree: '2'.repeat(40), files: captured.files });
});

for (const path of ['src/fixture.ts', 'tsconfig.json', 'package.json', probePath, helperPath]) {
  test(`binding unit: changed ${path} cannot bless itself as expected`, async context => {
    const { root, captured } = await fixture(context);
    await writeFile(join(root, path), path.endsWith('.json') ? '{}' : 'changed input\n');
    await assert.rejects(assertInputsUnchanged(root, captured.files), /changed during public cleanup/);
    assert.throws(() => assertCommittedInputs({ files: { ...captured.files, [path]: digest('changed') }, bytes: new Map() }, { format: 'public-cleanup-committed-v1', revision: '1'.repeat(40), tree: '2'.repeat(40), files: captured.files }), /explicit committed expectation/);
  });
}

test('binding unit: source additions and deletions remain in the input census', async context => {
  const { root, captured } = await fixture(context);
  await writeFile(join(root, 'src/added.ts'), 'export {};\n');
  await assert.rejects(assertInputsUnchanged(root, captured.files), /changed during public cleanup/);
  await rm(join(root, 'src/added.ts'));
  await rm(join(root, 'src/fixture.ts'));
  await assert.rejects(assertInputsUnchanged(root, captured.files), /changed during public cleanup/);
});

test('binding unit: incomplete, malformed and extra-entry expectations are rejected', async context => {
  const { captured } = await fixture(context);
  const expected = { format: 'public-cleanup-committed-v1', revision: '1'.repeat(40), tree: '2'.repeat(40), files: captured.files };
  assert.throws(() => assertCommittedInputs(captured, { ...expected, revision: 'HEAD' }));
  assert.throws(() => assertCommittedInputs(captured, { ...expected, files: {} }));
  assert.throws(() => assertCommittedInputs(captured, { ...expected, files: { ...captured.files, 'src/unread.ts': digest('extra') } }));
});

test('binding unit: linked sources and escaping build configurations are refused', async context => {
  const { root } = await fixture(context);
  await symlink('fixture.ts', join(root, 'src/alias.ts'));
  await assert.rejects(captureInputs(root), /symlink/);
  await rm(join(root, 'src/alias.ts'));
  await writeFile(join(root, 'tsconfig.build.json'), '{"extends":"../../outside.json"}');
  await assert.rejects(captureInputs(root), /escapes candidate/);
});

test('canonical committed mode cannot fall back to working-tree mode for a null or false manifest', async context => {
  const { root } = await fixture(context);
  const path = join(root, 'invalid-expectation.json');
  for (const value of ['null', 'false']) {
    await writeFile(path, value);
    const environment = { ...process.env, VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED: path, VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT: '1'.repeat(40) };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', fixturePath], { cwd: repository, env: environment, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    context.diagnostic(JSON.stringify({ malformedManifest: value, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Committed qualification requires an object manifest/);
    assert.match(result.stdout, /^# tests 10$/m);
    assert.match(result.stdout, /^# fail 10$/m);
    assert.doesNotMatch(result.stdout, /PUBLIC_SOURCE_MANIFEST/);
  }
});

let prepared;
before(async () => { prepared = await preparePublicSnapshot(repository); }, { timeout: 60000 });
after(async () => { if (prepared) { try { await prepared.verify(); } finally { await prepared.dispose(); } } });

for (const [name, path] of [['emitted module', 'dist/shell/shell.js'], ['captured source', 'src/shell/shell.ts'], ['copied probe', probePath], ['manifest', 'public-manifest.json']]) {
  test(`actual build: ${name} tamper is rejected without rebaselining`, async () => {
    const target = join(prepared.snapshot, path);
    const bytes = await readFile(target);
    try {
      await writeFile(target, Buffer.concat([bytes, Buffer.from('\nchanged\n')]));
      await assert.rejects(prepared.verify());
    } finally { await writeFile(target, bytes); }
    await prepared.verify();
  });
}

test('actual retirement source mutant fails the original normal grep and rg boundaries', { timeout: 60000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), 'cleanup-retirement-mutant-'));
  let mutant;
  try {
    const captured = await captureInputs(repository);
    for (const [path, bytes] of captured.bytes) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes, { flag: 'wx' });
    }
    const path = 'src/commands/regex-execution/client.ts';
    const original = await readFile(join(root, path), 'utf8');
    const needle = 'if (!this.exited) await this.worker.terminate();';
    assert.equal(original.split(needle).length, 2);
    const mutated = original.replace(needle, 'if (!this.exited) void this.worker.terminate();');
    await writeFile(join(root, path), mutated);
    await assert.rejects(assertInputsUnchanged(root, captured.files), /changed during public cleanup/);
    await copyRegularTools(join(repository, 'node_modules'), join(root, 'node_modules'));
    mutant = await preparePublicSnapshot(root);
    context.diagnostic(JSON.stringify({ deliberateSourceMutant: path, beforeSha256: digest(original), afterSha256: digest(mutated), notOriginalCommittedQualification: true, sourceBinding: mutant.manifest.binding }));
    for (const command of ['grep', 'rg']) {
      const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', mutant.probe, mutant.manifestPath, `${command}:normal`], { cwd: mutant.snapshot, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
      context.diagnostic(JSON.stringify({ command, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr }));
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout.trim());
      assert.equal(report.passed, false);
      assert.match(report.failure.message, /has not exited|termination promise incomplete/u);
    }
    await mutant.verify();
  } finally {
    if (mutant) await mutant.dispose();
    await rm(root, { recursive: true, force: true });
    await assert.rejects(lstat(root), { code: 'ENOENT' });
  }
});
