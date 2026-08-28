import { Worker } from 'node:worker_threads';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VERSION, SAB_BYTES, views, control } from './wire.mjs';
import { Reservations } from './reservations.mjs';
import { createOwner } from './owner.mjs';
import { createFixture, latch } from './fixtures.mjs';
import { createParentRpc } from './parent-rpc.mjs';

export async function executeCase(caseRecord, session, registerCleanup) {
  const owner = createOwner(registerCleanup);
  const ledger = new Reservations();
  const completed = latch();
  let terminal = null;
  let worker;
  let fixture;
  let rpc;
  let captureBytes = 0;
  try {
    if (!caseRecord.candidateImplemented) throw new Error('held fixture has no qualified implementation');
    ledger.reserve('SAB', SAB_BYTES);
    ledger.reserve('frame-scratch', 4 * 65536);
    ledger.reserve('source-context-copies', 1048576);
    ledger.reserve('outcome-cache-capture', 1048576);
    const sab = new SharedArrayBuffer(SAB_BYTES);
    const channel = views(sab, session, true);
    owner.setChannel(channel);
    fixture = createFixture(caseRecord, owner);
    rpc = createParentRpc(channel, owner, fixture, ledger, fixture.recognizeFsError);
    const sourcePath = new URL('./scaffold.guest.js.data', import.meta.url);
    const sourceStat = lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > 262144) throw new Error('source pre-read admission');
    const sourceBytes = readFileSync(sourcePath);
    if (sourceBytes.length > 262144) throw new Error('source cap');
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    if (!owner.beforeConstruct()) return await owner.close();
    try {
      worker = new Worker(new URL(caseRecord.fixture === 'L08' ? './heap-worker.mjs' : './worker-entry.mjs', import.meta.url), {
        eval: false,
        execArgv: [],
        env: {},
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, codeRangeSizeMb: 8, stackSizeMb: 4 },
        workerData: { role: 'wrq-static-worker-v3', v: VERSION, session, sab, fixture: caseRecord.fixture, sourceSha256 }
      });
    } catch (value) {
      owner.constructionThrew(value);
      return await owner.close();
    }
    owner.acquired(worker);
    const captureClosed = [];
    for (const stream of [worker.stdout, worker.stderr]) {
      const closed = latch();
      captureClosed.push(closed.promise);
      stream.once('close', closed.release);
      stream.on('error', value => owner.fail(value, 'capture-control'));
      stream.on('data', chunk => {
        captureBytes += chunk.length;
        if (captureBytes > 65536) owner.fail(new Error('native capture limit'), 'capture-control');
        else if (chunk.length > 0) owner.fail(new Error('unexpected native output'), 'capture-control');
      });
    }
    owner.registerCleanup(() => Promise.all(captureClosed));
    worker.once('exit', () => completed.release());
    worker.on('message', value => {
      try {
        const message = control(value, session);
        if (message.kind === 'ready') {
          if (owner.events.some(event => event.kind === 'ready')) throw new Error('duplicate READY');
          owner.event('ready');
        } else if (message.kind === 'delivered') {
          rpc.delivery(message);
        } else if (message.kind === 'doorbell') {
          if (!owner.events.some(event => event.kind === 'ready')) throw new Error('RPC before READY');
          rpc.doorbell(message).catch(reason => owner.fail(reason, 'private-profile'));
        } else {
          if (terminal !== null) throw new Error('duplicate terminal');
          terminal = message;
          rpc.terminal(message);
        }
      } catch (reason) { owner.fail(reason, 'private-profile'); }
    });
    await completed.promise;
    if (caseRecord.fixture !== 'L08' && terminal === null && owner.failures.length === 0) owner.fail(new Error('exit without terminal'), 'private-profile');
  } catch (value) { owner.fail(value, 'private-profile'); }
  finally {
    await owner.close();
    if (rpc) rpc.reconcile();
  }
  const facts = await owner.close();
  const raw = owner.failures.filter(record => record.provenance !== 'private-profile');
  const status = raw.length ? null : owner.failures.length ? 2 : terminal?.kind === 'guestFailure' ? 1 : 0;
  const effects = fixture ? Array.from(fixture.files, ([path, bytes]) => ({ path, utf8: Buffer.from(bytes).toString('utf8') })) : [];
  const output = fixture ? Buffer.concat(fixture.output).toString('utf8') : '';
  const receipt = {
    case: caseRecord.instance,
    session,
    status,
    rawOutcomeRequiresActualHostMapping: raw.length > 0,
    raw: raw.map(record => ({ provenance: record.provenance, present: record.present, callerIdentity: fixture ? record.value === fixture.rawReasons.callerReason : false, sinkIdentity: fixture ? record.value === fixture.rawReasons.sinkReason : false, cleanupIdentity: fixture ? record.value === fixture.rawReasons.cleanupReason : false })),
    facts,
    events: owner.events,
    effects,
    stdout: output,
    stderr: '',
    terminal,
    outcomes: rpc ? Array.from(rpc.outcomes, ([seq, outcome]) => ({ seq, kind: outcome.kind, finalAck: outcome.finalAck, delivered: outcome.delivered, closed: outcome.closed })) : [],
    reservationPeak: ledger.peak,
    guestJobs: 'unknown-not-all-settled',
    captureBytes,
    heapEnforcement: caseRecord.fixture === 'L08' ? { observedOom: owner.failures.some(record => record.value?.code === 'ERR_WORKER_OUT_OF_MEMORY'), normalLoopExitIsNegative: true, engineEvaluations: 0 } : null
  };
  if (Buffer.byteLength(JSON.stringify(receipt)) > 65536) throw new Error('receipt cap');
  return { receipt, raw };
}
