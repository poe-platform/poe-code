import { spawnSync } from 'node:child_process';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';
import { artifact } from './artifacts.mjs';

const [name, executable, ...args] = process.argv.slice(2);
const before = sourceSnapshot();
const startedAt = new Date().toISOString();
const result = spawnSync(executable, args, { encoding: 'utf8', shell: false, timeout: 120000, killSignal: 'SIGKILL',
  maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '--unhandled-rejections=strict' } });
const after = sourceSnapshot();
const summary = Object.fromEntries([...result.stdout?.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gmu) ?? []].map(match => [match[1], Number(match[2])]));
const failures = [...result.stdout?.matchAll(/^not ok \d+ - (.*)$/gmu) ?? []].map(match => match[1]);
const stable = before.productSha256 === after.productSha256 && JSON.stringify(before.tooling) === JSON.stringify(after.tooling);
artifact(`${name}.json`, { startedAt, endedAt: new Date().toISOString(), command: [executable, ...args], watchdogMs: 120000,
  strictUnhandledRejections: true, status: result.status, signal: result.signal, error: result.error?.stack,
  before, after, stable, summary, failures, stdout: result.stdout, stderr: result.stderr });
console.log(JSON.stringify({ name, status: result.status, signal: result.signal, stable, summary, failures, stderr: result.stderr }));
process.exitCode = !stable ? 2 : result.status ?? 3;
