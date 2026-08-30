import * as fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export const DATA_MAX = 16777216;
export const WORK_MAX = 536870912;
export const CAPTURE_MAX = 100663296;
export const DEADLINE = Date.parse('2026-08-29T16:08:17Z');
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function read(filename, maximum = DATA_MAX) {
  const before = fs.lstatSync(filename); assert(before.isFile() && before.size <= maximum, 'regular bounded file: ' + filename);
  const bytes = fs.readFileSync(filename), after = fs.lstatSync(filename);
  assert.equal(bytes.length, before.size); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.mtimeMs, before.mtimeMs);
  return bytes;
}
export function digest(filename, binary = false) {
  const before = fs.lstatSync(filename); assert(before.isFile() && (binary || before.size <= DATA_MAX), filename);
  const hasher = crypto.createHash('sha256'), descriptor = fs.openSync(filename, 'r'), buffer = Buffer.alloc(65536); let bytes = 0;
  try { let count; while ((count = fs.readSync(descriptor, buffer))) { bytes += count; assert(bytes <= before.size); hasher.update(buffer.subarray(0, count)); } } finally { fs.closeSync(descriptor); }
  const after = fs.lstatSync(filename); assert.equal(bytes, before.size); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
  return { path: filename, size: bytes, mode: before.mode & 511, sha256: hasher.digest('hex') };
}
export function verify(row, filename = row.path, binary = false) {
  const actual = digest(filename, binary); assert.equal(actual.size, row.size ?? row.bytes, filename); assert.equal(actual.sha256, row.sha256, filename); if (row.mode !== undefined) assert.equal(actual.mode, typeof row.mode === 'string' ? Number.parseInt(row.mode, 8) & 511 : row.mode, filename); return actual;
}
export function inventory(root) {
  const rows = [], directories = []; let bytes = 0;
  const walk = directory => { for (const name of fs.readdirSync(directory).sort()) { const filename = path.join(directory, name), stat = fs.lstatSync(filename), relative = path.relative(root, filename); if (stat.isDirectory()) { directories.push(relative); walk(filename); } else { assert(stat.isFile(), 'no linked owned member'); const row = digest(filename); bytes += row.size; assert(bytes <= WORK_MAX); rows.push({ path: relative, size: row.size, mode: row.mode, sha256: row.sha256 }); } } };
  walk(root); rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))); directories.sort(); return { bytes, directories, rows };
}
export function writer(root) {
  let admitted = inventory(root).bytes;
  return Object.freeze({
    bytes(filename, bytes, mode = 0o600) { assert(Buffer.isBuffer(bytes)); assert(bytes.length <= DATA_MAX); assert(admitted + bytes.length <= WORK_MAX); assert(path.resolve(filename).startsWith(path.resolve(root) + '/')); admitted += bytes.length; fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx', mode }); return digest(filename); },
    json(filename, value, mode = 0o600) { return this.bytes(filename, Buffer.from(JSON.stringify(value, null, 2) + '\n'), mode); },
    snapshot() { return Object.freeze({ conservativelyAdmittedBytes: admitted, fresh: inventory(root) }); },
  });
}
export function createOwner({ root, output, env, write }) {
  const receipts = []; let captured = 0, starts = 0;
  return {
    receipts,
    async run(id, executable, args, { cwd, input, maximumMilliseconds = 120000 } = {}) {
      assert(Date.now() + maximumMilliseconds + 180000 < DEADLINE, 'command+retirement+publication admission');
      assert(++starts <= 8, 'fixed producer child ceiling');
      const stdoutPath = path.join(output, id + '.stdout'), stderrPath = path.join(output, id + '.stderr');
      const stdoutFd = fs.openSync(stdoutPath, 'wx', 0o600), stderrFd = fs.openSync(stderrPath, 'wx', 0o600);
      const receipt = { id, executable, args, cwd, started: new Date().toISOString(), pid: null, exit: null, close: null, stdoutEOF: false, stderrEOF: false, signals: [], primaryPresent: false, primary: null, bytes: { stdout: 0, stderr: 0 } };
      receipts.push(receipt); let child, deadlineTimer, retirementTimer;
      const fail = reason => { if (!receipt.primaryPresent) { receipt.primaryPresent = true; receipt.primary = String(reason); } };
      try {
        await new Promise(resolve => {
          child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); receipt.pid = child.pid ?? null;
          const retire = () => { if (child.pid && receipt.close === null) { receipt.signals.push('SIGKILL'); child.kill('SIGKILL'); retirementTimer = setTimeout(() => { fail('retirement not observed'); resolve(); }, 3000); } };
          child.once('error', reason => { fail(reason); if (!child.pid) resolve(); });
          child.once('exit', (code, signal) => { receipt.exit = { code, signal }; });
          child.once('close', (code, signal) => { receipt.close = { code, signal }; resolve(); });
          for (const [kind, stream, descriptor] of [['stdout', child.stdout, stdoutFd], ['stderr', child.stderr, stderrFd]]) {
            stream.once('end', () => { receipt[kind + 'EOF'] = true; });
            stream.on('error', reason => { fail(reason); retire(); });
            stream.on('data', bytes => { try { assert(receipt.bytes[kind] + bytes.length <= DATA_MAX && captured + bytes.length <= CAPTURE_MAX); captured += bytes.length; receipt.bytes[kind] += bytes.length; let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert(Number.isSafeInteger(count) && count > 0 && count <= bytes.length - offset); offset += count; } } catch (reason) { fail(reason); retire(); } });
          }
          child.stdin.on('error', reason => { fail(reason); retire(); });
          child.stdin.end(input);
          deadlineTimer = setTimeout(() => { fail('command deadline'); retire(); }, maximumMilliseconds);
        });
      } finally { clearTimeout(deadlineTimer); clearTimeout(retirementTimer); fs.closeSync(stdoutFd); fs.closeSync(stderrFd); }
      receipt.finished = new Date().toISOString(); receipt.stdout = digest(stdoutPath); receipt.stderr = digest(stderrPath);
      receipt.retired = receipt.exit !== null && receipt.close !== null && receipt.stdoutEOF && receipt.stderrEOF;
      write.json(path.join(output, id + '.json'), receipt);
      console.log(JSON.stringify({ phase: 'child-closed', id, pid: receipt.pid, exit: receipt.exit, close: receipt.close, retired: receipt.retired, bytes: receipt.bytes }));
      assert(inventory(root).bytes < WORK_MAX);
      assert(!receipt.primaryPresent && receipt.retired && receipt.close.code === 0 && receipt.close.signal === null, id + ' failed; exact receipt preserved');
      return read(stdoutPath);
    },
  };
}
