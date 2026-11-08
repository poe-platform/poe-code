import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
let active = false, launched = 0;
export async function run(id) {
  assert.ok(!active && launched < 2 && ['author', 'novel'].includes(id));
  const destination = path.join(home, 'outer-capture', id);
  await fs.mkdir(destination, { recursive: true });
  const files = {};
  for (const name of ['stdout', 'stderr', 'fd3']) files[name] = await fs.open(path.join(destination, name + '.raw'), 'wx', 0o600);
  const receipt = { id, openedBeforeAdmission: true, pid: null, exit: null, close: null, observed: { stdout: 0, stderr: 0, fd3: 0 }, retained: { stdout: 0, stderr: 0, fd3: 0 }, failures: [], globalAbsenceClaim: false };
  const inputs = JSON.parse(await fs.readFile(path.join(home, 'INPUTS.json')));
  await fs.writeFile(path.join(destination, 'INTENT.json'), JSON.stringify({ ...receipt, node: inputs.node.path }, null, 2) + '\n', { flag: 'wx' });
  try {
    for (const entry of inputs.files) {
      const stat = await fs.lstat(entry.path);
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      assert.equal(stat.size, entry.bytes); assert.equal(stat.mode & 0o7777, entry.mode);
      const handle = await fs.open(entry.path, 'r');
      const hash = createHash('sha256');
      try { for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes); }
      finally { await handle.close(); }
      assert.equal(hash.digest('hex'), entry.sha256, entry.path);
    }
    active = true; launched++;
    const args = ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(home, id === 'author' ? 'fixture/controls.mjs' : 'novel.mjs'), ...(id === 'author' ? [inputs.adapterSealSha256] : [])];
    receipt.args = args;
    const child = spawn(inputs.node.path, args, { cwd: home, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: home, TMPDIR: home }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    receipt.pid = child.pid ?? null;
    let writes = Promise.resolve(), total = 0, killTimer;
    const stop = code => {
      receipt.failures.push(code);
      if (!killTimer) { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); }
    };
    for (const [index, name] of [[1, 'stdout'], [2, 'stderr'], [3, 'fd3']]) {
      child.stdio[index].on('data', bytes => {
        total += bytes.length; receipt.observed[name] += bytes.length;
        if (total > 4 * 1024 * 1024) { stop('OUTER_CAPTURE_CAP'); return; }
        const copy = Buffer.from(bytes);
        receipt.retained[name] += copy.length;
        writes = writes.then(async () => {
          let offset = 0;
          while (offset < copy.length) {
            const result = await files[name].write(copy, offset, copy.length - offset);
            assert.ok(result.bytesWritten > 0); offset += result.bytesWritten;
          }
        }).catch(error => stop(`WRITE:${error.message}`));
      });
      child.stdio[index].on('error', error => stop(`PIPE:${error.message}`));
    }
    child.once('exit', (code, signal) => { receipt.exit = { code, signal }; });
    child.once('error', error => stop(`SPAWN:${error.message}`));
    const timer = setTimeout(() => stop('OUTER_DEADLINE'), 210000);
    await new Promise(resolve => child.once('close', (code, signal) => { receipt.close = { code, signal }; resolve(); }));
    clearTimeout(timer); clearTimeout(killTimer); await writes;
  } catch (error) { receipt.failures.push({ phase: 'review-owner', message: error?.message ?? String(error) }); }
  finally {
    for (const [name, handle] of Object.entries(files)) {
      try { await handle.sync(); } catch (error) { receipt.failures.push({ phase: name + ':sync', message: String(error) }); }
      try { await handle.close(); } catch (error) { receipt.failures.push({ phase: name + ':close', message: String(error) }); }
    }
    active = false;
    await fs.writeFile(path.join(destination, 'RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  }
  assert.deepEqual(receipt.failures, []);
  assert.ok(receipt.exit && receipt.close); assert.deepEqual(receipt.exit, receipt.close);
  assert.deepEqual(receipt.observed, receipt.retained);
  return receipt;
}
