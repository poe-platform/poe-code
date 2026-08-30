import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
export const root = '/Users/kjopek/Workspace/safe-bash';
export const scope = root + '/tests/compatibility/bash-surface-independent-20260829/provider-v1/diagnostic-record-v1';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const stateAt = capture => JSON.parse(fs.readFileSync(capture + '/STATE.json'));
export function save(capture, state) { fs.writeFileSync(capture + '/STATE.json', JSON.stringify(state, null, 2) + '\n'); }
export async function child(capture, label, executable, args, input = '') {
  const state = stateAt(capture);
  if (state.halted || state.active || Date.now() >= state.deadline || state.direct.length >= 30) throw Error('PREPARATION_STOP');
  if (!['apply_patch', '/usr/bin/git'].includes(executable)) throw Error('EXECUTABLE_REFUSED');
  const number = state.direct.length + 1, prefix = String(number).padStart(3, '0') + '-' + label;
  const row = { number, label, executable, args, started: Date.now(), exit: false, close: false, errors: [], bytes: 0 };
  const stdout = fs.openSync(capture + '/' + prefix + '.stdout', 'wx'), stderr = fs.openSync(capture + '/' + prefix + '.stderr', 'wx');
  fs.writeFileSync(capture + '/' + prefix + '.stdin', input, { flag: 'wx' });
  state.direct.push(row); state.active = 1; save(capture, state);
  fs.appendFileSync(capture + '/EVENTS.jsonl', JSON.stringify({ event: 'ENROLLED', row }) + '\n');
  const env = { PATH: '/usr/bin:/bin', HOME: '/private/tmp', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_ATTR_NOSYSTEM: '1' };
  const proc = spawn(executable, args, { cwd: root, shell: false, ...(executable === 'apply_patch' ? {} : { env }), stdio: ['pipe', 'pipe', 'pipe'] });
  row.pid = proc.pid; save(capture, state);
  const consume = descriptor => bytes => { if (state.captureBytes + bytes.length > state.limits.captureBytes) { state.halted = true; row.errors.push('CAPTURE_LIMIT'); proc.kill('SIGTERM'); return; } fs.writeSync(descriptor, bytes); state.captureBytes += bytes.length; row.bytes += bytes.length; };
  proc.stdout.on('data', consume(stdout)); proc.stderr.on('data', consume(stderr));
  proc.on('error', error => row.errors.push(String(error))); proc.stdin.on('error', error => row.errors.push(String(error)));
  proc.on('exit', (status, signal) => { row.exit = true; row.status = status; row.signal = signal; });
  const timer = setTimeout(() => { state.halted = true; row.errors.push('DEADLINE'); proc.kill('SIGTERM'); }, Math.min(executable.endsWith('/node') ? 60000 : 30000, state.deadline - Date.now()));
  proc.stdin.end(input);
  await new Promise(resolve => proc.once('close', (status, signal) => { row.close = true; row.status = status; row.signal = signal; resolve(); }));
  clearTimeout(timer); fs.closeSync(stdout); fs.closeSync(stderr); row.finished = Date.now(); state.active = 0;
  if (!row.exit || row.signal || row.errors.length) state.halted = true;
  save(capture, state); fs.appendFileSync(capture + '/EVENTS.jsonl', JSON.stringify({ event: 'RETIRED', row }) + '\n');
  if (state.halted) throw Error('PREPARATION_SAFETY_STOP');
  return { row, stdout: fs.readFileSync(capture + '/' + prefix + '.stdout'), stderr: fs.readFileSync(capture + '/' + prefix + '.stderr') };
}
export function git(capture, label, args) { return child(capture, label, '/usr/bin/git', ['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','maintenance.auto=false','-c','gc.auto=0','-c','core.fsmonitor=false', ...args]); }
export async function patch(capture, files) {
  const patch = '*** Begin Patch\n' + [...files].map(([name, text]) => '*** Add File: ' + path.relative(root, path.join(scope,name)) + '\n' + text.replace(/\n$/, '').split('\n').map(line=>'+'+line).join('\n') + '\n').join('') + '*** End Patch\n';
  const result = await child(capture, 'apply-owned', 'apply_patch', [], patch);
  if (result.row.status !== 0) throw Error('PATCH_FAILED');
}
