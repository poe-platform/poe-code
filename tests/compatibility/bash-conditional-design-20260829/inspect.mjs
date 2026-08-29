import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const root = process.argv[2] === 'start' ? fs.mkdtempSync('/tmp/bash-conditional-design-') : JSON.parse(fs.readFileSync(path.join(own, 'CAPTURE.json'))).root;
const output = [];
try {
  if (process.argv[2] === 'start') {
    fs.writeFileSync(path.join(root, 'START.json'), JSON.stringify({ started: new Date().toISOString(), role: 'SOURCE_DATA_DESIGN', product: 0, native: 0 }), { flag: 'wx' });
    fs.writeFileSync(path.join(own, 'CAPTURE.json'), JSON.stringify({ root }), { flag: 'wx' });
    const manifestPath = path.join(repo, 'tests/compatibility/bash-strict-mode-author-20260829/SOURCE.json');
    const stat = fs.lstatSync(manifestPath); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024);
    const bytes = fs.readFileSync(manifestPath);
    assert.equal(hash(bytes), '75ac56902fdce22f8292c17c14d48287063a5544c46ac8c526b5d4572143bde2');
    const manifest = JSON.parse(bytes); assert.equal(manifest.computedTree, '26215b99cb379a9f825f803454f758fab5a3c8e9');
    const selected = manifest.inputs.filter(row => row.path.startsWith('src/shell/') || row.path.startsWith('src/commands/regex-execution/') || /^src\/.*(?:pattern|condition|test)\.(?:ts|md)$/.test(row.path) || ['src/contracts/command.ts','src/contracts/filesystem.ts','src/commands/internal.ts'].includes(row.path));
    assert.ok(selected.length <= 48);
    for (const [label, args, input] of [
      ['source', ['cat-file', '--batch'], selected.map(row => row.blob).join('\n') + '\n'],
      ['status', ['status', '--porcelain=v1', '-z', '--untracked-files=no']],
      ['index', ['diff', '--cached', '--name-only', '-z']],
    ]) {
      const result = spawnSync('/usr/bin/git', args, { cwd: repo, input, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
      fs.writeFileSync(path.join(root, `${label}.stdout`), result.stdout ?? '', { flag: 'wx' });
      fs.writeFileSync(path.join(root, `${label}.stderr`), result.stderr ?? '', { flag: 'wx' });
      output.push({ label, args, code: result.status, signal: result.signal, bytes: result.stdout?.length });
      assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
      if (label === 'source') {
        let cursor = 0;
        for (const row of selected) {
          assert.ok(!row.path.split('/').includes('AGENTS.md'));
          const end = result.stdout.indexOf(10, cursor); assert.equal(result.stdout.subarray(cursor, end).toString(), `${row.blob} blob ${row.bytes}`);
          cursor = end + 1; const body = result.stdout.subarray(cursor, cursor + row.bytes); cursor += row.bytes + 1;
          assert.equal(result.stdout[cursor - 1], 10); assert.equal(hash(body), row.sha256); assert.equal(blobHash(body), row.blob);
          const destination = path.join(root, row.path + '.data'); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, body, { flag: 'wx' });
        }
        assert.equal(cursor, result.stdout.length);
      }
    }
    const binding = { candidate: manifest.computedTree, sourceManifestSha256: hash(bytes), sourceRole: 'Accepted public80+c83/unit1 with frozen provisional unit2 928be558, not live HEAD or independent unit2 acceptance', unit1AcceptedBy: 'b0934e90c13f43c6a9b929e10c31388b2054036d', selected, children: output, productExecutions: 0 };
    fs.writeFileSync(path.join(root, 'BINDING.json'), JSON.stringify(binding, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ root, candidate: binding.candidate, selected: selected.map(row => row.path), children: output }));
  } else if (process.argv[2] === 'additional') {
    const bytes = fs.readFileSync(path.join(repo, 'tests/compatibility/bash-strict-mode-author-20260829/SOURCE.json'));
    assert.equal(hash(bytes), '75ac56902fdce22f8292c17c14d48287063a5544c46ac8c526b5d4572143bde2');
    const manifest = JSON.parse(bytes), bindingPath = path.join(root, 'BINDING.json'), binding = JSON.parse(fs.readFileSync(bindingPath));
    const selected = manifest.inputs.filter(row => /^src\/commands\/[^/]+\.ts$/.test(row.path) && !binding.selected.some(old => old.path === row.path));
    assert.ok(selected.length <= 16 && binding.selected.length + selected.length <= 48);
    const result = spawnSync('/usr/bin/git', ['cat-file', '--batch'], { cwd: repo, input: selected.map(row => row.blob).join('\n') + '\n', env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(root, 'additional.stdout'), result.stdout ?? '', { flag: 'wx' });
    fs.writeFileSync(path.join(root, 'additional.stderr'), result.stderr ?? '', { flag: 'wx' });
    assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
    let cursor = 0;
    for (const row of selected) {
      const end = result.stdout.indexOf(10, cursor); assert.equal(result.stdout.subarray(cursor, end).toString(), `${row.blob} blob ${row.bytes}`);
      cursor = end + 1; const body = result.stdout.subarray(cursor, cursor + row.bytes); cursor += row.bytes + 1;
      assert.equal(result.stdout[cursor - 1], 10); assert.equal(hash(body), row.sha256); assert.equal(blobHash(body), row.blob);
      fs.writeFileSync(path.join(root, row.path + '.data'), body, { flag: 'wx' });
    }
    assert.equal(cursor, result.stdout.length);
    fs.writeFileSync(path.join(root, 'ADDITIONAL.json'), JSON.stringify({ selected, children: [{ args: ['cat-file', '--batch'], code: result.status, signal: result.signal }] }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(selected.map(row => row.path)));
  } else {
    assert.equal(process.argv[2], 'read');
    const requests = JSON.parse(process.argv[3]), binding = JSON.parse(fs.readFileSync(path.join(root, 'BINDING.json')));
    if (fs.existsSync(path.join(root, 'ADDITIONAL.json'))) binding.selected.push(...JSON.parse(fs.readFileSync(path.join(root, 'ADDITIONAL.json'))).selected);
    assert.ok(requests.length <= 6);
    for (const request of requests) {
      const row = binding.selected.find(row => row.path === request.path); assert.ok(row);
      const bytes = fs.readFileSync(path.join(root, row.path + '.data')); assert.equal(hash(bytes), row.sha256);
      const lines = bytes.toString().split('\n');
      const text = request.pattern ? lines.flatMap((line, index) => new RegExp(request.pattern, 'u').test(line) ? [`${index + 1}:${line}`] : []).join('\n') : lines.slice((request.from ?? 1) - 1, request.to ?? lines.length).map((line, index) => `${(request.from ?? 1) + index}:${line}`).join('\n');
      output.push({ path: row.path, sha256: row.sha256, text });
    }
    const data = JSON.stringify(output, null, 2); assert.ok(Buffer.byteLength(data) <= 512 * 1024);
    fs.writeFileSync(path.join(root, `read-${Date.now()}.json`), data, { flag: 'wx' });
    for (const row of output) console.log(`${row.path} ${row.sha256}\n${row.text}`);
  }
} catch (error) { fs.writeFileSync(path.join(root, `ERROR-${Date.now()}.json`), JSON.stringify({ output, error: String(error), stack: error?.stack }), { flag: 'wx' }); throw error; }
