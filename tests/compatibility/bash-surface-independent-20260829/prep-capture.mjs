import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const root = '/Users/kjopek/Workspace/safe-bash';
export const scope = path.join(root, 'tests/compatibility/bash-surface-independent-20260829');
export function stateAt(capture) { return JSON.parse(fs.readFileSync(path.join(capture, 'STATE.json'))); }
export function event(capture, value) { fs.appendFileSync(path.join(capture, 'EVENTS.jsonl'), JSON.stringify({ at: Date.now(), ...value }) + '\n'); }
export function save(capture, state) { fs.writeFileSync(path.join(capture, 'STATE.json'), JSON.stringify(state, null, 2) + '\n'); }
export async function child(capture, label, executable, args, input = '') {
  const state = stateAt(capture);
  if (state.halted || Date.now() >= state.deadline || state.children.length >= state.limits.children || state.active !== 0) throw Error('PREPARATION_ADMISSION_STOP');
  if (!['/usr/bin/git', 'apply_patch', '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'].includes(executable)) throw Error('PREPARATION_EXECUTABLE_REFUSED');
  if (executable.endsWith('/node') && args[0] !== path.join(scope, 'helper-controls.mjs')) throw Error('ONLY_NON_BASH_HELPER_CONTROL_ALLOWED');
  const number = state.children.length + 1, prefix = String(number).padStart(3, '0') + '-' + label;
  const row = { number, label, executable, args, started: Date.now(), stdout: prefix + '.stdout', stderr: prefix + '.stderr', stdinBytes: Buffer.byteLength(input), exitObserved: false, closeObserved: false, errors: [], capturedBytes: 0 };
  const output = fs.openSync(path.join(capture, row.stdout), 'wx'), errors = fs.openSync(path.join(capture, row.stderr), 'wx');
  fs.writeFileSync(path.join(capture, prefix + '.stdin'), input, { flag: 'wx' });
  state.children.push(row); state.active = 1; save(capture, state); event(capture, { event: 'CHILD_ENROLLED', row });
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/Users/kjopek', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ATTR_NOSYSTEM: '1', NO_COLOR: '1' };
  const process = spawn(executable, args, { cwd: root, ...(executable === 'apply_patch' ? {} : { env }), shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); row.pid = process.pid; save(capture, state);
  const consume = descriptor => bytes => { if (state.captureBytes + bytes.length > state.limits.captureBytes) { state.halted = true; row.errors.push('CAPTURE_STOP'); process.kill('SIGTERM'); return; } fs.writeSync(descriptor, bytes); state.captureBytes += bytes.length; row.capturedBytes += bytes.length; };
  process.stdout.on('data', consume(output)); process.stderr.on('data', consume(errors)); process.on('error', error => row.errors.push(String(error))); process.stdin.on('error', error => row.errors.push(String(error)));
  process.on('exit', (status, signal) => { row.exitObserved = true; row.status = status; row.signal = signal; });
  const timer = setTimeout(() => { state.halted = true; row.errors.push('DEADLINE_STOP'); process.kill('SIGTERM'); }, Math.min(60000, state.deadline - Date.now()));
  process.stdin.end(input);
  await new Promise(resolve => process.once('close', (status, signal) => { row.closeObserved = true; row.status = status; row.signal = signal; resolve(); }));
  clearTimeout(timer); fs.closeSync(output); fs.closeSync(errors); row.finished = Date.now(); state.active = 0;
  if (!row.exitObserved || row.signal || row.errors.length) state.halted = true;
  save(capture, state); event(capture, { event: 'CHILD_RETIRED', row });
  if (state.halted) throw Error('PREPARATION_SAFETY_STOP:' + label);
  return { row, stdout: fs.readFileSync(path.join(capture, row.stdout)), stderr: fs.readFileSync(path.join(capture, row.stderr)) };
}
export async function git(capture, label, args, input = '') {
  return child(capture, label, '/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null', ...args], input);
}
export async function patch(capture, files) {
  const text = '*** Begin Patch\n' + [...files].map(([name, content]) => '*** Add File: ' + path.relative(root, path.join(scope, name)) + '\n' + content.replace(/\n$/, '').split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n';
  const result = await child(capture, 'apply-owned', 'apply_patch', [], text);
  if (result.row.status !== 0) throw Error('PATCH_FAILED');
}
