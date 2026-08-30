import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
let active = false;
let launches = 0;
let retained = 0;
export async function runCaptured(id, args) {
  assert.ok(!active && launches < 3 && ['prepare', 'eight', 'novel'].includes(id));
  const inputs = JSON.parse(await fs.readFile(path.join(home, 'INPUTS.json')));
  for (const entry of inputs.files) {
    const stat = await fs.lstat(entry.absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, entry.bytes); assert.equal(stat.mode & 0o7777, entry.mode);
    const handle = await fs.open(entry.absolute, 'r');
    const hash = createHash('sha256');
    try { for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes); }
    finally { await handle.close(); }
    assert.equal(hash.digest('hex'), entry.sha256, entry.absolute);
  }
  const directory = path.join(home, 'outer', id);
  await fs.mkdir(directory, { recursive: true });
  const streams = {};
  for (const name of ['stdout', 'stderr', 'records']) streams[name] = await fs.open(path.join(directory, name + '.raw'), 'wx', 0o600);
  const hashes = Object.fromEntries(Object.keys(streams).map(name => [name, createHash('sha256')]));
  const receipt = { id, executable: inputs.node, args, cwd: home, captureOpenedBeforeSpawn: true, pid: null, exit: null, close: null, errors: [], signals: [], observed: { stdout: 0, stderr: 0, records: 0 }, retained: { stdout: 0, stderr: 0, records: 0 }, globalAbsenceClaim: false };
  await fs.writeFile(path.join(directory, 'INTENT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  active = true; launches++;
  const child = spawn(inputs.node, args, { cwd: home, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: home, TMPDIR: home }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  receipt.pid = child.pid ?? null;
  let total = 0, writes = Promise.resolve(), killTimer;
  const signal = name => { if (child.kill(name)) receipt.signals.push(name); };
  const stop = code => {
    receipt.errors.push(code);
    if (killTimer) return;
    signal('SIGTERM');
    killTimer = setTimeout(() => signal('SIGKILL'), 2000);
  };
  for (const [index, name] of [[1, 'stdout'], [2, 'stderr'], [3, 'records']]) {
    child.stdio[index].on('data', bytes => {
      total += bytes.length; receipt.observed[name] += bytes.length;
      if (total > 16 * 1024 * 1024 || retained + bytes.length > 64 * 1024 * 1024) { stop('OUTER_CAPTURE_CAP'); return; }
      const owned = Buffer.from(bytes);
      retained += owned.length; receipt.retained[name] += owned.length; hashes[name].update(owned);
      writes = writes.then(async () => {
        let offset = 0;
        while (offset < owned.length) {
          const result = await streams[name].write(owned, offset, owned.length - offset);
          if (!result.bytesWritten) throw Error('OUTER_ZERO_WRITE');
          offset += result.bytesWritten;
        }
      }).catch(error => stop(`OUTER_WRITE:${error.message}`));
    });
    child.stdio[index].on('error', error => stop(`OUTER_PIPE:${error.message}`));
  }
  child.once('exit', (code, signalName) => { receipt.exit = { code, signal: signalName }; });
  child.once('error', error => stop(`SPAWN:${error.message}`));
  const timer = setTimeout(() => stop('OUTER_DEADLINE'), 300000);
  await new Promise(resolve => child.once('close', (code, signalName) => { receipt.close = { code, signal: signalName }; resolve(); }));
  clearTimeout(timer); clearTimeout(killTimer);
  await writes;
  for (const handle of Object.values(streams)) { await handle.sync(); await handle.close(); }
  active = false;
  receipt.hashes = Object.fromEntries(Object.entries(hashes).map(([name, hash]) => [name, hash.digest('hex')]));
  await fs.writeFile(path.join(directory, 'RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  assert.deepEqual(receipt.errors, []); assert.deepEqual(receipt.signals, []);
  assert.ok(receipt.exit && receipt.close && receipt.exit.code === receipt.close.code);
  assert.deepEqual(receipt.observed, receipt.retained);
  return receipt;
}
