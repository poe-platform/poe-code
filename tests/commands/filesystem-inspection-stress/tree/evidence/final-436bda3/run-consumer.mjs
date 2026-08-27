import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const candidate = join(directory, 'candidate');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const publish = (name, value) => writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const gate = JSON.parse(await readFile(join(directory, 'execution-gate.json'), 'utf8'));
assert.equal(gate.decision, 'GO_N18_V2_AND_ORIGINAL_38_ONCE');
const manifest = [];
async function inventory(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = join(root, entry.name);
    if (entry.isDirectory()) await inventory(filename);
    else {
      assert.ok(entry.isFile());
      const bytes = await readFile(filename);
      manifest.push({ path: relative(directory, filename), bytes: bytes.length, sha256: hash(bytes) });
      await chmod(filename, 0o444);
    }
  }
}
await inventory(join(directory, 'build'));
await publish('build-input-files.json', manifest.sort((left, right) => left.path.localeCompare(right.path)));
async function run(name, argv, coverage) {
  const started = Date.now();
  const child = spawn(process.execPath, argv, { cwd: directory, env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory,
    LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...(coverage ? { NODE_V8_COVERAGE: coverage } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  let killedFor;
  const kill = reason => { killedFor ??= reason; child.kill('SIGKILL'); };
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) kill('log-ceiling'); else chunks.push(chunk);
  });
  const timer = setTimeout(() => kill('120s-deadline'), 120000);
  const completion = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
  clearTimeout(timer);
  await writeFile(join(directory, `${name}.stdout.txt`), Buffer.concat(stdout), { flag: 'wx' });
  await writeFile(join(directory, `${name}.stderr.txt`), Buffer.concat(stderr), { flag: 'wx' });
  const result = { name, argv, cwd: directory, pid: child.pid, completion, killedFor, elapsedMs: Date.now() - started };
  await publish(`${name}.process.json`, result);
  assert.equal(completion.exitCode, 0);
  assert.equal(killedFor, undefined);
  return result;
}
await run('consumer-types', [join(candidate, 'node_modules/typescript/bin/tsc'), '--module', 'NodeNext', '--target', 'ES2023', '--strict', '--skipLibCheck',
  '--types', 'node', '--typeRoots', join(candidate, 'node_modules/@types'), '--listFiles', join(directory, 'consumer.mts')]);
await publish('consumer-input-files.json', await Promise.all(['consumer.mts', 'consumer.mjs', 'run-consumer.mjs'].map(async path => {
  const bytes = await readFile(join(directory, path)); return { path, bytes: bytes.length, sha256: hash(bytes) };
})));
await mkdir(join(directory, 'consumer-coverage'));
const result = await run('consumer-run', [join(directory, 'consumer.mjs')], join(directory, 'consumer-coverage'));
await publish('consumer-result.json', { id: 'BUILT-STANDALONE-SMOKE-1', status: 'pass', productInvocations: 1, cohortCases: 0,
  fresh: true, reused: false, purpose: 'Bounded separately authorized built-plugin verification, NOT an additional holdout or native oracle', process: result });
console.log(JSON.stringify({ status: 'pass', productInvocations: 1, buildFiles: manifest.length }));
