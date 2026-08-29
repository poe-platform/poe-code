import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
export async function runOwnedCell(cell, state, emit) {
  if (++state.starts > state.maximumStarts || Date.now() >= state.deadline) throw new Error('owner start/deadline cap');
  const stdoutPath = `${cell.capture}.stdout`, stderrPath = `${cell.capture}.stderr`;
  const stdout = fs.openSync(stdoutPath, 'wx'), stderr = fs.openSync(stderrPath, 'wx');
  const instance = spawn(cell.executable, cell.argv, { cwd: cell.cwd, env: cell.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const receipt = { id: cell.id, pid: instance.pid, retired: false };
  state.owned.push(receipt);
  let unsafe; let finish; let bytes = 0;
  const settled = new Promise(resolve => { finish = resolve; });
  instance.once('error', error => { unsafe = error; });
  instance.once('close', (code, signal) => { Object.assign(receipt, { code, signal, retired: true }); finish(); });
  const accept = descriptor => chunk => {
    try {
      bytes += chunk.length; state.capture += chunk.length;
      fs.writeSync(descriptor, chunk);
      if (bytes > 524288 || state.capture > state.maximumCapture) throw new Error('capture cap');
    } catch (error) { unsafe ??= error; instance.kill('SIGKILL'); }
  };
  instance.stdout.on('data', accept(stdout)); instance.stderr.on('data', accept(stderr));
  const timer = setTimeout(() => { unsafe ??= new Error('case deadline'); instance.kill('SIGKILL'); }, Math.min(30000, state.deadline - Date.now()));
  try { emit({ event: 'owned-child', ...receipt }); } catch (error) { unsafe ??= error; instance.kill('SIGKILL'); }
  await settled; clearTimeout(timer); fs.closeSync(stdout); fs.closeSync(stderr);
  emit({ event: 'retired-child', ...receipt, bytes });
  if (unsafe || receipt.signal !== null) throw unsafe ?? new Error('child signal');
  const stat = fs.lstatSync(cell.capture);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 524288) throw new Error('terminal capture shape/cap');
  state.capture += stat.size;
  if (state.capture > state.maximumCapture) throw new Error('total capture cap');
  const events = fs.readFileSync(cell.capture, 'utf8').trim().split('\n').map(JSON.parse);
  const terminals = events.filter(row => row.event === 'result');
  if (terminals.length !== 1 || terminals[0].id !== cell.originalId || terminals[0].retired !== true || events.some(row => row.event === 'unsafe-retirement')) throw new Error('unknown retirement/result identity');
  const terminal = terminals[0];
  if (terminal.workers.length > cell.workerStartsMaximum) throw new Error('Worker start census');
  state.workerStarts += terminal.workers.length;
  if (state.workerStarts > state.maximumWorkers) throw new Error('global Worker cap');
  if ((terminal.status === 'PASS' && receipt.code !== 0) || (terminal.status === 'FAIL' && receipt.code !== 1) || !['PASS', 'FAIL'].includes(terminal.status)) throw new Error('nonzero-allPASS/incoherent outcome');
  return { id: cell.id, status: terminal.status, retired: true };
}
