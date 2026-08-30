import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const directory = path.dirname(new URL(import.meta.url).pathname);
const output = path.join(directory, 'OUTER-01');
fs.mkdirSync(output);
const stdout = fs.openSync(path.join(output, 'stdout.raw'), 'wx');
const stderr = fs.openSync(path.join(output, 'stderr.raw'), 'wx');
const events = fs.openSync(path.join(output, 'events.jsonl'), 'wx');
const event = value => fs.writeSync(events, JSON.stringify({ at: Date.now(), ...value }) + '\n');
event({ event: 'capture-open', pid: process.pid });
let child;
let terminal;
let timer;
let rescue;
let primaryPresent = false;
let primary;
let captured = 0;
try {
  const executable = fs.readFileSync(path.join(directory, 'EXECUTOR.json'));
  if (createHash('sha256').update(executable).digest('hex') !== fs.readFileSync(path.join(directory, 'EXECUTOR.sha256'), 'utf8').trim()) throw new Error('executor binding');
  const seal = JSON.parse(executable);
  for (const record of [seal.node, ...seal.files]) {
    const stat = fs.lstatSync(record.path);
    if (!stat.isFile() || stat.size !== record.size || (stat.mode & 0o777) !== record.mode) throw new Error('input metadata');
    const descriptor = fs.openSync(record.path, 'r');
    const digest = createHash('sha256');
    try { const buffer = Buffer.alloc(65536); let count; while ((count = fs.readSync(descriptor, buffer)) !== 0) digest.update(buffer.subarray(0, count)); }
    finally { fs.closeSync(descriptor); }
    if (digest.digest('hex') !== record.sha256) throw new Error('input hash');
  }
  child = spawn(seal.node.path, [path.join(directory, 'runner.mjs'), 'run', 'ACTUAL-01'], { cwd: directory, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  terminal = await new Promise(resolve => {
    let exited;
    const save = handle => bytes => {
      try { captured += bytes.length; if (captured > 8 * 1024 * 1024) throw new Error('outer capture cap'); fs.writeSync(handle, bytes); }
      catch (reason) { primaryPresent = true; primary = reason; child.kill('SIGTERM'); }
    };
    child.stdout.on('data', save(stdout)); child.stderr.on('data', save(stderr));
    child.on('error', reason => { primaryPresent = true; primary = reason; });
    child.on('exit', (code, signal) => { exited = { code, signal }; event({ event: 'exit', ...exited }); });
    child.on('close', (code, signal) => { clearTimeout(timer); clearTimeout(rescue); event({ event: 'close', code, signal }); resolve({ code, signal, exited }); });
    timer = setTimeout(() => { primaryPresent = true; primary = new Error('outer deadline'); child.kill('SIGTERM'); rescue = setTimeout(() => child.kill('SIGKILL'), 5000); }, 1950000);
    event({ event: 'enrolled', pid: child.pid, args: ['runner.mjs', 'run', 'ACTUAL-01'] });
  });
  if (terminal.signal !== null) throw new Error('unexpected coordinator signal');
} catch (reason) { primaryPresent = true; primary = reason; event({ event: 'primary', reasonPresent: true, reason: String(reason?.stack ?? reason) }); }
finally {
  clearTimeout(timer); clearTimeout(rescue);
  fs.writeFileSync(path.join(output, 'RECEIPT.json'), JSON.stringify({ pid: process.pid, childPid: child?.pid ?? null, primaryPresent, primary: primaryPresent ? String(primary?.stack ?? primary) : null, terminal, captured }, null, 2) + '\n', { flag: 'wx' });
  event({ event: 'capture-closure', childClosed: Boolean(terminal) });
  fs.closeSync(stdout); fs.closeSync(stderr); fs.closeSync(events);
}
process.exitCode = primaryPresent ? 78 : terminal?.code ?? 1;
