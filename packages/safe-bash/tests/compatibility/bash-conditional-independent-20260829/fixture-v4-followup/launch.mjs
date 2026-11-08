import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const started = 1787987251819, own = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(own, 'ACTUAL-01');
fs.mkdirSync(output);
const stdout = fs.openSync(path.join(output, 'outer.stdout.raw'), 'wx'), stderr = fs.openSync(path.join(output, 'outer.stderr.raw'), 'wx');
const events = fs.openSync(path.join(output, 'outer.events.jsonl'), 'wx');
const emit = row => fs.writeSync(events, JSON.stringify({ elapsedMs: Date.now() - started, ...row }) + '\n');
emit({ startup: true, pid: process.pid, execPath: process.execPath, version: process.version });
function hash(filename) {
  const before = fs.lstatSync(filename); assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 268435456);
  assert.equal(fs.realpathSync(filename), filename);
  const descriptor = fs.openSync(filename, 'r'), digest = createHash('sha256'), buffer = Buffer.alloc(65536); let size = 0;
  try { for (;;) { const count = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (!count) break; size += count; assert.ok(size <= before.size); digest.update(buffer.subarray(0, count)); } assert.equal(size, before.size); }
  finally { fs.closeSync(descriptor); }
  return digest.digest('hex');
}
const receipt = { closed: false, signals: [], captureBytes: 0, startedAt: new Date(started).toISOString() };
let child, done, timer, rescue, failure;
const stop = reason => {
  receipt.stopReason ??= reason;
  if (!child || receipt.closed || receipt.signals.length) return;
  receipt.signals.push('SIGTERM'); try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') receipt.signalError = String(error); }
  rescue = setTimeout(() => { if (!receipt.closed) { receipt.signals.push('SIGKILL'); try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') receipt.signalError = String(error); } } }, 1000);
};
try {
  assert.deepEqual(process.argv.slice(2), ['--run']);
  const seal = JSON.parse(fs.readFileSync(path.join(own, 'EXECUTION-SEAL.json')));
  assert.equal(process.execPath, seal.node.path); assert.equal(process.version, seal.node.version); assert.equal(hash(process.execPath), seal.node.sha256);
  for (const row of seal.files) { const file = path.join(own, row.path), stat = fs.lstatSync(file); assert.equal(stat.size, row.bytes); assert.equal(stat.mode & 511, row.mode); assert.equal(hash(file), row.sha256); }
  const environment = { PATH: path.dirname(process.execPath), HOME: output, TMPDIR: output, LC_ALL: 'C', NO_COLOR: '1', REVIEW_STARTED: String(started), REVIEW_SCRATCH: path.join(output, 'scratch') };
  const argv = [path.join(own, 'run.mjs'), '--run'];
  child = spawn(process.execPath, argv, { cwd: own, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  receipt.pid = child.pid;
  done = new Promise(resolve => { child.once('error', error => { receipt.spawnError = String(error); }); child.once('close', (code, signal) => { receipt.closed = true; receipt.code = code; receipt.signal = signal; resolve(); }); });
  for (const [stream, descriptor] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', bytes => {
    receipt.captureBytes += bytes.length;
    if (receipt.captureBytes > 16777216) { stop('outer capture cap'); return; }
    try { assert.equal(fs.writeSync(descriptor, bytes), bytes.length); } catch (error) { receipt.captureError = String(error); stop('capture persistence'); }
  });
  timer = setTimeout(() => stop('all-inclusive deadline'), Math.max(1, 1790000 - (Date.now() - started)));
  emit({ childEnrolled: true, pid: child.pid, argv, environment });
  await done;
  assert.ok(receipt.closed && receipt.signal === null && !receipt.spawnError && !receipt.captureError && receipt.signals.length === 0, 'unsafe coordinator settlement');
  let groupAbsent = false; try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') groupAbsent = true; else throw error; }
  assert.ok(groupAbsent, 'owned process group retirement unknown'); receipt.groupAbsent = groupAbsent;
  for (const row of seal.files) assert.equal(hash(path.join(own, row.path)), row.sha256);
  emit({ terminal: true, ...receipt });
} catch (error) {
  failure = String(error.stack ?? error); stop('outer exception'); if (done && !receipt.closed) await done;
} finally {
  clearTimeout(timer); clearTimeout(rescue);
  receipt.elapsedMs = Date.now() - started; receipt.failure = failure;
  fs.writeFileSync(path.join(output, 'OUTER.json'), JSON.stringify(receipt, null, 2) + '\n');
  for (const descriptor of [stdout, stderr, events]) fs.closeSync(descriptor);
}
assert.ok(Date.now() - started < 1800000, 'deadline includes final publication');
console.log(JSON.stringify(receipt));
process.exitCode = failure || !receipt.closed || receipt.signals.length ? 78 : receipt.code;



