import { fork } from 'node:child_process';

export async function supervise(job, entry, packageRoot, watchdogMs) {
  const started = performance.now();
  return new Promise(resolveResult => {
    const child = fork(entry, [job, packageRoot], { execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--stack-size=1024'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
    const state = { job, pid: child.pid, watchdogMs, events: [], stdout: '', stderr: '', result: null, killed: false, outputBytes: 0, ipcBytes: 0 };
    let ready = false;
    let controlTimer;
    const kill = reason => {
      if (!state.killed) { state.killed = true; state.killReason = reason; state.killSent = child.kill('SIGKILL'); }
    };
    const onInt = () => kill('parent SIGINT');
    const onTerm = () => kill('parent SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    const watchdog = setTimeout(() => kill('fixed parent watchdog'), Math.max(0, watchdogMs - (performance.now() - started)));
    child.on('message', message => {
      state.ipcBytes += Buffer.byteLength(JSON.stringify(message));
      if (state.ipcBytes > 65536) return kill('cumulative IPC cap');
      if (message?.kind === 'ready' && message.job === job && !ready) {
        ready = true;
        state.readyMs = performance.now() - started;
        state.events.push('ready');
        if (job === 'owned-timeout') controlTimer = setTimeout(() => kill('benign owned timeout'), 75);
        child.send({ kind: 'run', job }, error => { if (error) { state.sendError = String(error); kill('send error'); } });
      } else if (message?.kind === 'result' && ready && !state.result) state.result = message;
      else { state.protocolError = true; kill('unexpected IPC'); }
    });
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', chunk => { state.outputBytes += chunk.length; if (state.outputBytes > 16384) kill('combined output cap'); else state[key] += chunk; });
      stream.on('error', error => { state.streamError = String(error); kill('stream error'); });
      stream.on('close', () => state.events.push(`${key}-close`));
    }
    child.on('error', error => { state.spawnError = String(error); kill('child error'); });
    child.on('disconnect', () => state.events.push('disconnect'));
    child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      clearTimeout(controlTimer);
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      const closed = ['ready', 'stdout-close', 'stderr-close', 'disconnect'].every(event => state.events.includes(event));
      const healthy = closed && !state.protocolError && !state.spawnError && !state.sendError && !state.streamError;
      const pass = healthy && (job === 'owned-timeout'
        ? state.killed && state.killSent && state.killReason === 'benign owned timeout' && signal === 'SIGKILL' && state.result === null && state.stdout === '' && state.stderr === ''
        : job === 'late-rejection'
          ? code === 1 && !state.killed && state.result === null && state.stderr.includes('standalone preserved late rejection')
          : code === 0 && signal === null && !state.killed && state.stdout === '' && state.stderr === '' && state.result?.pass === true);
      resolveResult({ ...state, code, signal, closeAwaited: true, streamsAndIPCClosed: closed, activeChildren: 0, childElapsedMs: performance.now() - started, pass });
    });
  });
}
