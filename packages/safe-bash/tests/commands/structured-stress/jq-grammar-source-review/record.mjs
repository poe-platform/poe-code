import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { artifact, root, snapshot } from './common.mjs';

const [name, ...command] = process.argv.slice(2);
assert.ok(command.length);
const before = snapshot();
const startedAt = new Date().toISOString();
const result = spawnSync(command[0], command.slice(1), { cwd: root, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --unhandled-rejections=strict` }, timeout: 240000, maxBuffer: 16 * 1024 * 1024, shell: false });
const after = snapshot();
const stdout = result.stdout?.toString() ?? '';
const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
artifact(`${name}.json`, { command, before, after, startedAt, endedAt: new Date().toISOString(), watchdogMs: 240000,
  status: result.status, signal: result.signal, error: result.error?.message, counts, stdout, stderr: result.stderr?.toString(),
  stdoutHex: result.stdout?.toString('hex'), stderrHex: result.stderr?.toString('hex'), stableProduct: before.productSha256 === after.productSha256 });
console.log(name, result.status, counts, before.productSha256 === after.productSha256);
process.exitCode = result.status ?? 2;
