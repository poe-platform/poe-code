import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const groups = new Map();
const retiring = new Map();
async function retire(pid) {
  if (retiring.has(pid)) return retiring.get(pid);
  const completion = Promise.resolve().then(() => cleanup(pid));
  retiring.set(pid, completion);
  return completion;
}
async function cleanup(pid) {
  const directory = groups.get(pid);
  for (let attempt = 0; ; attempt++) {
    try { process.kill(-pid, 'SIGKILL'); break; }
    catch (error) {
      if (error.code === 'ESRCH') break;
      // macOS can report EPERM while an exited group is being reaped.
      if (error.code !== 'EPERM' || attempt === 49) throw error;
      await delay(100);
    }
  }
  // Crashpad double-forks into another process group. Its inherited private
  // cwd remains an ownership witness after reparenting; other Chrome is excluded.
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidates = execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8', timeout: 1000 })
      .split('\n').filter(line => line.includes('chrome_crashpad_handler'))
      .map(line => line.trim().split(' ')[0]);
    if (!candidates.length) break;
    let output;
    try { output = execFileSync('lsof', ['-n', '-P', '-a', '-p', candidates.join(','), '-d', 'cwd', '-F', 'pn'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { if (error.status !== 1) throw error; output = error.stdout; }
    const helpers = [];
    let current;
    for (const field of output.trim().split('\n')) {
      if (field.startsWith('p')) current = Number(field.slice(1));
      else if (field === 'n' + directory) helpers.push(current);
    }
    if (!helpers.length) break;
    for (const helper of helpers) {
      if (!Number.isSafeInteger(helper) || helper <= 1) throw new Error('Invalid owned helper PID');
      try { process.kill(helper, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (attempt === 49) throw new Error('Owned browser helpers did not retire');
    await delay(50);
  }
  rmSync(directory, { recursive: true, force: true });
  groups.delete(pid);
  retiring.delete(pid);
}
process.on('message', message => {
  if (!Number.isSafeInteger(message.pid) || message.pid <= 1) throw new Error('Invalid owned browser PID');
  if (message.operation === 'own') groups.set(message.pid, message.directory);
  else if (message.operation === 'retire' && groups.has(message.pid)) void retire(message.pid);
});
process.on('disconnect', async () => {
  await Promise.all([...groups.keys()].map(retire));
  process.exit(0);
});
