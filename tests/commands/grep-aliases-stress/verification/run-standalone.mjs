import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pack = process.argv[2];
const attempt = process.argv[3];
assert.ok(pack && attempt, 'Pass frozen pack directory and new attempt directory');
mkdirSync(attempt, { recursive: false });
const root = fileURLToPath(new URL('./', import.meta.url));
const prepared = dirname(root.replace(/\/$/, ''));
const receipt = JSON.parse(readFileSync(join(pack, 'receipt.json'), 'utf8'));
assert.equal(receipt.status, 'built-and-physically-moved-no-candidate-run');
const consumer = receipt.consumer;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(attempt, 'home'), TMPDIR: attempt, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', GREP_ALIASES_RUN_OUTPUT: join(attempt, 'results'), GREP_ALIASES_CANDIDATE: receipt.candidate };
mkdirSync(environment.HOME);
const result = { startedAt: new Date().toISOString(), candidate: receipt.candidate, packageSha256: receipt.packageSha256, sourceSha256: receipt.aliasSourceSha256, consumer, attempt, runtimeEnvironment: environment, candidateExecuted: false, commands: [], inputs: [], status: 'in-progress', forcedCleanup: false };
function run(name, executable, args, timeout) {
  const child = spawnSync(executable, args, { cwd: consumer, env: environment, encoding: null, timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  const captured = { name, executable, args, cwd: consumer, status: child.status, signal: child.signal, error: child.error?.message ?? null, stdoutHex: (child.stdout ?? Buffer.alloc(0)).toString('hex'), stderrHex: (child.stderr ?? Buffer.alloc(0)).toString('hex') };
  result.commands.push(captured);
  writeFileSync(join(attempt, `${name}.json`), `${JSON.stringify(captured, null, 2)}\n`);
  if (child.signal || child.error) result.forcedCleanup = true;
  return child;
}
function verifyPackage() {
  for (const entry of receipt.packageManifest) assert.equal(sha256(readFileSync(join(consumer, 'node_modules/virtual-bash', entry.path))), entry.sha256, entry.path);
  assert.equal(sha256(readFileSync(join(pack, 'candidate.tar'))), receipt.archiveSha256);
  for (const entry of receipt.sourceManifest) assert.equal(sha256(readFileSync(join(pack, 'source', entry.path))), entry.sha256, entry.path);
}
try {
  verifyPackage();
  mkdirSync(join(consumer, 'fixtures'), { recursive: true });
  const inputs = [
    [join(root, 'holdouts.mts'), join(consumer, 'holdouts.mts')],
    [join(root, 'public-consumer.mts'), join(consumer, 'public-consumer.mts')],
    ...['corpus.json', 'native-goldens.json', 'safety-holdouts.json', 'candidate-profiles.json'].map(name => [join(prepared, 'data', name), join(consumer, 'fixtures', name)]),
    [join(root, 'gnu/captures.json'), join(consumer, 'fixtures/gnu-captures.json')]
  ];
  for (const [from, to] of inputs) {
    copyFileSync(from, to);
    result.inputs.push({ source: from, copiedTo: to, sha256: sha256(readFileSync(to)) });
    copyFileSync(from, join(attempt, to.split('/').at(-1)));
  }
  assert.equal(sha256(readFileSync(join(consumer, 'fixtures/corpus.json'))), 'a745efbc79d4c48d31b6a5e3e5e5fe51de0bd19f1a51dd66d984abc24f7161a8');
  const compiler = join(pack, 'source/node_modules/typescript/lib/tsc.js');
  mkdirSync(join(consumer, 'node_modules/@types'), { recursive: true });
  const links = [['@types/node', join(pack, 'source/node_modules/@types/node')], ['undici-types', join(pack, 'source/node_modules/undici-types')]];
  for (const [name, target] of links) if (!existsSync(join(consumer, 'node_modules', name))) symlinkSync(target, join(consumer, 'node_modules', name));
  const config = { compilerOptions: { target: 'ES2023', lib: ['ES2023'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, skipLibCheck: true, types: ['node'], outDir: 'run' }, files: ['holdouts.mts', 'public-consumer.mts'] };
  writeFileSync(join(consumer, 'tsconfig.holdouts.json'), `${JSON.stringify(config, null, 2)}\n`);
  const types = run('strict-types', process.execPath, [compiler, '-p', 'tsconfig.holdouts.json', '--noEmitOnError'], 120000);
  for (const [name] of links) unlinkSync(join(consumer, 'node_modules', name));
  assert.equal(types.status, 0, `Strict typecheck failed: ${types.stdout?.toString()} ${types.stderr?.toString()}`);
  result.runtimeNodeModules = readdirSync(join(consumer, 'node_modules')).sort();
  result.candidateExecuted = true;
  const tests = run('candidate-tests', process.execPath, ['--test', '--test-concurrency=1', 'run/holdouts.mjs'], 120000);
  result.status = tests.status === 0 && !tests.error && !tests.signal ? 'passed' : 'candidate-tests-failed';
  verifyPackage();
  result.archiveAndProductUnchangedAfter = true;
} catch (error) {
  result.status = 'failed';
  result.error = { message: error.message, stack: error.stack };
} finally {
  result.endedAt = new Date().toISOString();
  writeFileSync(join(attempt, 'receipt.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, candidateExecuted: result.candidateExecuted, forcedCleanup: result.forcedCleanup, error: result.error?.message, attempt }, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
}
