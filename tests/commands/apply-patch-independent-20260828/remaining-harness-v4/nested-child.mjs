import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

assert.equal(process.permission.has('child'), false);
let rejection;
try {
  spawnSync(process.execPath, ['-e', 'process.exit(91)'], { stdio: 'ignore', env: {} });
} catch (reason) { rejection = reason; }
assert.equal(rejection?.code, 'ERR_ACCESS_DENIED');
assert.equal(rejection?.permission, 'ChildProcess');
process.stdout.write(JSON.stringify({ kind: 'nested-refused', pid: process.pid, ppid: process.ppid, code: rejection.code, permission: rejection.permission }) + '\n');
process.stdin.setEncoding('utf8');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  assert.ok(input.length <= 8);
}
assert.equal(input, 'release\n');
process.stdout.write(JSON.stringify({ kind: 'released', pid: process.pid, ppid: process.ppid }) + '\n');
