import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const label = process.argv[2];
assert.match(label ?? '', /^[a-z0-9-]+$/);
const output = `tests/fs/s3/http/author/${label}.json`;
assert.equal(existsSync(output), false);
const list = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? list(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const sources = list('src/fs/s3/http').filter(name => name.endsWith('.ts')).sort();
const tests = list('tests/fs/s3/http/unit').filter(name => name.endsWith('.test.ts')).sort();
const inputs = [...list('src').filter(name => name.endsWith('.ts')).sort(), ...list('tests/fs/s3/http/unit'), 'package.json', 'package-lock.json'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = () => Object.fromEntries(inputs.map(name => [name, hash(readFileSync(name))]));
const before = hashes();
const commands = [
  [process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', ...tests]],
  [path.join(root, 'node_modules/.bin/tsc'), ['--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', ...sources, ...tests]],
];
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const results = commands.map(([executable, args]) => {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  return { executable, args, cwd: root, started, finished: new Date().toISOString(), status: result.status,
    signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr,
    stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? '') };
});
const after = hashes();
const value = { classification: 'Author vector/loopback checks only; independent service acceptance separate', head, node: process.version, before, after, stable: JSON.stringify(before) === JSON.stringify(after), results };
const text = JSON.stringify(value, null, 2) + '\n';
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${output}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 8 * 1024 * 1024 });
console.log(JSON.stringify({ output, statuses: results.map(result => result.status), stable: value.stable, sha256: hash(text) }));
assert.equal(value.stable, true);
for (const result of results) assert.equal(result.status, 0, result.stdout + result.stderr);
