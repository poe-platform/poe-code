import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { hash, canonical, requireValue, retirement, reasonData } from './profile.mjs';
export class ProviderStop extends Error { constructor(message, receipt) { super(message); this.name = 'ProviderStop'; this.receipt = receipt; } }
export function groupPresent(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export async function captureProcess(request, context, signal) {
  const { root, budget, profilePath, tools } = context;
  requireValue(!budget.halted && !budget.active && Date.now() < budget.deadline, 'COHORT_ADMISSION');
  const reserved = 1 + request.extraChildReservation;
  requireValue(budget.reserved + reserved <= budget.maxChildren, 'PROCESS_RESERVATION_LIMIT');
  const record = { id: request.id, role: request.role, requestSha256: hash(canonical(request)), started: Date.now(), pid: null, exit: false, close: false, stdoutEOF: false, stderrEOF: false, eventsEOF: false, status: null, signal: null, children: [], events: [], errors: [], groupPresent: null, unknownDescendants: false, captureFailure: false, cancellation: null, escalation: [], observedRootSpawn: false };
  const prefix = root + '/capture/' + request.id;
  const files = new Map();
  let processHandle, finished = false, cancelSeen = false, cancelReason, captureError;
  let escalationTimer, finalTimer, caseTimer;
  const finish = new Promise(resolve => { record.finish = resolve; });
  const raw = name => { const descriptor = fs.openSync(prefix + '.' + name, 'wx', 0o600); files.set(name, descriptor); return descriptor; };
  const descriptors = {};
  const journal = row => {
    const bytes = Buffer.from(JSON.stringify({ at: Date.now(), ...row }) + '\n');
    if (budget.captureBytes + bytes.length > budget.maxCapture) throw Error('TOTAL_CAPTURE_LIMIT');
    fs.writeSync(descriptors.lifecycle, bytes); budget.captureBytes += bytes.length;
  };
  const cleanup = async () => {
    clearTimeout(caseTimer); clearTimeout(escalationTimer); clearTimeout(finalTimer);
    if (signal) signal.removeEventListener('abort', abort);
    for (const descriptor of files.values()) fs.closeSync(descriptor);
    files.clear(); record.captureDescriptorsClosed = true; budget.active = false;
  };
  const send = name => {
    if (!processHandle?.pid) return;
    record.escalation.push({ name, at: Date.now() });
    try { process.kill(-processHandle.pid, name); }
    catch (error) { if (error.code !== 'ESRCH') record.errors.push({ phase: 'kill', code: error.code }); }
  };
  const stop = () => {
    if (finished || escalationTimer || finalTimer) return;
    send('SIGTERM');
    escalationTimer = setTimeout(() => { send('SIGKILL'); finalTimer = setTimeout(() => { if (!finished) { record.unknownDescendants = true; budget.halted = true; finished = true; record.finish(); } }, request.bounds.killMs); }, request.bounds.termMs);
  };
  const abort = () => {
    if (!cancelSeen) { cancelSeen = true; cancelReason = signal.reason; record.cancellation = reasonData(cancelReason); }
    stop();
  };
  const chunks = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0, events: 0 };
  let eventBuffer = '';
  const eventRow = row => {
    requireValue(row && row.id === request.id && typeof row.event === 'string', 'EVENT_IDENTITY');
    record.events.push(row);
    if (row.event === 'SAFETY_VIOLATION') { budget.halted = true; record.errors.push({ phase: 'fence', code: 'SAFETY_VIOLATION' }); stop(); }
    if (row.event === 'CHILD_SPAWN') {
      requireValue(Number.isSafeInteger(row.pid) && row.pid > 0 && !record.children.some(child => child.pid === row.pid) && record.children.length < request.extraChildReservation, 'CHILD_RESERVATION_OR_IDENTITY');
      record.children.push({ pid: row.pid, exit: false, close: false, evidence: 'PINNED_FIXTURE_CHILDPROCESS_NOTIFICATION_NOT_KERNEL_CENSUS' });
    }
    if (row.event === 'CHILD_EXIT' || row.event === 'CHILD_CLOSE') {
      const child = record.children.find(child => child.pid === row.pid);
      requireValue(child, 'UNENROLLED_CHILD');
      const key = row.event === 'CHILD_EXIT' ? 'exit' : 'close'; requireValue(!child[key], 'DUPLICATE_CHILD_EVENT'); child[key] = true; child.status = row.status; child.signal = row.signal;
    }
    context.onEvent?.(row);
  };
  const consume = name => bytes => {
    try {
      const limit = name === 'events' ? request.bounds.eventBytes : request.bounds.perStreamBytes;
      if (sizes[name] + bytes.length > limit || budget.captureBytes + bytes.length > budget.maxCapture) throw Error('CAPTURE_LIMIT');
      fs.writeSync(descriptors[name], bytes); sizes[name] += bytes.length; budget.captureBytes += bytes.length;
      if (name === 'events') { eventBuffer += bytes.toString('utf8'); let newline; while ((newline = eventBuffer.indexOf('\n')) >= 0) { const line = eventBuffer.slice(0, newline); eventBuffer = eventBuffer.slice(newline + 1); eventRow(JSON.parse(line)); } }
      else chunks[name].push(Buffer.from(bytes));
    } catch (error) { captureError ??= error; record.captureFailure = true; budget.halted = true; stop(); }
  };
  try {
    for (const name of ['stdout', 'stderr', 'events', 'lifecycle']) descriptors[name] = raw(name);
    journal({ event: 'OWNER_ENROLLED', request, reserved, groupPolicy: 'detached-root-no-unref-fixed-source-descendants' });
    budget.reserved += reserved; budget.active = true;
    if (signal?.aborted) { cancelSeen = true; cancelReason = signal.reason; record.cancellation = reasonData(cancelReason); record.notLaunched = true; return await finishWithoutLaunch(); }
    processHandle = spawn(tools.tools.find(tool => tool.role === 'sandbox').path, ['-f', profilePath, request.executable, ...request.argv], { shell: false, detached: true, cwd: request.cwd, env: request.environment, stdio: ['pipe','pipe','pipe','pipe'] });
    record.pid = processHandle.pid ?? null;
    processHandle.on('spawn', () => { record.observedRootSpawn = true; try { journal({ event: 'ROOT_SPAWN', pid: processHandle.pid }); } catch (error) { captureError ??= error; record.captureFailure = true; budget.halted = true; stop(); } });
    processHandle.on('error', error => { record.errors.push({ phase: 'spawn', code: error.code, message: error.message }); });
    processHandle.on('exit', (status, receivedSignal) => { record.exit = true; record.status = status; record.signal = receivedSignal; try { journal({ event: 'ROOT_EXIT', status, signal: receivedSignal }); } catch (error) { captureError ??= error; record.captureFailure = true; budget.halted = true; } });
    processHandle.stdout.on('data', consume('stdout')); processHandle.stderr.on('data', consume('stderr')); processHandle.stdio[3].on('data', consume('events'));
    processHandle.stdout.once('end', () => { record.stdoutEOF = true; }); processHandle.stderr.once('end', () => { record.stderrEOF = true; }); processHandle.stdio[3].once('end', () => { record.eventsEOF = true; });
    for (const stream of [processHandle.stdout, processHandle.stderr, processHandle.stdio[3]]) stream.on('error', error => { captureError ??= error; record.captureFailure = true; budget.halted = true; stop(); });
    processHandle.stdin.on('error', error => { if (error.code !== 'EPIPE') { record.errors.push({ phase: 'stdin', code: error.code }); stop(); } });
    processHandle.once('close', (status, receivedSignal) => { record.close = true; record.status = status; record.signal = receivedSignal; if (!finished) { finished = true; record.finish(); } });
    if (signal) signal.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const available = Math.min(request.bounds.caseMs, budget.deadline - Date.now() - request.bounds.termMs - request.bounds.killMs);
    requireValue(available > 0, 'INSUFFICIENT_CLEANUP_WINDOW');
    caseTimer = setTimeout(() => { record.timedOut = true; stop(); }, available);
    processHandle.stdin.end(Buffer.from(request.stdinBase64, 'base64'));
    await finish;
    clearTimeout(caseTimer); clearTimeout(escalationTimer); clearTimeout(finalTimer);
    record.groupPresent = record.pid ? groupPresent(record.pid) : null;
    if (record.groupPresent) {
      record.unknownDescendants = true; budget.halted = true; send('SIGTERM');
      const termUntil = Date.now() + request.bounds.termMs;
      while (groupPresent(record.pid) && Date.now() < termUntil) await new Promise(resolve => setTimeout(resolve, 20));
      if (groupPresent(record.pid)) {
        send('SIGKILL');
        const killUntil = Date.now() + request.bounds.killMs;
        while (groupPresent(record.pid) && Date.now() < killUntil) await new Promise(resolve => setTimeout(resolve, 20));
      }
      record.groupPresent = groupPresent(record.pid);
    }
    if (eventBuffer.length) { record.captureFailure = true; record.errors.push({ phase: 'events', code: 'PARTIAL_EVENT' }); }
    record.finished = Date.now(); record.stdoutBase64 = Buffer.concat(chunks.stdout).toString('base64'); record.stderrBase64 = Buffer.concat(chunks.stderr).toString('base64'); record.bytes = sizes;
    record.retirement = retirement(record); delete record.finish;
    journal({ event: 'FINAL_RECEIPT', record });
    context.onReceipt?.(record);
    if (record.retirement === 'UNKNOWN' || budget.halted || captureError) { budget.halted = true; throw new ProviderStop('SAFETY_CAPTURE_OR_RETIREMENT_STOP', record); }
    if (cancelSeen) throw cancelReason;
    return record;
  } catch (error) {
    if (processHandle && !finished) { stop(); await finish; }
    throw error;
  } finally { await cleanup(); }
  async function finishWithoutLaunch() { record.finished = Date.now(); delete record.finish; record.retirement = 'NOT_LAUNCHED'; journal({ event: 'NOT_LAUNCHED', record }); context.onReceipt?.(record); throw cancelReason; }
}
