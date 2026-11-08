import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, '../../..');
const root = fs.mkdtempSync('/tmp/bash-conditional-author-prep-');
const log = { started: new Date().toISOString(), role: 'SOURCE_PREPARATION', children: [], root };
const save = () => fs.writeFileSync(path.join(root, 'CAPTURE.json'), JSON.stringify(log, null, 2));
const sha = body => createHash('sha256').update(body).digest('hex');
save();
try {
  const body = fs.readFileSync(path.join(repo, 'tests/compatibility/bash-strict-mode-author-20260829/SOURCE.json'));
  assert.equal(sha(body), '75ac56902fdce22f8292c17c14d48287063a5544c46ac8c526b5d4572143bde2');
  const source = JSON.parse(body); assert.equal(source.computedTree, '26215b99cb379a9f825f803454f758fab5a3c8e9');
  for (const [name, args] of [['status', ['status', '--porcelain=v1', '-z']], ['index', ['diff', '--cached', '--name-only', '-z']]]) {
    const result = spawnSync('/usr/bin/git', args, { cwd: repo, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 1024 * 1024 });
    fs.writeFileSync(path.join(root, name + '.stdout'), result.stdout ?? ''); fs.writeFileSync(path.join(root, name + '.stderr'), result.stderr ?? '');
    log.children.push({ name, status: result.status, signal: result.signal }); save(); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
  }
  const paths = ['src/shell/parser.ts','src/shell/runtime.ts','src/shell/display.ts'];
  log.owned = paths.map(name => { const expected = source.inputs.find(row => row.path === name), stat = fs.lstatSync(path.join(repo, name)); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024); const actual = sha(fs.readFileSync(path.join(repo, name))); assert.equal(actual, expected.sha256); return { path: name, sha256: actual }; });
  fs.writeFileSync(path.join(own, 'PREP.json'), JSON.stringify(log, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(log));
} catch (error) { log.error = { message: String(error), stack: error?.stack }; save(); throw error; }
save();
