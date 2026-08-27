import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { artifact } from './artifacts.mjs';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';

const [name, command, ...args] = process.argv.slice(2);
assert.ok(name && command);
const before = sourceSnapshot();
const result = spawnSync(command, args, { env: { ...process.env, NODE_OPTIONS: '--unhandled-rejections=strict' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
assert.ifError(result.error);
const after = sourceSnapshot();
artifact(`${name}.json`, { recordedAt: new Date().toISOString(), command: [command, ...args], status: result.status, signal: result.signal, before, after, structuredStable: before.structuredSha256 === after.structuredSha256, productStable: before.productSha256 === after.productSha256, stdout: result.stdout, stderr: result.stderr });
console.log(JSON.stringify({ name, status: result.status, structuredSha256: after.structuredSha256, tail: result.stdout.split('\n').slice(-14), stderr: result.stderr }, null, 2));
