import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
const root = '/Users/kjopek/Workspace/safe-bash';
const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plan = JSON.parse(fs.readFileSync(path.join(home, 'PLAN.json')));
const statePath = path.join(home, 'STATE.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : { processes: 4, bytes: 0, children: [], files: [] };
state.processes++;
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
const check = () => { if (state.processes > 48 || state.bytes > plan.aggregateCaptureBytes || Date.now() > Date.parse(plan.deadline)) throw Error('CAP_STOP'); };
save(); check();
fs.mkdirSync(path.join(home, 'captures'), { recursive: true });

async function command(id, args, input, bound) {
  check();
  const output = fs.openSync(path.join(home, 'captures', id + '.stdout'), 'wx', 0o600);
  const error = fs.openSync(path.join(home, 'captures', id + '.stderr'), 'wx', 0o600);
  const record = { id, args, pid: null, closed: false, status: null, signal: null, observed: [0, 0], retained: [0, 0], errors: [] };
  const child = spawn(git, args, { cwd: root, env: { PATH: '', HOME: home, LANG: 'C', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
  record.pid = child.pid; state.processes++; state.children.push(record);
  const close = new Promise(resolve => child.once('close', (status, signal) => { Object.assign(record, { closed: true, status, signal }); resolve(); }));
  child.on('error', failure => record.errors.push(String(failure)));
  child.stdin.on('error', failure => record.errors.push(String(failure)));
  for (const [index, stream, descriptor] of [[0, child.stdout, output], [1, child.stderr, error]]) stream.on('data', bytes => {
    record.observed[index] += bytes.length;
    const allowed = Math.min(bytes.length, Math.max(0, (index === 0 ? bound : 65536) - record.retained[index]));
    try {
      let offset = 0;
      while (offset < allowed) { const written = fs.writeSync(descriptor, bytes, offset, allowed - offset); if (!written) throw Error('SHORT_WRITE'); offset += written; }
      record.retained[index] += allowed; state.bytes += allowed;
      if (allowed !== bytes.length || state.bytes > plan.aggregateCaptureBytes) throw Error('CAPTURE_STOP');
    } catch (failure) { record.errors.push(String(failure)); child.kill('SIGTERM'); }
  });
  save();
  let kill;
  const timer = setTimeout(() => { record.errors.push('DEADLINE'); child.kill('SIGTERM'); kill = setTimeout(() => child.kill('SIGKILL'), 2000); }, 10000);
  child.stdin.end(input);
  await close; clearTimeout(timer); clearTimeout(kill);
  for (const descriptor of [output, error]) { fs.fsyncSync(descriptor); fs.closeSync(descriptor); }
  record.capturesClosed = true; save();
  if (record.errors.length || record.signal || !record.closed) throw Error('UNSAFE_CHILD');
  if (record.status !== 0) throw Error('METADATA_COMMAND_REJECTED');
  return fs.readFileSync(path.join(home, 'captures', id + '.stdout'));
}

function regular(filename, cap, expected) {
  if (path.basename(filename).toUpperCase() === 'AGENTS.MD' || !/\.(json|mjs|js|ts|md|data|stdout|raw)$/.test(filename)) throw Error('TEXT_KIND');
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > cap) throw Error('REGULAR_METADATA_STOP');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const chunks = [];
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw Error('OPEN_IDENTITY');
    for (let offset = 0; offset < info.size;) {
      const bytes = Buffer.alloc(Math.min(65536, info.size - offset));
      const count = fs.readSync(descriptor, bytes, 0, bytes.length, offset);
      if (count !== bytes.length) throw Error('SHORT_READ');
      chunks.push(bytes); offset += count;
    }
  } finally { fs.closeSync(descriptor); }
  const bytes = Buffer.concat(chunks);
  if (expected && digest(bytes) !== expected) throw Error('REGULAR_HASH_STOP');
  return { bytes, mode: info.mode & 4095 };
}

const batchPath = path.join(home, process.argv[2] ?? '');
if (!/^batch-[0-9]{2}\.json$/.test(path.basename(batchPath))) throw Error('BATCH');
const batch = JSON.parse(regular(batchPath, 65536).bytes);
if (!Array.isArray(batch) || batch.length > 32) throw Error('FINITE_BATCH');
const gitActions = batch.filter(action => action.kind === 'git');
const metadata = gitActions.length ? (await command(path.basename(batchPath, '.json') + '-metadata', ['cat-file', '--batch-check=%(objecttype) %(objectsize) %(objectname)'], gitActions.map(action => action.ref).join('\n') + '\n', 65536)).toString('utf8').trim().split('\n') : [];
let index = 0;
for (const action of batch) {
  check();
  if (!/^[a-z0-9-]{1,64}$/.test(action.id)) throw Error('ID');
  let bytes, mode = null, blob = null;
  if (action.kind === 'git') {
    const match = /^blob ([0-9]+) ([a-f0-9]{40})$/.exec(metadata[index++]);
    if (!match || Number(match[1]) > plan.sourceBytes || /AGENTS\.MD/i.test(action.ref) || !/\.(mjs|js|ts|json|md|data)$/.test(action.ref)) throw Error('GIT_SIZE_TYPE_STOP');
    blob = match[2];
    bytes = await command(action.id, ['cat-file', 'blob', blob], '', plan.sourceStreamBytes);
    if (bytes.length !== Number(match[1]) || crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex') !== blob) throw Error('GIT_BLOB_STOP');
  } else if (action.kind === 'file') {
    const result = regular(action.path, action.data ? plan.jsonDataBytes : plan.sourceBytes, action.sha256);
    bytes = result.bytes; mode = result.mode;
    fs.writeFileSync(path.join(home, 'captures', action.id + '.data'), bytes, { flag: 'wx', mode: 0o600 }); state.bytes += bytes.length;
  } else throw Error('KIND');
  state.files.push({ id: action.id, ref: action.ref ?? null, path: action.path ?? null, bytes: bytes.length, sha256: digest(bytes), blob, mode }); save();
}
console.log(JSON.stringify({ processes: state.processes, bytes: state.bytes, files: state.files.slice(-batch.length) }));
