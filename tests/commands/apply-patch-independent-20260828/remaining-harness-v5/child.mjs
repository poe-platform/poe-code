import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const [stage, mainFilename] = process.argv.slice(2);
const env = Object.fromEntries(Object.keys(process.env).sort().map(key => [key, process.env[key]]));
process.stdout.write(JSON.stringify({ kind: 'startup-env', stage, pid: process.pid, ppid: process.ppid, env }) + '\n');
assert.equal(process.permission.has('child'), false);
assert.deepEqual(Object.keys(env), ['__CF_USER_TEXT_ENCODING'], 'unbound environment key STOP');
assert.equal(typeof env.__CF_USER_TEXT_ENCODING, 'string');
assert.ok(env.__CF_USER_TEXT_ENCODING.length > 0 && Buffer.byteLength(env.__CF_USER_TEXT_ENCODING) <= 256);
if (stage !== 'discovery') {
  const main = JSON.parse(fs.readFileSync(mainFilename, 'utf8'));
  const expected = stage === 'refusal' ? main.intentionalRefusalExpectedEnv : main.nodeEnv;
  assert.deepEqual(env, expected, stage === 'refusal' ? 'V5_INTENTIONAL_STARTUP_REFUSAL' : 'V5_STARTUP_ENV_ADMISSION');
  if (stage === 'positive') {
    const { runDataControls } = await import('./data-controls.mjs');
    await runDataControls(main);
  } else if (stage === 'nested') {
    let rejection;
    try { spawnSync(process.execPath, ['-e', 'process.exit(91)'], { stdio: 'ignore', env: main.nodeEnv }); }
    catch (reason) { rejection = reason; }
    assert.equal(rejection?.code, 'ERR_ACCESS_DENIED');
    assert.equal(rejection?.permission, 'ChildProcess');
    process.stdout.write(JSON.stringify({ kind: 'nested-refused', pid: process.pid, ppid: process.ppid, code: rejection.code, permission: rejection.permission }) + '\n');
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; assert.ok(input.length <= 8); }
    assert.equal(input, 'release\n');
    process.stdout.write(JSON.stringify({ kind: 'released', pid: process.pid, ppid: process.ppid }) + '\n');
  } else assert.fail('unknown startup stage');
}
