import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hash, errorRecord, readFrames, writeFrame } from './io.mjs';

export function groupExists(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return null; }
}
function decoded(value, maximum) {
  assert.equal(typeof value, 'string', 'missing base64 capture');
  assert.ok(value.length <= Math.ceil(maximum / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value), 'invalid/oversize base64');
  const bytes = Buffer.from(value, 'base64');
  assert.ok(bytes.length <= maximum, 'decoded byte cap');
  return bytes.length;
}
function validateResult(request, message) {
  const caps = request.caps;
  if (request.profile !== 'breadth') {
    const observation = message.observation;
    assert.ok(observation && Number.isInteger(observation.exitCode));
    assert.ok(decoded(observation.stdout, caps.outputBytes) + decoded(observation.stderr, caps.outputBytes) <= caps.outputBytes, 'combined output cap');
    if (observation.raw) assert.ok(decoded(observation.raw.stdoutBase64, caps.outputBytes) + decoded(observation.raw.stderrBase64, caps.outputBytes) <= caps.outputBytes, 'raw combined output cap');
    const entries = Object.entries(observation.entries);
    assert.ok(entries.length <= caps.entries);
    let bytes = 0;
    for (const [name, entry] of entries) {
      const components = name.split('/');
      assert.ok(components.length <= caps.depth && components.every(component => component && component !== '.' && component !== '..'), 'unsafe snapshot path');
      assert.ok(['file', 'directory', 'symlink'].includes(entry.type));
      if (entry.type === 'file') bytes += decoded(entry.bytes, caps.outputBytes);
    }
    assert.ok(bytes <= caps.snapshotBytes);
  } else {
    const report = message.report;
    assert.ok(report && Array.isArray(report.captureErrors));
    if (report.result) assert.ok(decoded(report.result.stdoutBase64, caps.outputBytes) + decoded(report.result.stderrBase64, caps.outputBytes) <= caps.outputBytes, 'combined output cap');
    for (const census of [report.before, report.after].filter(Boolean)) {
      assert.ok(Array.isArray(census.entries) && census.entries.length <= caps.entries);
      let bytes = 0;
      for (const entry of census.entries) {
        assert.equal(typeof entry.path, 'string');
        assert.ok(entry.path.startsWith('/') && !entry.path.split('/').includes('..') && entry.path.split('/').length <= caps.depth + 2);
        if (entry.base64 !== undefined) bytes += decoded(entry.base64, caps.snapshotBytes);
      }
      assert.ok(bytes <= caps.snapshotBytes);
    }
  }
}
export async function runAttempt(request, { executable = process.execPath, onEvent = async () => {} } = {}) {
  assert.ok(process.platform !== 'win32', 'POSIX owned process groups required');
  assert.ok(request.nonce && request.id && request.caps && request.host);
  const caps = request.caps, launched = performance.now();
  const result = { id: request.id, nonce: request.nonce, synthetic: request.synthetic === true, profile: request.profile, engine: request.engine, failures: [], events: [], signals: [], result: null, engineExit: null, engineClose: null, sessionExit: null, sessionClose: null, diagnostics: [], clean: false, groupGone: false };
  const deadlines = { total: launched + caps.totalMs, startup: launched + caps.startupMs };
  let coordinator, timer, done = false, resolveDone, ready = false, requestStarted = false, captureEnded = false, resultSeen = false, fixtureClosed = false, sessionComplete = false, hostBytes = 0, reportBytes = 0, eventCount = 0;
  let termAt = Infinity, killAt = Infinity, stopAt = Infinity, termSent = false, killSent = false;
  const phases = new Set();
  const wireHash = createHash('sha256'), wirePrefix = [];
  let wireBytes = 0, prefixBytes = 0;
  const completion = new Promise(resolveCompletion => { resolveDone = resolveCompletion; });
  function record(event) {
    const entry = { atMs: Math.round((performance.now() - launched) * 1000) / 1000, ...event };
    if (result.events.length < caps.events + 32) result.events.push(entry);
    Promise.resolve(onEvent(entry)).catch(error => fail(`journal error: ${String(error)}`));
  }
  function fail(reason, grace = 0) {
    if (done) return;
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
    if (!result.failures.includes(text)) { result.failures.push(text); record({ kind: 'sticky-failure', reason: text }); }
    const now = performance.now();
    termAt = Math.min(termAt, now + grace, deadlines.total - caps.termMs - caps.killMs);
    killAt = Math.min(termAt + caps.termMs, deadlines.total - caps.killMs);
    stopAt = Math.min(killAt + caps.killMs, deadlines.total);
    if (coordinator?.stdin.writable && !result.cancelSent) {
      result.cancelSent = true;
      writeFrame(coordinator.stdin, { kind: 'cancel', reason: text }).catch(error => record({ kind: 'cancel-send-error', error: errorRecord(error) }));
    }
  }
  function signalGroup(signal) {
    if (!Number.isInteger(coordinator?.pid)) return;
    result.signals.push(signal); record({ kind: 'signal', signal, pgid: coordinator.pid });
    try { process.kill(-coordinator.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') { result.failures.push(`signal error ${signal}: ${String(error)}`); record({ kind: 'signal-error', error: errorRecord(error) }); } }
  }
  function finish() {
    if (done) return; done = true; clearTimeout(timer);
    result.groupGone = groupExists(coordinator?.pid) === false;
    const required = ['exec-start', 'exec-settled', 'snapshot-complete', 'dispose-start', 'dispose-settled'];
    if (!resultSeen) result.failures.push('missing result');
    if (!ready || !requestStarted || required.some(phase => !phases.has(phase))) result.failures.push('missing lifecycle phase');
    if (!result.engineExit || result.engineExit.code !== 0 || result.engineExit.signal !== null || !result.engineClose) result.failures.push('engine did not exit/close naturally');
    if (!result.sessionExit || result.sessionExit.code !== 0 || result.sessionExit.signal !== null || !result.sessionClose) result.failures.push('coordinator did not exit/close naturally');
    if (!captureEnded || !fixtureClosed || !sessionComplete || !result.groupGone) result.failures.push('unverified pipe/fixture/group closure');
    result.clean = result.failures.length === 0 && result.signals.length === 0;
    result.elapsedMs = Math.round((performance.now() - launched) * 1000) / 1000;
    result.deadlinesMs = Object.fromEntries(Object.entries(deadlines).map(([name, value]) => [name, Math.round((value - launched) * 1000) / 1000]));
    result.hostBytes = hostBytes; result.reportBytes = reportBytes;
    result.execAdmissions = { scoredCase: phases.has('exec-start') ? 1 : 0, emptyInitialization: result.events.filter(event => event.kind === 'phase' && event.phase === 'initialization-exec').length };
    result.wireCapture = { receivedBytes: wireBytes, receivedSha256: wireHash.digest('hex'), prefixBase64: Buffer.concat(wirePrefix).toString('base64'), prefixOnly: wireBytes > prefixBytes };
    if (!result.groupGone) result.unresolvedOwnedGroup = coordinator?.pid ?? null;
    coordinator?.stdin.destroy(); coordinator?.stdout.destroy(); coordinator?.stderr.destroy(); coordinator?.stdio[3]?.destroy();
    resolveDone(result);
  }
  function tick() {
    if (done) return;
    const now = performance.now();
    for (const [phase, deadline] of Object.entries(deadlines)) if (now >= deadline) {
      delete deadlines[phase];
      if (phase === 'total') { deadlines.total = deadline; fail('absolute total deadline'); }
      else fail(`${phase} deadline`, phase === 'guest' ? caps.settleMs : 0);
    }
    if (result.sessionClose && captureEnded && groupExists(coordinator?.pid) === false) { finish(); return; }
    if (now >= termAt && !termSent) { termSent = true; signalGroup('SIGTERM'); }
    if (now >= killAt && !killSent && groupExists(coordinator?.pid) !== false) { killSent = true; signalGroup('SIGKILL'); }
    if (now >= stopAt || now >= deadlines.total) { finish(); return; }
    timer = setTimeout(tick, Math.max(1, Math.min(10, ...Object.values(deadlines).map(deadline => deadline - now), termAt - now, killAt - now, stopAt - now)));
  }
  const args = ['--unhandled-rejections=strict', fileURLToPath(new URL('./session.mjs', import.meta.url)), ...(request.synthetic ? ['--synthetic'] : [])];
  coordinator = spawn(executable, args, { detached: true, cwd: request.host.cwd, env: request.host.env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  result.coordinatorPid = coordinator.pid ?? null;
  record({ kind: 'group-admitted', pid: coordinator.pid, pgid: coordinator.pid, argv: [executable, ...args], host: request.host });
  coordinator.stdin.on('error', error => { if (!done && !result.sessionClose) fail(`coordinator input: ${String(error)}`); });
  coordinator.on('error', error => { fail(`coordinator error: ${String(error)}`); if (!coordinator.pid) { captureEnded = true; finish(); } });
  coordinator.on('exit', (code, signal) => { result.sessionExit = { code, signal }; record({ kind: 'coordinator-exit', code, signal }); if (code !== 0 || signal !== null) fail('coordinator crash/forced exit'); });
  coordinator.on('close', (code, signal) => { result.sessionClose = { code, signal }; record({ kind: 'coordinator-close', code, signal }); });
  for (const [name, stream] of [['stdout', coordinator.stdout], ['stderr', coordinator.stderr]]) stream.on('data', chunk => {
    const remaining = Math.max(0, caps.diagnosticBytes - hostBytes); hostBytes += chunk.length;
    if (remaining) result.diagnostics.push({ source: 'coordinator', stream: name, base64: chunk.subarray(0, remaining).toString('base64') });
    if (hostBytes > caps.diagnosticBytes) { stream.destroy(); fail('host diagnostic byte cap'); }
  });
  readFrames(coordinator.stdio[3], async message => {
    if (done) return;
    try {
    assert.equal(message.id, request.id); assert.equal(message.nonce, request.nonce);
    assert.ok(++eventCount <= caps.events, 'event count cap');
    reportBytes += Buffer.byteLength(JSON.stringify(message)) + 4;
    assert.ok(reportBytes <= caps.reportBytes);
    const now = performance.now();
    if (message.kind === 'ready') {
      assert.ok(!ready, 'duplicate ready'); ready = true; requestStarted = true;
      delete deadlines.startup; deadlines.request = Math.min(now + caps.requestMs, deadlines.total - caps.termMs - caps.killMs);
      record({ kind: 'request-start', absoluteDeadlineMs: deadlines.request - launched });
    } else if (message.kind === 'phase') {
      const phase = message.phase;
      if (['exec-start', 'exec-settled', 'snapshot-complete', 'dispose-start', 'dispose-settled'].includes(phase)) {
        assert.ok(ready && !phases.has(phase), 'duplicate/premature phase');
        const ordered = ['exec-start', 'exec-settled', 'snapshot-complete', 'dispose-start', 'dispose-settled'];
        const index = ordered.indexOf(phase);
        assert.ok(index === 0 || phases.has(ordered[index - 1]), 'out-of-order phase');
        phases.add(phase);
        if (phase === 'exec-start') deadlines.guest = Math.min(now + caps.guestMs, deadlines.request);
        if (phase === 'exec-settled') { delete deadlines.guest; deadlines.snapshot = Math.min(now + caps.snapshotMs, deadlines.request); }
        if (phase === 'snapshot-complete') delete deadlines.snapshot;
        if (phase === 'dispose-start') deadlines.dispose = Math.min(now + caps.disposeMs, deadlines.request);
        if (phase === 'dispose-settled') delete deadlines.dispose;
      }
    } else if (message.kind === 'result') {
      assert.ok(ready && !resultSeen, 'duplicate/premature result');
      validateResult(request, message); resultSeen = true; result.result = message;
      if (message.report?.cleanup?.error) fail('reported disposal error');
      deadlines.natural = Math.min(now + caps.naturalMs, deadlines.request, deadlines.total - caps.termMs - caps.killMs);
    } else if (message.kind === 'failure' || message.kind === 'fixture-error') fail(message.error, /guest deadline/u.test(JSON.stringify(message.error)) ? caps.settleMs : 0);
    else if (message.kind === 'engine-spawn') { assert.ok(!result.enginePid && Number.isInteger(message.pid)); result.enginePid = message.pid; }
    else if (message.kind === 'engine-exit') { assert.ok(!result.engineExit); result.engineExit = { code: message.code, signal: message.signal }; if (message.code !== 0 || message.signal !== null) fail('engine crash/forced exit'); }
    else if (message.kind === 'engine-close') { assert.ok(!result.engineClose); result.engineClose = { code: message.code, signal: message.signal }; }
    else if (message.kind === 'fixture-close') { fixtureClosed = message.closed === true && !message.failed && message.sockets === 0; if (!fixtureClosed) fail('fixture cleanup incomplete'); result.network = message; }
    else if (message.kind === 'session-complete') { assert.ok(!sessionComplete); sessionComplete = true; }
    else if (message.kind === 'diagnostic') { hostBytes += decoded(message.base64, caps.diagnosticBytes); assert.ok(hostBytes <= caps.diagnosticBytes, 'host diagnostic byte cap'); result.diagnostics.push(message); }
    else assert.ok(['module', 'public-resolution', 'entry-import-fulfilled'].includes(message.kind), 'unknown protocol message');
    record(message.kind === 'result' ? { kind: 'result-received', sha256: hash(JSON.stringify(message)), absoluteTotalUnchangedMs: deadlines.total - launched } : message);
    } catch (error) {
      result.rejectedFrames ??= [];
      result.rejectedFrames.push(message);
      throw error;
    }
  }, { bytes: caps.reportBytes, events: caps.events, onChunk(chunk) {
    if (done) return;
    wireBytes += chunk.length; wireHash.update(chunk);
    const count = Math.min(chunk.length, 4096 - prefixBytes);
    if (count > 0) { wirePrefix.push(Buffer.from(chunk.subarray(0, count))); prefixBytes += count; }
  } }).then(() => { captureEnded = true; }, error => { captureEnded = true; fail(`capture: ${String(error)}`); });
  writeFrame(coordinator.stdin, { kind: 'configure', request }).catch(error => fail(`configure send: ${String(error)}`));
  tick();
  return completion;
}
