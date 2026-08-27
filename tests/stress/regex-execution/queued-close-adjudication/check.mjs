import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const owned = 'tests/stress/regex-execution/queued-close-adjudication';
const command = [process.execPath, '--unhandled-rejections=strict', 'node_modules/typescript/bin/tsc',
  '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--types', 'node', '--skipLibCheck', `${owned}/controls.test.ts`];
const started = new Date().toISOString();
const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
  env: { ...process.env, NODE_OPTIONS: '--unhandled-rejections=strict' } });
let pidAbsent = false;
try { process.kill(result.pid, 0); } catch (error) { if (error.code === 'ESRCH') pidAbsent = true; else throw error; }
const evidence = { started, finished: new Date().toISOString(), command, pid: result.pid, pidAbsent,
  status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message,
  harnessSha256: createHash('sha256').update(readFileSync(`${owned}/check.mjs`)).digest('hex') };
writeFileSync(`${owned}/evidence/types.json`, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(evidence));
assert.equal(result.status, 0);
assert.equal(pidAbsent, true);
