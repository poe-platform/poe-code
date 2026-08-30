import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = '/Users/kjopek/Workspace/safe-bash';
if (process.cwd() !== root) throw new Error('Wrong working directory');
const [label, limitText, command, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label ?? '') || !command) throw new Error('label timeout command required');
const prefix = `/tmp/safe-bash-remote-close-additional-${label}`;
function textCommand(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function save(path, text) {
  if (existsSync(path)) throw new Error(`Refusing overwrite: ${path}`);
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
function snapshot() {
  const files = {};
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.native-')) continue;
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files[name] = createHash('sha256').update(readFileSync(name)).digest('hex');
    }
  }
  visit('src'); visit('tests');
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) files[file] = createHash('sha256').update(readFileSync(file)).digest('hex');
  const components = {};
  for (const component of ['src/shell/', 'src/contracts/', 'src/fs/', 'src/commands/', 'tests/shell/', 'tests/stress/remote-cancellation/', 'tests/fixtures/']) {
    components[component] = createHash('sha256').update(Object.entries(files).filter(([file]) => file.startsWith(component)).sort(([left], [right]) => left.localeCompare(right)).map(([file, hash]) => `${hash}  ${file}\n`).join('')).digest('hex');
  }
  return { time: new Date().toISOString(), head: textCommand('git', ['rev-parse', 'HEAD']), shellCommit: textCommand('git', ['log', '-1', '--format=%H', '--', 'src/shell']), status: textCommand('git', ['status', '--short']), components, files };
}
const before = snapshot();
save(`${prefix}-before.json`, JSON.stringify(before, null, 2));
const child = spawn(command, args, { cwd: root, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --unhandled-rejections=strict`.trim() }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
const known = new Set([child.pid]);
function discover() {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const rows = result.stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows) if (known.has(parent) && !known.has(pid)) { known.add(pid); changed = true; }
  }
}
let stdout = '', stderr = '', timedOut = false;
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const sampler = setInterval(discover, 100);
const timer = setTimeout(() => {
  timedOut = true; discover();
  for (const pid of [...known].reverse()) { try { process.kill(-pid, 'SIGKILL'); } catch {} try { process.kill(pid, 'SIGKILL'); } catch {} }
}, Number(limitText));
const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
clearTimeout(timer); clearInterval(sampler);
const stopped = [];
for (const pid of known) {
  try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); stopped.push(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
const after = snapshot();
const changedFiles = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(file => before.files[file] !== after.files[file]);
const summary = { command: [command, ...args], environment: { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --unhandled-rejections=strict`.trim(), AUDIT_CASE: process.env.AUDIT_CASE, AUDIT_VERBOSE: process.env.AUDIT_VERBOSE }, ...result, timedOut, childPids: [...known], forciblyStopped: stopped, before: { time: before.time, head: before.head, shellCommit: before.shellCommit, components: before.components }, after: { time: after.time, head: after.head, shellCommit: after.shellCommit, components: after.components }, changedFiles, counts: stdout.split('\n').filter(line => /^# (tests|pass|fail|cancelled|skipped|duration_ms) /.test(line)), failures: stdout.split('\n').filter(line => /^not ok /.test(line)) };
save(`${prefix}.stdout`, stdout); save(`${prefix}.stderr`, stderr);
save(`${prefix}-after.json`, JSON.stringify(after, null, 2));
save(`${prefix}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = result.code === 0 && !timedOut && !stopped.length ? 0 : 1;
