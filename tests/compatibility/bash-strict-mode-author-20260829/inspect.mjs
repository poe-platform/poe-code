import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(own, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = process.argv[2] === 'start' ? fs.mkdtempSync('/tmp/strict-mode-author-preparation-') : JSON.parse(fs.readFileSync(path.join(own, 'PREPARATION-ROOT.json'))).root;
const output = [];
try {
  if (process.argv[2] === 'start') {
    fs.writeFileSync(path.join(root, 'START.json'), JSON.stringify({ started: new Date().toISOString(), role: 'AUTHOR_PREPARATION', product: 0 }), { flag: 'wx' });
    fs.writeFileSync(path.join(own, 'PREPARATION-ROOT.json'), JSON.stringify({ root }), { flag: 'wx' });
    for (const [name, args] of [['status', ['status', '--porcelain=v1', '-z', '--untracked-files=no']], ['index', ['diff', '--cached', '--name-only', '-z']], ['head', ['rev-parse', 'HEAD']], ['source-diff', ['diff', '1e9b83d7', '--', 'src/shell/runtime.ts', 'src/shell/parser.ts']]]) {
      const result = spawnSync('/usr/bin/git', args, { cwd: repo, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      fs.writeFileSync(path.join(root, `${name}.stdout`), result.stdout ?? '', { flag: 'wx' });
      fs.writeFileSync(path.join(root, `${name}.stderr`), result.stderr ?? '', { flag: 'wx' });
      output.push({ name, code: result.status, signal: result.signal, bytes: result.stdout?.length });
      assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
      if (name === 'source-diff') assert.equal(result.stdout.length, 0, 'owned runtime/parser differs from approved provisional overlay');
    }
    for (const relative of ['tests/compatibility/bash-redirection-author-20260829', 'tests/integration/git-public-20260829']) output.push({ relative, entries: fs.readdirSync(path.join(repo, relative)) });
  } else {
    assert.equal(process.argv[2], 'read');
    const requests = JSON.parse(process.argv[3]); assert.ok(requests.length <= 8);
    for (const request of requests) {
      assert.ok(!request.path.includes('..') && !request.path.split('/').includes('AGENTS.md'));
      const filename = path.join(repo, request.path), stat = fs.lstatSync(filename);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 768 * 1024);
      assert.ok(/\.(?:ts|mjs|json|md)$/.test(filename));
      const bytes = fs.readFileSync(filename), lines = bytes.toString().split('\n');
      const text = request.pattern ? lines.flatMap((line, index) => new RegExp(request.pattern, 'u').test(line) ? [`${index + 1}:${line}`] : []).join('\n') : lines.slice((request.from ?? 1) - 1, request.to ?? lines.length).map((line, index) => `${(request.from ?? 1) + index}:${line}`).join('\n');
      output.push({ path: request.path, sha256: hash(bytes), text });
    }
  }
  const data = JSON.stringify(output, null, 2); assert.ok(Buffer.byteLength(data) <= 512 * 1024);
  fs.writeFileSync(path.join(root, `read-${Date.now()}.json`), data, { flag: 'wx' });
  for (const row of output) console.log(row.text === undefined ? JSON.stringify(row) : `${row.path} SHA256=${row.sha256}\n${row.text}`);
} catch (error) { fs.writeFileSync(path.join(root, `ERROR-${Date.now()}.json`), JSON.stringify({ output, error: String(error), stack: error?.stack }), { flag: 'wx' }); throw error; }
