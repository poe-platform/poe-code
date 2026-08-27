import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const candidate = join(directory, 'candidate');
const gate = JSON.parse(await readFile(join(directory, 'execution-gate.json'), 'utf8'));
assert.equal(gate.decision, 'GO_N18_V2_AND_ORIGINAL_38_ONCE');
const results = [];
for (const [name, args] of [
  ['scoped-types', ['--noEmit', '-p', 'tests/commands/tree/tsconfig.json', '--listFiles']],
  ['standalone-build', ['-p', 'tests/commands/tree/tsconfig.build.json', '--outDir', join(directory, 'build'), '--listEmittedFiles']],
]) {
  const argv = [join(candidate, 'node_modules/typescript/bin/tsc'), ...args];
  const started = Date.now();
  const child = spawn(process.execPath, argv, { cwd: candidate, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
  const completion = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })); });
  clearTimeout(timer);
  await writeFile(join(directory, `${name}.stdout.txt`), Buffer.concat(stdout), { flag: 'wx' });
  await writeFile(join(directory, `${name}.stderr.txt`), Buffer.concat(stderr), { flag: 'wx' });
  results.push({ name, argv, cwd: candidate, pid: child.pid, completion, timedOut, elapsedMs: Date.now() - started });
}
await writeFile(join(directory, 'preflight.json'), `${JSON.stringify({ at: new Date().toISOString(), productCalls: 0, nativeCalls: 0, results }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.completion.exitCode === 0 && !result.timedOut));
