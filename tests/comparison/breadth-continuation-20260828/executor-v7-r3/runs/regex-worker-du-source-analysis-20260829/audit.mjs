import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const plan = JSON.parse(fs.readFileSync(path.join(home, 'PLAN.json')));
const statePath = path.join(home, 'STATE.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : { processes: plan.initialOwnedProcesses, captureBytes: 0, receipts: [] };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [filename, expected] of [[process.execPath, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'], [git, '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9']]) {
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 120000000) throw Error('TOOL_METADATA');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(65536);
  try { for (let offset = 0; offset < info.size;) { const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, info.size - offset), offset); if (!count) throw Error('TOOL_SHORT'); digest.update(buffer.subarray(0, count)); offset += count; } }
  finally { fs.closeSync(descriptor); }
  if (digest.digest('hex') !== expected) throw Error('TOOL_HASH');
}
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
const check = () => { if (Date.now() > Date.parse(plan.deadline) || state.processes >= plan.maxOwnedProcesses || state.captureBytes > plan.captureBytes) throw Error('ANALYSIS_CAP'); };
check();
state.processes++;
save();
const batchName = process.argv[2];
if (!/^batch-[0-9]{2}\.json$/.test(batchName ?? '')) throw Error('BATCH_NAME');
const batch = JSON.parse(fs.readFileSync(path.join(home, batchName)));
if (!Array.isArray(batch) || batch.length > 16) throw Error('BATCH_BOUND');
fs.mkdirSync(path.join(home, 'captures'), { recursive: true, mode: 0o700 });
const outputs = [];
for (const action of batch) {
  check();
  if (!/^[a-z0-9-]{1,64}$/.test(action.id)) throw Error('ACTION_ID');
  const stem = path.join(home, 'captures', action.id);
  if (action.kind === 'file') {
    if (!path.isAbsolute(action.path) || path.basename(action.path).toLowerCase() === 'agents.md' || !/\.(mjs|js|ts|json|md|data)$/.test(action.path)) throw Error('SOURCE_PATH');
    const info = fs.lstatSync(action.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2097152) throw Error('SOURCE_BOUND');
    const bytes = fs.readFileSync(action.path);
    if (action.sha256 && hash(bytes) !== action.sha256) throw Error('SOURCE_HASH');
    fs.writeFileSync(stem + '.data', bytes, { flag: 'wx', mode: 0o600 });
    state.captureBytes += bytes.length;
    const receipt = { id: action.id, kind: action.kind, path: action.path, bytes: bytes.length, mode: info.mode & 4095, sha256: hash(bytes), sourceOnly: true };
    state.receipts.push(receipt); outputs.push(receipt); save();
    continue;
  }
  if (action.kind !== 'git' || !Array.isArray(action.args) || !['show', 'ls-tree', 'status'].includes(action.args[0]) || action.args.some(value => typeof value !== 'string' || value.includes('\n'))) throw Error('GIT_OPERATION');
  const stdout = fs.openSync(stem + '.stdout', 'wx', 0o600);
  const stderr = fs.openSync(stem + '.stderr', 'wx', 0o600);
  const child = spawn(git, ['-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...action.args], { cwd: repository, env: { PATH: '', LANG: 'C', LC_ALL: 'C', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  const receipt = { id: action.id, kind: action.kind, args: action.args, pid: child.pid, closed: false, exit: null, signal: null, stdoutBytes: 0, stderrBytes: 0, failure: null };
  state.processes++;
  state.receipts.push(receipt);
  const completion = new Promise(resolve => child.once('close', (code, signal) => { receipt.closed = true; receipt.exit = code; receipt.signal = signal; resolve(); }));
  child.once('error', error => { receipt.failure = String(error); });
  for (const [channel, descriptor] of [['stdout', stdout], ['stderr', stderr]]) child[channel].on('data', bytes => {
    receipt[channel + 'Bytes'] += bytes.length;
    state.captureBytes += bytes.length;
    if (receipt[channel + 'Bytes'] > plan.childStreamBytes || state.captureBytes > plan.captureBytes) { receipt.failure = 'CAPTURE_CAP'; child.kill('SIGTERM'); return; }
    fs.writeFileSync(descriptor, bytes);
  });
  save();
  let killTimer;
  const timer = setTimeout(() => { receipt.failure = 'DEADLINE'; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); }, plan.childDeadlineMs);
  await completion;
  clearTimeout(timer); clearTimeout(killTimer);
  for (const descriptor of [stdout, stderr]) { fs.fsyncSync(descriptor); fs.closeSync(descriptor); }
  receipt.stdoutSha256 = hash(fs.readFileSync(stem + '.stdout'));
  receipt.stderrSha256 = hash(fs.readFileSync(stem + '.stderr'));
  receipt.capturesClosed = true;
  save(); outputs.push(receipt);
  if (receipt.failure || receipt.signal || !receipt.closed) throw Error('UNSAFE_CHILD');
}
process.stdout.write(JSON.stringify({ batch: batchName, processes: state.processes, captureBytes: state.captureBytes, outputs }) + '\n');
