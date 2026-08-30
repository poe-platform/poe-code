import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = '/tmp/bash-surface-source-v2-t3EFGu', repo = '/Users/kjopek/Workspace/safe-bash';
const admission = JSON.parse(await fs.readFile(path.join(root, 'ADMISSION.json')));
const requests = JSON.parse(process.argv[2]); assert.ok(Array.isArray(requests) && requests.length <= 8);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let output = '', readBytes = 0; const observations = [];
const append = text => { output += text + '\n'; assert.ok(Buffer.byteLength(output) <= 262144); };
async function text(filename, expected) {
  assert.ok(path.basename(filename) !== 'AGENTS.md' && /\.(md|mjs|json|txt|data)$/.test(filename));
  const stat = await fs.lstat(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4194304);
  const bytes = await fs.readFile(filename); readBytes += bytes.length; assert.ok(readBytes <= 16777216); assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(sha(bytes), expected);
  observations.push({ filename, bytes: bytes.length, sha256: sha(bytes) }); return bytes.toString();
}
try {
  for (const request of requests) {
    if (request.mode === 'source-grep') {
      const pattern = new RegExp(request.pattern); let matches = 0;
      for (const row of admission.selected) for (const [index, line] of (await text(path.join(root, 'selected', row.path + '.data'), row.sha256)).split('\n').entries()) if (pattern.test(line)) { append(`${row.path}:${index + 1}:${line}`); assert.ok(++matches <= 600); }
    } else if (request.mode === 'source-lines') {
      const row = admission.selected.find(item => item.path === request.path); assert.ok(row);
      const lines = (await text(path.join(root, 'selected', row.path + '.data'), row.sha256)).split('\n');
      assert.ok(request.to - request.from < 300); for (let index = request.from - 1; index < Math.min(request.to, lines.length); index++) append(`${row.path}:${index + 1}:${lines[index]}`);
    } else if (request.mode === 'repo-lines') {
      assert.ok(request.path.startsWith('tests/') || request.path.startsWith('benchmarks/') || request.path.startsWith('docs/')); assert.ok(!request.path.split('/').some(part => part === '..' || part === 'node_modules' || part === 'AGENTS.md'));
      const lines = (await text(path.join(repo, request.path))).split('\n'); assert.ok(request.to - request.from < 320); for (let index = request.from - 1; index < Math.min(request.to, lines.length); index++) append(`${request.path}:${index + 1}:${lines[index]}`);
    } else if (request.mode === 'list') {
      assert.ok(request.path.startsWith('tests/') || request.path.startsWith('benchmarks/')); assert.ok(!request.path.split('/').some(part => part === '..' || part === 'node_modules'));
      const names = await fs.readdir(path.join(repo, request.path)); assert.ok(names.length <= 1000); append(JSON.stringify({ path: request.path, names: request.pattern ? names.filter(name => new RegExp(request.pattern).test(name)) : names }));
    } else if (request.mode === 'admission') append(JSON.stringify({ selected: admission.selected.map(row => ({ path: row.path, blob: row.blob })), declarationPaths: admission.declarationPaths, binaries: admission.binaries }));
    else throw Error('unknown source-only request');
  }
} catch (error) { append('READ_HELPER_FAILURE ' + String(error?.stack ?? error)); process.exitCode = 1; }
const number = (await fs.readdir(root)).filter(name => /^read-\d+\.json$/.test(name)).length + 1;
await fs.writeFile(path.join(root, `read-${number}.json`), JSON.stringify({ requests, observations, readBytes, output, productExecutions: 0, nativeExecutions: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(output);
