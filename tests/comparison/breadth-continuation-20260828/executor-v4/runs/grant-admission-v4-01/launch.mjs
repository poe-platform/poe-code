import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../../../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const authorization = path.join(directory, 'AUTH.json');
const preflight = JSON.parse(fs.readFileSync(path.join(directory, 'PREFLIGHT.json')));
const node = preflight.tools.find(tool => tool.role === 'node');
if (digest(fs.readFileSync(node.path)) !== node.sha256) throw new Error('OUTER_NODE_BINDING');
if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('AMBIENT_NODE_OPTIONS');
const args = [...preflight.commandArgvTemplate.slice(1, -1), authorization];
const receipt = {
  kind: 'ONE_COORDINATOR_LAUNCH', started: new Date().toISOString(),
  command: [node.path, ...args], cwd: repository,
  authSha256: digest(fs.readFileSync(authorization)), pid: null, group: null,
  exit: null, close: null, reaped: false, errors: [],
  captureBytes: { stdout: 0, stderr: 0 }, childHeapNotRss: true,
  outerDeadline: 'Frozen coordinator checked elapsed, not extra hard preemption',
};
const persist = (name, value) => fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const record = (phase, error) => receipt.errors.push({ phase, code: error.code ?? null, message: String(error.message ?? error) });
const absent = identifier => {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
};
persist('LAUNCH-INTENT.json', receipt);
const chunks = { stdout: [], stderr: [] };
const child = spawn(node.path, args, {
  cwd: repository, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: directory, TMPDIR: directory },
});
receipt.pid = child.pid ?? null;
receipt.group = child.pid ?? null;
const closed = new Promise(resolve => {
  child.once('error', error => record('spawn', error));
  child.once('exit', (code, signal) => { receipt.exit = { code, signal }; });
  child.once('close', (code, signal) => { receipt.close = { code, signal }; resolve(); });
});
for (const name of ['stdout', 'stderr']) {
  child[name].on('data', bytes => {
    const previous = receipt.captureBytes[name];
    receipt.captureBytes[name] += bytes.length;
    if (previous < 65536) chunks[name].push(Buffer.from(bytes.subarray(0, 65536 - previous)));
    if (previous <= 65536 && receipt.captureBytes[name] > 65536) record(name, new Error('OUTER_CAPTURE_CAP'));
  });
  child[name].on('error', error => record(name, error));
}
try { persist('LAUNCHED.json', receipt); } catch (error) { record('launch-persistence', error); }
await closed;
try { receipt.reaped = Boolean(receipt.pid) && absent(receipt.pid) && absent(-receipt.pid); }
catch (error) { record('absence', error); }
receipt.finished = new Date().toISOString();
for (const name of ['stdout', 'stderr']) {
  const bytes = Buffer.concat(chunks[name]);
  receipt[`${name}Sha256`] = digest(bytes);
  try { fs.writeFileSync(path.join(directory, `coordinator.${name}`), bytes, { flag: 'wx' }); }
  catch (error) { record(`${name}-persistence`, error); receipt[`${name}EmergencyBase64`] = bytes.toString('base64'); }
}
try { persist('LAUNCH-RECEIPT.json', receipt); }
catch (error) { record('receipt-persistence', error); process.stderr.write(`${JSON.stringify(receipt)}\n`); }
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.exit?.code !== 0 || !receipt.reaped || receipt.errors.length) process.exitCode = 1;
