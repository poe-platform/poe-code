import { fork } from 'node:child_process';

export async function session(root, variant, events) {
  const began = performance.now();
  const child = fork(`${root}/harness/worker.mjs`, [], { execArgv: ['--expose-gc', '--unhandled-rejections=strict', '--max-old-space-size=512'],
    env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: `${root}/tmp`, LC_ALL: 'C', TZ: 'UTC', SORT_ROOT: root, SORT_VARIANT: variant },
    detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const event = { variant, pid: child.pid, beganAt: new Date().toISOString(), logs: '' }; events.push(event);
  const capture = bytes => { if (event.logs.length < 65536) event.logs += bytes; };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  let pending, nextId = 0;
  const exited = new Promise(resolve => child.once('exit', (code, signal) => {
    event.code = code; event.signal = signal; event.exited = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`worker exit ${code}/${signal}: ${event.logs}`)); pending = undefined; }
    resolve();
  }));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('startup timeout')); }, 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`startup failed: ${event.logs}`)); });
    child.once('message', message => { clearTimeout(timer); resolve(message); });
  });
  event.forkToReadyMs = performance.now() - began; event.ready = ready;
  child.on('message', message => {
    if (pending?.id === message.id) { const active = pending; pending = undefined; clearTimeout(active.timer); active.resolve(message); }
  });
  const request = body => new Promise((resolve, reject) => {
    if (pending) throw Error('serial requests only');
    const id = ++nextId;
    const timer = setTimeout(() => { pending = undefined; child.kill('SIGKILL'); reject(new Error('worker request timeout')); }, 60000);
    pending = { id, timer, resolve, reject };
    child.send({ ...body, id }, error => { if (error && pending?.id === id) { clearTimeout(timer); pending = undefined; reject(error); } });
  });
  return { event, request, async close() {
    if (child.exitCode === null && child.signalCode === null) {
      try { event.close = await request({ close: true }); } catch (error) { event.closeError = String(error); }
      const timer = setTimeout(() => { event.forced = true; child.kill('SIGKILL'); }, 3000);
      await exited; clearTimeout(timer);
    }
  } };
}
