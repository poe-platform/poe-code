import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { authorize } from './authorization.mjs';
import { fixtureFs } from './vfs.mjs';

assert(process.send && process.env.SAFETY_RUN_NONCE?.length === 32, 'Owned gated child only');
const { approval, snapshot, sealed } = authorize(process.env.SAFETY_AUTH, process.env.SAFETY_AUTH_SHA256);
const entry = sealed.cases.find(value => value.id === process.env.SAFETY_CASE);
assert(entry && approval.proofs[entry.expected.proof].status === 'approved');
const heapSizeLimit = getHeapStatistics().heap_size_limit;
assert(heapSizeLimit <= sealed.caps.heapMiB * 1024 * 1024, 'V8 heap cap must be effective before product import');
const heartbeat = () => process.send?.({ kind: 'rss', bytes: process.memoryUsage().rss });
heartbeat();
const monitor = setInterval(heartbeat, 10);
monitor.unref();
const importEntry = key => import(pathToFileURL(resolve(snapshot, approval.entrypoints[key])).href);
const { Shell } = await importEntry('shell');
const { FsError } = await importEntry('contracts');
const commands = await importEntry(entry.family);
const command = entry.family === 'tree' ? commands.createTreeCommand({ limits: entry.limits }) : commands.createFileCommand({ limits: entry.limits });
const trace = { calls: [], streams: [], mutations: 0 };
const fs = fixtureFs(entry, FsError, trace);
const stdout = [];
const stderr = [];
let collected = 0;
let commandInvocations = 0;
let activeWrites = 0;
const sink = chunks => ({ async write(bytes) {
  assert(bytes instanceof Uint8Array);
  assert.equal(++activeWrites, 1, 'Writes must await backpressure');
  try {
    collected += bytes.length;
    assert(collected <= sealed.caps.captureBytes, 'Product byte capture cap');
    chunks.push(new Uint8Array(bytes));
    await Promise.resolve();
  } finally { activeWrites--; }
} });
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const shell = new Shell({ fs, cwd: '/', env: {}, limits: { maxOutputBytes: sealed.caps.captureBytes, maxCommands: 8, maxSourceBytes: 65536, maxExpansionBytes: 65536, maxExpansionFields: 256, pipeHighWaterMark: 1024 } });
shell.register({ ...command, async execute(context) {
  assert.equal(++commandInvocations, 1);
  assert.deepEqual(context.args, entry.args, 'Actual Shell must dispatch exact literal argv');
  process.send?.({ kind: 'command-start', id: entry.id });
  return command.execute(context);
} });
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error).slice(0, 1024));
process.on('unhandledRejection', onUnhandled);
const report = { id: entry.id, actualShell: true, shellDisposed: false, rejected: false, exitCode: null, heapSizeLimit };
try {
  const result = await shell.exec([entry.family, ...entry.args.map(quote)].join(' '), { stdout: sink(stdout), stderr: sink(stderr), signal: new AbortController().signal });
  report.exitCode = result.exitCode;
} catch (error) {
  const message = String(error?.message ?? error);
  report.rejected = true;
  report.error = { name: error?.name, code: error?.code, message: message.slice(0, 4096), truncated: message.length > 4096 };
} finally {
  await shell.dispose();
  report.shellDisposed = true;
}
await new Promise(resolveTurn => setImmediate(resolveTurn));
await new Promise(resolveTurn => setImmediate(resolveTurn));
clearInterval(monitor);
process.off('unhandledRejection', onUnhandled);
heartbeat();
Object.assign(report, trace, { commandInvocations, unhandled, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'),
  stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64'),
  stdoutBytes: stdout.reduce((total, bytes) => total + bytes.length, 0), stderrBytes: stderr.reduce((total, bytes) => total + bytes.length, 0) });
assert(Buffer.byteLength(JSON.stringify(report)) <= sealed.caps.ipcBytes);
await new Promise((resolveSend, reject) => process.send({ kind: 'result', report }, error => error ? reject(error) : resolveSend()));
process.disconnect();
