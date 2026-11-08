import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = JSON.parse(fs.readFileSync(path.join(root, 'SEAL.json')));
const verify = () => {
  for (const entry of [...seal.files, seal.node]) {
    const filename = path.resolve(root, entry.path);
    const info = fs.lstatSync(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink());
    assert.equal(info.size, entry.bytes); assert.equal(info.mode & 0o7777, entry.mode); assert.equal(hash(fs.readFileSync(filename)), entry.sha256);
  }
};
verify();
fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
const receiptPath = path.join(root, 'runs/LAUNCH.json');
fs.writeFileSync(path.join(root, 'runs/ATTEMPT.lock'), `${hash(fs.readFileSync(path.join(root, 'SEAL.json')))}\n`, { flag: 'wx' });
const args = ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'controls.mjs')];
const receipt = { kind: 'SYNTHETIC_ONLY_ONE_LAUNCH', command: [seal.node.path, ...args], pid: null, exit: null, close: null, reaped: false, stdoutBytes: 0, stderrBytes: 0, errors: [], beforeBindings: true, afterBindings: false };
const child = spawn(seal.node.path, args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: root, TMPDIR: root } });
receipt.pid = child.pid ?? null;
const captures = { stdout: [], stderr: [] };
const failure = (phase, error) => receipt.errors.push({ phase, code: error.code, message: String(error.message ?? error).slice(0, 2048) });
const signal = name => { try { if (child.pid) process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') failure('signal', error); } };
const timers = [];
const stop = () => { signal('SIGTERM'); timers.push(setTimeout(() => signal('SIGKILL'), 2000)); };
for (const channel of ['stdout', 'stderr']) {
  child[channel].on('data', bytes => { const previous = receipt[`${channel}Bytes`]; receipt[`${channel}Bytes`] += bytes.length; if (previous < 65536) captures[channel].push(Buffer.from(bytes.subarray(0, 65536 - previous))); if (previous <= 65536 && receipt[`${channel}Bytes`] > 65536) { failure(channel, new Error('CAPTURE_CAP')); stop(); } });
  child[channel].on('error', error => { failure(channel, error); stop(); });
}
const closed = new Promise(resolve => { child.once('error', error => failure('spawn', error)); child.once('exit', (code, exitSignal) => { receipt.exit = { code, signal: exitSignal }; }); child.once('close', (code, closeSignal) => { receipt.close = { code, signal: closeSignal }; resolve(); }); });
timers.push(setTimeout(() => { failure('deadline', new Error('SYNTHETIC_DRIVER_DEADLINE')); stop(); }, 300000));
try { fs.writeFileSync(path.join(root, 'runs/LAUNCHED.json'), `${JSON.stringify(receipt)}\n`, { flag: 'wx' }); }
catch (error) { failure('launch-persistence', error); stop(); }
await closed;
for (const timer of timers) clearTimeout(timer);
const absent = identifier => { try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
try { receipt.reaped = Boolean(child.pid) && absent(child.pid) && absent(-child.pid); verify(); receipt.afterBindings = true; }
catch (error) { failure('post', error); }
for (const channel of ['stdout', 'stderr']) {
  const bytes = Buffer.concat(captures[channel]); receipt[`${channel}Sha256`] = hash(bytes); receipt[`${channel}Base64`] = bytes.toString('base64');
}
try { fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' }); }
catch (error) { failure('receipt-persistence', error); process.stderr.write(`${JSON.stringify(receipt)}\n`); }
console.log(JSON.stringify({ pid: receipt.pid, exit: receipt.exit, reaped: receipt.reaped, before: receipt.beforeBindings, after: receipt.afterBindings, stdout: Buffer.concat(captures.stdout).toString().slice(0, 2048), stderr: Buffer.concat(captures.stderr).toString().slice(0, 2048), errors: receipt.errors, receipt: receiptPath }));
if (receipt.exit?.code !== 0 || !receipt.reaped || receipt.errors.length) process.exitCode = 1;
