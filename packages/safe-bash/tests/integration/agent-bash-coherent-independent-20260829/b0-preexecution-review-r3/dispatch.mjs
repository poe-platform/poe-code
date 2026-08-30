import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const here = import.meta.dirname;
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sealBytes = fs.readFileSync(path.join(here, 'CONTROL-PRESEAL.json'));
assert.equal(digest(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
const checkTime = () => assert.ok(Date.now() < Date.parse(seal.deadline) - 30000);
checkTime();
for (const row of seal.files) {
  const file = path.join(here, row.path), metadata = fs.lstatSync(file);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink()); assert.equal(metadata.size, row.bytes);
  assert.equal(digest(fs.readFileSync(file)), row.sha256);
}
const metadata = fs.lstatSync(node); assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
assert.equal(metadata.size, 112989184);
const nodeHash = crypto.createHash('sha256');
for await (const chunk of fs.createReadStream(node, { highWaterMark: 65536 })) nodeHash.update(chunk);
assert.equal(nodeHash.digest('hex'), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
const records = [];
for (const role of seal.roles) {
  checkTime();
  const output = fs.openSync(path.join(here, role.id + '.stdout'), 'wx');
  let errorOutput;
  try { errorOutput = fs.openSync(path.join(here, role.id + '.stderr'), 'wx'); }
  catch (error) { fs.closeSync(output); throw error; }
  try {
    const args = ['--experimental-permission', '--allow-fs-read=' + here,
      '--allow-fs-read=/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/stage-a-r2/PRESEAL.json',
      '--allow-fs-read=/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/v4/PRESEAL.json',
      '--allow-fs-write=' + here, path.join(here, role.entry)];
    const record = await new Promise((resolve, reject) => {
      const started = new Date().toISOString();
      const child = spawn(node, args, { cwd: here, detached: true, env: { PATH: '/usr/bin:/bin', HOME: here, TMPDIR: here, LC_ALL: 'C', TZ: 'UTC', NODE_OPTIONS: '' }, stdio: ['ignore', output, errorOutput] });
      let exited = false, violation;
      const timer = setTimeout(() => { violation = 'deadline'; child.kill('SIGKILL'); }, 30000);
      const monitor = setInterval(() => {
        if (fs.fstatSync(output).size + fs.fstatSync(errorOutput).size > 1048576) { violation = 'capture'; child.kill('SIGKILL'); }
      }, 20);
      child.once('error', error => { clearTimeout(timer); clearInterval(monitor); reject(error); });
      child.once('exit', () => { exited = true; });
      child.once('close', (status, signal) => {
        clearTimeout(timer); clearInterval(monitor);
        let groupAbsent = false;
        try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') groupAbsent = true; }
        resolve({ role: role.id, pid: child.pid, started, finished: new Date().toISOString(), status, signal, exited, closed: true, groupAbsent, violation: violation ?? null });
      });
    });
    records.push(record);
    if (record.violation || !record.exited || !record.groupAbsent || record.status !== 0) {
      fs.writeFileSync(path.join(here, 'EXECUTION-HOLD.json'), JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
      throw new Error('controller failure; inspect retained raw capture');
    }
  } finally {
    try { fs.fsyncSync(output); } finally { fs.closeSync(output); }
    try { fs.fsyncSync(errorOutput); } finally { fs.closeSync(errorOutput); }
  }
}
for (const row of seal.files) assert.equal(digest(fs.readFileSync(path.join(here, row.path))), row.sha256);
fs.writeFileSync(path.join(here, 'EXECUTION.json'), JSON.stringify({ records, postHashes: true, productImports: 0, realFixtureChildren: 0 }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ controllers: records.length, exitCloseGroupAbsent: records.every(row => row.exited && row.closed && row.groupAbsent), actual39: 0 }));
