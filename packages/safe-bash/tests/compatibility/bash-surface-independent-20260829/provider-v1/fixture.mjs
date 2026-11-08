import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [id, mode, root, canary] = process.argv.slice(2);
const emit = row => fs.writeSync(3, JSON.stringify({ id, ...row }) + '\n');
const expected = new Map([['F01','owned'],['F02','error'],['F03','outside-read'],['F04','outside-write'],['F05','symlink-read'],['F06','exec-denied'],['F07','term'],['F08','kill'],['F09','descendant'],['F10','drain'],['F11','abort-zero'],['F12','abort-false'],['F13','abort-empty'],['F14','abort-default'],['F15','stdin'],['F16','descendant-term']]);
if (mode === 'child') {
  if (!['F09','F16'].includes(id)) throw Error('UNLISTED_CHILD');
  emit({ event: 'CHILD_READY', pid: process.pid, parent: process.ppid });
  if (id === 'F09') process.stdout.write('child\n');
  else { const timer = setInterval(() => {}, 1000); process.once('SIGTERM', () => { clearInterval(timer); process.stdout.write('child-term\n'); }); }
} else {
  if (expected.get(id) !== mode || !root.endsWith('/cases/' + id) || !canary.endsWith('/canary')) throw Error('UNLISTED_FIXTURE');
  emit({ event: 'ROOT_READY', pid: process.pid, mode });
  const deny = action => { try { action(); emit({ event: 'SAFETY_VIOLATION', mode }); process.exitCode = 90; } catch (error) { emit({ event: 'DENIED', code: error.code }); process.stdout.write('denied\n'); } };
  if (mode === 'owned') { const input = fs.readFileSync(root + '/work/input'); fs.writeFileSync(root + '/work/out', input); process.stdout.write(Buffer.from([65,0,66,10])); process.stderr.write('stderr\n'); }
  else if (mode === 'error') { process.stderr.write('fixture-error\n'); process.exitCode = 7; }
  else if (mode === 'outside-read') deny(() => fs.readFileSync(canary + '/read'));
  else if (mode === 'outside-write') deny(() => fs.writeFileSync(canary + '/write', 'changed'));
  else if (mode === 'symlink-read') deny(() => fs.readFileSync(root + '/work/escape'));
  else if (mode === 'exec-denied') {
    emit({ event: 'CHILD_ENROLLED', role: 'denied-exec-attempt' });
    const child = spawn('/usr/bin/true', [], { shell: false, env: process.env, stdio: ['pipe','pipe','pipe'] });
    child.stdin.on('error', () => {}); child.stdin.end();
    child.stdout.resume(); child.stderr.resume();
    child.on('spawn', () => { emit({ event: 'SAFETY_VIOLATION', mode, pid: child.pid }); child.kill('SIGTERM'); });
    child.on('error', error => emit({ event: 'EXEC_DENIED', code: error.code }));
    child.on('exit', (status, signal) => emit({ event: 'CHILD_EXIT', pid: child.pid, status, signal }));
    child.on('close', (status, signal) => { emit({ event: 'DENIED_ATTEMPT_CLOSE', pid: child.pid ?? null, status, signal }); process.stdout.write('exec-denied\n'); });
  } else if (mode === 'descendant' || mode === 'descendant-term') {
    emit({ event: 'CHILD_ENROLLED', role: 'sealed-same-group-node' });
    const child = spawn(process.execPath, [process.argv[1], id, 'child', root, canary], { shell: false, detached: false, env: process.env, stdio: ['pipe','pipe','pipe',3] });
    child.stdin.on('error', () => {}); child.stdin.end();
    child.on('spawn', () => emit({ event: 'CHILD_SPAWN', pid: child.pid }));
    child.stdout.on('data', bytes => process.stdout.write(bytes)); child.stderr.on('data', bytes => process.stderr.write(bytes));
    child.on('error', error => { emit({ event: 'CHILD_ERROR', message: String(error) }); process.exitCode = 91; });
    child.on('exit', (status, signal) => emit({ event: 'CHILD_EXIT', pid: child.pid, status, signal }));
    child.on('close', (status, signal) => { emit({ event: 'CHILD_CLOSE', pid: child.pid, status, signal }); });
    if (mode === 'descendant-term') process.on('SIGTERM', () => {});
  } else if (mode === 'drain') { process.stdout.write(Buffer.alloc(65536,65)); process.stderr.write(Buffer.alloc(65536,66)); }
  else if (mode === 'stdin') { for await (const bytes of process.stdin) process.stdout.write(bytes); }
  else {
    const timer = setInterval(() => {}, 1000);
    process.on('SIGTERM', () => { emit({ event: 'ROOT_TERM' }); if (mode !== 'kill') { clearInterval(timer); process.stdout.write('term\n'); } });
  }
}
