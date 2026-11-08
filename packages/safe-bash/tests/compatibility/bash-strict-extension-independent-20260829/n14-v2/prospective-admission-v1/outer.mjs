import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const [directory, output] = process.argv.slice(2);
fs.mkdirSync(output, { recursive: false });
const stdout = fs.openSync(path.join(output, 'stdout.raw'), 'wx');
const stderr = fs.openSync(path.join(output, 'stderr.raw'), 'wx');
const events = fs.openSync(path.join(output, 'events.jsonl'), 'wx');
const emit = value => fs.writeSync(events, JSON.stringify({ at: Date.now(), ...value }) + '\n');
emit({ event: 'capture-open', pid: process.pid });
let child;
let result;
let captureBytes = 0;
let timer;
let killTimer;
let primaryPresent = false;
let primary;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const presealBytes = fs.readFileSync(path.join(directory, 'PRESEAL.json'));
  const pinned = fs.readFileSync(path.join(directory, 'PRESEAL.sha256'), 'utf8').trim();
  if (digest(presealBytes) !== pinned) throw new Error('preseal identity');
  const seal = JSON.parse(presealBytes);
  for (const [name, authority] of Object.entries(seal.files)) {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size !== authority.bytes || digest(fs.readFileSync(filename)) !== authority.sha256) throw new Error('source binding: ' + name);
  }
  const toolStat = fs.lstatSync(seal.node.path);
  if (!toolStat.isFile() || toolStat.size !== seal.node.bytes) throw new Error('tool type or size');
  const toolHash = createHash('sha256');
  const descriptor = fs.openSync(seal.node.path, 'r');
  try { const chunk = Buffer.alloc(65536); let count; while ((count = fs.readSync(descriptor, chunk)) !== 0) toolHash.update(chunk.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  if (toolHash.digest('hex') !== seal.node.sha256) throw new Error('tool hash');
  const work = path.join(output, 'work');
  fs.mkdirSync(work);
  const args = [path.join(directory, 'controls.mjs'), work, path.join(directory, 'PRESEAL.json')];
  emit({ event: 'admitted', node: seal.node, args, presealSha256: pinned });
  child = spawn(seal.node.path, args, { cwd: directory, env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  result = await new Promise(resolve => {
    let exit;
    let spawnError;
    const capture = descriptor => bytes => {
      try {
        captureBytes += bytes.length;
        if (captureBytes > 8 * 1024 * 1024) throw new Error('capture cap');
        fs.writeSync(descriptor, bytes);
      } catch (reason) {
        if (!primaryPresent) { primaryPresent = true; primary = reason; }
        child.kill('SIGTERM');
      }
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.on('error', reason => { spawnError = String(reason?.stack ?? reason); emit({ event: 'spawn-error', reason: spawnError }); });
    child.on('exit', (code, signal) => { exit = { code, signal }; emit({ event: 'exit', ...exit }); });
    child.on('close', (code, signal) => { clearTimeout(timer); clearTimeout(killTimer); emit({ event: 'close', code, signal }); resolve({ code, signal, exit, spawnError, natural: signal === null && code !== null }); });
    timer = setTimeout(() => { primaryPresent = true; primary = new Error('deadline'); child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 5000); }, 90000);
    emit({ event: 'enrolled-listeners-installed', pid: child.pid ?? null });
  });
  for (const [name, authority] of Object.entries(seal.files)) if (digest(fs.readFileSync(path.join(directory, name))) !== authority.sha256) throw new Error('postguard: ' + name);
  if (result.code !== 0 || !result.natural || primaryPresent) throw primaryPresent ? primary : new Error('child nonzero or nonnatural');
} catch (reason) {
  if (!primaryPresent) { primaryPresent = true; primary = reason; }
  emit({ event: 'primary', reasonPresent: true, reason: String(primary?.stack ?? primary) });
} finally {
  clearTimeout(timer);
  clearTimeout(killTimer);
  const receipt = { pid: process.pid, childPid: child?.pid ?? null, primaryPresent, primary: primaryPresent ? String(primary?.stack ?? primary) : null, result, captureBytes, limits: { seconds: 90, cleanupSeconds: 5, captureBytes: 8388608 }, productImports: 0 };
  fs.writeFileSync(path.join(output, 'OUTER.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  emit({ event: 'capture-closure', childClosed: Boolean(result), primaryPresent });
  fs.closeSync(stdout); fs.closeSync(stderr); fs.closeSync(events);
}
if (primaryPresent) process.exitCode = 1;
