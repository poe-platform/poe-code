import { spawn } from 'node:child_process';
import { demand } from './primitives.mjs';

export async function supervise(budget, job, onMessage) {
  budget.admit(job.deadline);
  demand(budget.starts + 1 <= budget.caps.childStarts && budget.active.size < 2, 'PROCESS_ADMISSION');
  demand(job.deadline - budget.now() > budget.caps.reapMs, 'NO_REAP_TIME');
  const number = ++budget.starts;
  const record = { number, id: job.id, executable: job.executable, argv: job.argv, cwd: job.cwd, startedMs: budget.elapsed(), pid: null, code: null, signal: null, closed: false, timedOut: false, spawnError: null, captureError: null, raw: [], stdoutBytes: 0, stderrBytes: 0 };
  const admission = { ...record, deadlineOffsetMs: job.deadline - budget.origin, environment: job.env };
  const admissionBytes = Buffer.byteLength(JSON.stringify(admission));
  demand(admissionBytes <= 32768, 'CHILD_ADMISSION_METADATA');
  await budget.record(`${job.id}-admission`, admission);
  const spools = { stdout: await budget.stream(`${job.id}-stdout.bin`), stderr: await budget.stream(`${job.id}-stderr.bin`) };
  budget.admit(job.deadline);
  const child = spawn(job.executable, job.argv, { cwd: job.cwd, env: job.env, shell: false, detached: false, stdio: ['pipe', 'pipe', 'pipe', ...(onMessage ? ['ipc'] : [])], serialization: 'json' });
  record.pid = child.pid ?? null;
  if (child.pid) {
    budget.active.set(child.pid, child);
    if (process.connected) process.send({ role: 'OWNED_CHILD_START', pid: child.pid, id: job.id }, error => { if (error) budget.fail('OUTER_START_NOTIFICATION', true); });
  }
  budget.peak = Math.max(budget.peak, 2 + budget.active.size);
  demand(budget.peak <= budget.caps.peakProcesses, 'PEAK');
  let chain = Promise.resolve();
  let retired = false;
  let stopping = false;
  let currentDeadline = job.deadline;
  let retireResolve;
  let timeout;
  let termTimer;
  let killer;
  let barrier;
  const retirement = new Promise(resolve => { retireResolve = resolve; });
  function clearClocks() {
    clearTimeout(timeout);
    clearTimeout(termTimer);
    clearTimeout(killer);
    clearTimeout(barrier);
  }
  function arm(deadline) {
    clearClocks();
    currentDeadline = Math.min(deadline, job.deadline);
    timeout = setTimeout(() => { record.timedOut = true; stop('DEADLINE', false); }, Math.max(1, currentDeadline - budget.now() - budget.caps.reapMs));
    termTimer = setTimeout(() => { if (!retired && child.pid) child.kill('SIGTERM'); }, Math.max(1, currentDeadline - budget.now() - 2000));
    killer = setTimeout(() => { if (!retired && child.pid) child.kill('SIGKILL'); }, Math.max(1, currentDeadline - budget.now() - 1000));
    barrier = setTimeout(() => {
      if (!retired) { budget.fail(`${job.id}:UNKNOWN_RETIREMENT`, true); retireResolve(); }
    }, Math.max(1, currentDeadline - budget.now()));
  }
  const stop = (reason, shorten = true) => {
    if (stopping || retired) return;
    stopping = true;
    budget.fail(`${job.id}:${reason}`);
    if (child.connected) child.send({ type: 'CANCEL', reason }, error => { if (error) budget.fail(`${job.id}:CANCEL_DELIVERY`); });
    if (shorten) arm(Math.min(currentDeadline, budget.now() + budget.caps.reapMs));
  };
  let inCase = false;
  const controls = {
    beginCase(milliseconds) {
      demand(!inCase && Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= 30000, 'CASE_CLOCK');
      inCase = true;
      const deadline = Math.min(job.deadline, budget.now() + milliseconds);
      arm(deadline);
      return deadline - budget.origin;
    },
    endCase() { inCase = false; if (!stopping) arm(job.deadline); },
    deadline() { return currentDeadline; }
  };
  arm(job.deadline);
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', bytes => {
      child[stream].pause();
      record[`${stream}Bytes`] += bytes.length;
      chain = chain.then(async () => {
        const streamLimit = typeof job.streamBytes === 'number' ? job.streamBytes : job.streamBytes[stream];
        demand(Number.isSafeInteger(streamLimit) && record[`${stream}Bytes`] <= streamLimit, 'STREAM_LIMIT');
        await spools[stream].append(bytes);
      }).catch(error => {
        record.captureError = String(error);
        budget.fail(`${job.id}:CAPTURE:${error}`, true);
        stop('CAPTURE');
      }).finally(() => child[stream].resume());
    });
  }
  if (onMessage) child.on('message', message => {
    chain = chain.then(async () => {
      demand(JSON.stringify(message).length <= 131072, 'IPC_FRAME_LIMIT');
      const reply = await onMessage(message, record, controls);
      demand(Buffer.byteLength(JSON.stringify(reply)) <= 589824, 'IPC_REPLY_LIMIT');
      if (child.connected) await new Promise((resolve, reject) => child.send(reply, error => error ? reject(error) : resolve()));
    }).catch(error => { budget.fail(`${job.id}:IPC:${error}`, true); stop('IPC'); });
  });
  child.on('error', error => { record.spawnError = String(error); budget.fail(`${job.id}:SPAWN:${error}`, true); });
  child.stdin.on('error', error => { record.spawnError ??= String(error); budget.fail(`${job.id}:STDIN:${error}`, true); });
  child.stdin.end(job.input ?? Buffer.alloc(0));
  child.on('close', (code, signal) => {
      retired = true;
      record.closed = true;
      record.code = code;
      record.signal = signal;
      record.closedMs = budget.elapsed();
      if (budget.now() > currentDeadline) { record.timedOut = true; budget.fail(job.id + ':OBSERVED_CLOSE_DEADLINE'); }
      if (child.pid) {
        budget.active.delete(child.pid);
        if (process.connected) process.send({ role: 'OWNED_CHILD_CLOSE', pid: child.pid, id: job.id, code, signal }, error => { if (error) budget.fail('OUTER_CLOSE_NOTIFICATION', true); });
      }
      clearClocks();
      retireResolve();
  });
  await retirement;
  clearClocks();
  let chainDone = false;
  let captureTimer;
  await Promise.race([chain.then(() => { chainDone = true; }), new Promise(resolve => { captureTimer = setTimeout(resolve, Math.max(1, currentDeadline - budget.now())); })]);
  clearTimeout(captureTimer);
  if (!chainDone) budget.fail(`${job.id}:UNSETTLED_CAPTURE_OR_TOOL`, true);
  if (chainDone) for (const stream of ['stdout', 'stderr']) record.raw.push({ stream, ...await spools[stream].close() });
  record.captureCompletedMs = budget.elapsed();
  if (budget.now() > currentDeadline) { record.timedOut = true; budget.fail(job.id + ':POST_CLOSE_CAPTURE_DEADLINE'); }
  if (record.code !== 0 || record.signal !== null || record.timedOut || record.spawnError || record.captureError || !record.closed) budget.fail(`${job.id}:CHILD_FAIL`);
  demand(admissionBytes + Buffer.byteLength(JSON.stringify(record)) <= 65536, 'CHILD_TOTAL_METADATA');
  record.receipt = await budget.record(`${job.id}-retirement`, record, true);
  if (budget.now() > currentDeadline) { record.timedOut = true; budget.fail(job.id + ':RETIREMENT_PUBLICATION_DEADLINE'); }
  return record;
}
