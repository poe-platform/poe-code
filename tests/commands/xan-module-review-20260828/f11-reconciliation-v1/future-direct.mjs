import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { assertConditional, hash } from './conditional.mjs';

export function forwardInvocation(context, args, options) {
  return context.invoke('xan', args, options);
}

export function forwardMiddleware(context, next) {
  return next();
}

export async function runFuture({ job, module, contracts, api, emit, layout }) {
  assert.equal(layout.f11Checkpoint, 'ROOT_APPROVED_EXACT_DENIAL_REVIEW_AND_MATERIALIZED_GRAPH');
  const profileBytes = await readFile(new URL('./PROFILE.json', import.meta.url));
  assert.equal(hash(profileBytes), layout.f11ProfileSha256);
  const profile = JSON.parse(profileBytes);
  const spec = profile.cases.find(item => item.id === job.id);
  assert.ok(spec);
  assert.deepEqual(job, { id: spec.id, kind: 'f11-reconciliation' });
  assert.deepEqual(layout.f11CandidateBinding, profile.candidateBinding);
  const reasons = {
    caller: Object.freeze({ code: 'ENOENT', origin: 'caller' }),
    parentBudget: new api.ShellLimitError('maxOutputBytes'),
    parentControl: Object.freeze({ origin: 'parent-control', control: 'escape' }),
    sink: new contracts.FsError('EIO', { path: '/work/stderr', message: 'maxWork limit exceeded' }),
    cleanup: Object.freeze({ origin: 'owned-input-return', code: 'ENOENT' }),
  };
  const controller = new AbortController();
  const callbacks = []; const events = []; const chunks = { stdout: [], stderr: [] };
  const counts = { acquisitions: 0, next: 0, returns: 0, stdoutWrites: 0, stderrWrites: 0, fsReadStream: 0 };
  let inputIndex = 0; let closing;
  const stream = { [Symbol.asyncIterator]() {
    counts.acquisitions++; events.push('acquire');
    return {
      async next() { counts.next++; return inputIndex++ ? { done: true } : { done: false, value: Buffer.from(spec.inputHex, 'hex') }; },
      return() {
        closing ??= Promise.resolve().then(() => { counts.returns++; if (spec.host === 'cleanup') throw reasons.cleanup; return { done: true }; });
        return closing;
      },
    };
  } };
  const sink = destination => ({ async write(chunk) {
    counts[`${destination}Writes`]++;
    if (destination === 'stderr' && ['parentBudget', 'parentControl', 'sink'].includes(spec.host)) throw reasons[spec.host];
    assert.ok(chunks[destination].reduce((total, part) => total + part.length, 0) + chunk.length <= 65536);
    chunks[destination].push(Buffer.from(chunk));
  } });
  const context = {
    command: 'xan', args: spec.argv, cwd: '/work', env: { KEEP: 'parent' },
    signal: controller.signal, stdin: stream, stdinIsDefault: false,
    stdout: sink('stdout'), stderr: sink('stderr'),
    fs: { readStream() { counts.fsReadStream++; return stream; } },
    registerCleanup(callback) { events.push('register'); callbacks.push(callback); },
  };
  if (spec.host === 'caller') controller.abort(reasons.caller);
  const timer = setTimeout(() => controller.abort(Object.freeze({ fixtureDeadline: spec.id })), spec.deadlineMs);
  let outcome; let reason; let rejected = false;
  const pending = module.createXanCommand({ limits: spec.overrides }).execute(context);
  try { outcome = await pending; } catch (error) { rejected = true; reason = error; }
  events.push('command-settle');
  const cleanupPromises = callbacks.map(callback => callback());
  const cleanupIdentity = callbacks.every((callback, index) => callback() === cleanupPromises[index]);
  const cleanup = await Promise.allSettled(cleanupPromises);
  clearTimeout(timer);
  events.push('root-drain');
  const reasonKey = rejected ? Object.keys(reasons).find(key => reasons[key] === reason) : undefined;
  const observation = {
    settlement: rejected ? 'rejected' : 'fulfilled',
    result: outcome ?? null,
    reason: rejected ? { token: reasonKey ?? 'UNRECOGNIZED', exactIdentity: Boolean(reasonKey) } : null,
    stdoutHex: Buffer.concat(chunks.stdout).toString('hex'), stderrHex: Buffer.concat(chunks.stderr).toString('hex'),
    counts, cleanupRegistered: callbacks.length, cleanupPromiseIdentity: cleanupIdentity,
    cleanupFailures: cleanup.filter(item => item.status === 'rejected').map(item => ({ token: item.reason === reasons.cleanup ? 'cleanup' : 'UNRECOGNIZED', exactIdentity: item.reason === reasons.cleanup })),
    callerAborted: controller.signal.aborted,
  };
  const receipt = {
    binding: { ...profile.candidateBinding, profile: profile.version, caseSha256: hash(JSON.stringify(spec)),
      argv: spec.argv, inputHex: spec.inputHex, factory: { limits: spec.overrides },
      caps: { ...profile.defaults, ...spec.overrides }, parentShellOutputLimit: null, collectingCap: 65536 },
    evidenceKind: 'PUBLIC_OBSERVATIONS_PLUS_STATIC_PATH_NOT_MEASURED_COUNTERS',
    staticPath: spec.staticPath, instrumentedCounters: false, observation,
    invocations: 1, admissionBeforeAcquisition: !counts.acquisitions || events.indexOf('register') < events.indexOf('acquire'),
    closed: true, intact: true, rawBeforeAssertion: true,
  };
  const raw = { stage: 'RAW_OBSERVATION', id: job.id, receipt, events, cleanupSettled: cleanup.length, actualCounters: 'NOT_OBSERVABLE' };
  const file = await open(path.join(layout.f11RawDirectory, `${job.id}.json`), 'wx');
  try { await file.writeFile(`${JSON.stringify(raw)}\n`); await file.sync(); } finally { await file.close(); }
  await emit(raw);
  if (cleanup.some(item => item.status === 'rejected' && (spec.host !== 'cleanup' || item.reason !== reasons.cleanup))) {
    const error = Error('unexpected cooperative cleanup failure; stop dependents'); error.name = 'CleanupFailure'; throw error;
  }
  assertConditional(profile, spec, receipt);
}
