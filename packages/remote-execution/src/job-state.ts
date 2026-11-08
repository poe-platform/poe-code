import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AdmissionRecord, AdmissionStore } from './admissions.js';
import { UploadError } from './upload-protocol.js';
import { validateWire } from './wire-validation.js';
import type { Outcome } from './wire.generated.js';

export interface JobStateEvent {
  version: 1;
  sequence: string;
  stage: 'accepted' | 'running' | 'process-exited' | 'io-settled' | 'sandbox-lost' | 'unknown-outcome';
  retainedUntil: number;
  effectBarrier: string;
  processOutcome?: Outcome;
  cancelRequested?: boolean;
  cancelActed?: boolean;
  outputComplete?: boolean;
  cleanup?: 'pending' | 'complete' | 'unknown';
}
function validateProgress(previous: JobStateEvent | null | undefined, state: Omit<JobStateEvent, 'version' | 'sequence'>) {
  const allowed: Record<JobStateEvent['stage'], readonly JobStateEvent['stage'][]> = {
    accepted:['accepted','running','unknown-outcome','sandbox-lost'],
    running:['running','process-exited','unknown-outcome','sandbox-lost'],
    'process-exited':['process-exited','io-settled','unknown-outcome','sandbox-lost'],
    'io-settled':['io-settled','sandbox-lost','unknown-outcome'],
    'sandbox-lost':['sandbox-lost'], 'unknown-outcome':['unknown-outcome','sandbox-lost'],
  };
  // Same-stage snapshots include cancellation observations after loss. They
  // preserve history without restoring native attachment or stream authority.
  if ((!previous && state.stage !== 'accepted') || previous && !allowed[previous.stage].includes(state.stage)) throw new TypeError('Invalid durable job transition');
  if ((state.stage === 'process-exited' || state.stage === 'io-settled') && !state.processOutcome) throw new TypeError('Native outcome observation is required');
  if ((state.stage === 'accepted' || state.stage === 'running') && state.processOutcome) throw new TypeError('Native outcome cannot precede process exit');
  // Output completion is invocation settlement evidence, not an individual
  // stream's END. A pre-exit claim would freeze the effect barrier while the
  // native process can still write, and must fail retained-history admission too.
  if ((state.stage === 'accepted' || state.stage === 'running') && state.outputComplete) throw new TypeError('Output completion cannot precede process exit');
  if (state.processOutcome && (state.processOutcome.kind === 'spawnError' || state.processOutcome.kind === 'unknown' || state.processOutcome.kind === 'executionError' || state.processOutcome.kind === 'canceled' && !state.processOutcome.terminationConfirmed)) throw new TypeError('Confirmed native outcome is required');
  if (state.cancelActed && !state.cancelRequested) throw new TypeError('Cancellation action requires a request');
  // Retained loss evidence supports inspection and requests, never a new
  // assertion that a detached native process received a termination action.
  if (previous && (previous.stage === 'sandbox-lost' || previous.stage === 'unknown-outcome') && !previous.cancelActed && state.cancelActed) throw new TypeError('Cancellation action requires native attachment');
  if (previous && (previous.stage === 'sandbox-lost' || previous.stage === 'unknown-outcome') && !previous.processOutcome && state.processOutcome) throw new TypeError('Native outcome requires retained process attachment');
  // The same ordering governs live appends and retained-history admission.
  // An observed exit wins over a subsequent action; a later request is still
  // inspectable, and an action preceding exit remains part of the history.
  if (previous?.processOutcome && !previous.cancelActed && state.cancelActed) throw new TypeError('Cancellation action cannot follow an observed native outcome');
  if (previous) {
    // Immutable slots are reclaimed independently. Changing the deadline would
    // let sweep delete a prefix while a later state still advertises recovery.
    if (state.retainedUntil !== previous.retainedUntil) throw new TypeError('Invocation retention deadline cannot change');
    if (BigInt(state.effectBarrier) < BigInt(previous.effectBarrier)) throw new TypeError('Effect barrier cannot regress');
    // Settlement closes effect admission. Later cancellation or loss evidence
    // may advance the event sequence, but cannot add effects to the final drain.
    if (previous.outputComplete && previous.cleanup === 'complete' && state.effectBarrier !== previous.effectBarrier) throw new TypeError('Settled effect barrier cannot change');
    if (previous.processOutcome && !isDeepStrictEqual(state.processOutcome, previous.processOutcome)) throw new TypeError('Observed native outcome cannot change');
    if (previous.cancelRequested && !state.cancelRequested || previous.cancelActed && !state.cancelActed) throw new TypeError('Cancellation observation cannot regress');
    if (previous.outputComplete && state.outputComplete !== true || previous.cleanup === 'complete' && state.cleanup !== 'complete') throw new TypeError('Completed settlement barrier cannot regress');
  }
  if (state.stage === 'io-settled' && (state.outputComplete !== true || state.cleanup !== 'complete')) throw new TypeError('I/O settlement requires complete output and cleanup');
}
/** Immutable, fsynced records precede every corresponding externally visible
 * transition. A running record is NOT proof of process attachment after a crash.
 * Single writer per invocation; failed persistence permanently closes admission. */
export function createJobStateJournal(store: AdmissionStore, admission: AdmissionRecord) {
  const identity = structuredClone(admission);
  let sequence = 0; let previous: JobStateEvent | undefined;
  // Inspection acknowledges immutable evidence, but never grants native writer
  // authority. Keep the bounded prefix independently of the execution cursor.
  const observed = new Map<number, JobStateEvent>();
  let tail: Promise<void> = Promise.resolve();
  function eventId(n: number) { return createHash('sha256').update(JSON.stringify([identity.operationId,'state',n])).digest('hex'); }
  function bind(record: AdmissionRecord) {
    if (record.epoch !== identity.epoch || record.tenantId !== identity.tenantId || record.principalId !== identity.principalId || record.sessionId !== identity.sessionId || record.requestDigest !== identity.requestDigest || record.buildDigest !== identity.buildDigest) throw new UploadError(409, 'Invocation payload or build conflict');
  }
  async function readRecord(n: number): Promise<AdmissionRecord | null> {
    const id = eventId(n);
    let record: AdmissionRecord | null;
    try {
      // Later provider reads may reuse or mutate their response carriers. Own
      // each immutable observation before the next read yields, so inspection
      // and recovery cannot invent effects or retract acknowledged outcomes.
      record = structuredClone(await store.inspect(id));
    }
    catch (cause) {
      // An unavailable ledger cannot prove absence of acceptance. In particular,
      // parser/provider failures are not malformed caller requests or native exits.
      throw Object.assign(new UploadError(503, 'Durable invocation state unavailable; outcome unknown'), { cause });
    }
    if (record && (record.operationId !== id || record.kind !== 'job-state')) throw new UploadError(410, 'Durable invocation record identity is contradictory; outcome cannot be recovered');
    return record;
  }
  async function readHistory(now: number, limit = 16): Promise<JobStateEvent | null> {
    let latest: JobStateEvent | null = null;
    const history: JobStateEvent[] = [];
    const records: (AdmissionRecord | null)[] = [];
    let last = -1;
    // There are at most six lifecycle transitions plus cancellation observations.
    for (let n = 1; n <= limit; n++) {
      records.push(await readRecord(n));
      if (records[n - 1] !== null) last = n - 1;
    }
    for (let index = 0; index <= last; index++) {
      const n = index + 1;
      // Another owner may have published this slot after our first read, then
      // published a tail we did observe. Immutable records allow a bounded
      // prefix recheck without acquiring execution authority or polling.
      const record = records[index] ?? await readRecord(n);
      // A surviving tail cannot authorize recovery from a truncated prefix.
      // Scan the bounded journal even after a miss: storage loss is not absence
      // of acceptance, nor proof that the earlier process state is current.
      if (!record) throw new UploadError(410, 'Durable invocation state is incomplete; outcome cannot be recovered');
      bind(record);
      try {
        validateWire('JobStateEvent', record.jobState);
        if (record.retainedUntil !== record.jobState!.retainedUntil) throw new TypeError('Durable job retention conflict');
        if (record.jobState!.sequence !== String(n)) throw new TypeError('Durable job sequence conflict');
        validateProgress(latest, record.jobState!);
        if (previous && n === sequence && !isDeepStrictEqual(record.jobState, previous)) throw new TypeError('Acknowledged durable job event changed');
        if (observed.has(n) && !isDeepStrictEqual(record.jobState, observed.get(n))) throw new TypeError('Inspected durable job event changed');
      } catch {
        throw new UploadError(410, 'Durable invocation history is contradictory; outcome cannot be recovered');
      }
      latest = structuredClone(record.jobState!);
      history.push(latest);
    }
    // This attached owner has already acknowledged this prefix. A missing tail
    // (including total ledger loss) is uncertainty, never fresh admission.
    if ((previous || observed.size) && (!latest || BigInt(latest.sequence) < BigInt(Math.max(sequence, observed.size)))) throw new UploadError(410, 'Acknowledged durable invocation state was lost; outcome cannot be recovered');
    if (latest && latest.retainedUntil <= now) throw new UploadError(410, 'Invocation retention expired; outcome cannot be recovered');
    for (const event of history) observed.set(Number(event.sequence), structuredClone(event));
    return latest;
  }
  async function commit(snapshot: Omit<JobStateEvent, 'version' | 'sequence'> | Pick<JobStateEvent, 'cancelRequested' | 'cancelActed'>): Promise<JobStateEvent> {
      // A fresh owner has no process attachment. Retained acceptance is evidence
      // to inspect/recover, never permission to overwrite sequence 1 or relaunch.
      // recover initializes the cursor separately after an explicit loss decision.
      if (!previous && await readHistory(0)) throw new UploadError(410, 'Invocation already accepted; inspect retained state instead of restarting execution');
      if (previous) {
        // An isolation owner may have recorded loss after our last publication.
        // A surviving prefix does not authorize overwriting that recovery tail
        // or continuing native publication from a detached execution owner.
        await readHistory(0, sequence);
        if (sequence < 16 && await readRecord(sequence + 1)) throw new UploadError(410, 'Durable invocation advanced outside this execution owner; inspect recovery state instead of publishing');
      }
      // Observations select the latest stage only after earlier durable writes.
      // Cancellation racing exit must never restore a stale running snapshot.
      if (!('stage' in snapshot) && !previous) throw new TypeError('Observation requires accepted invocation');
      const state = { ...previous!, ...snapshot };
      if(previous?.cancelRequested)state.cancelRequested=true;
      if(previous?.cancelActed)state.cancelActed=true;
      if(previous?.processOutcome) {
        const outcome=previous.processOutcome;
        if(state.processOutcome && !isDeepStrictEqual(state.processOutcome,outcome))throw new TypeError('Observed native outcome cannot change');
        state.processOutcome=outcome;
      }
      // Cancellation remains observable after loss; it does not revive the job
      // or imply that termination acted. Stage-bearing writes still obey the graph.
      if (previous && 'stage' in snapshot && previous.stage === 'sandbox-lost') throw new TypeError('Invalid durable job transition');
      if (previous && 'stage' in snapshot && previous.stage === 'unknown-outcome' && state.stage === 'unknown-outcome') throw new TypeError('Invalid durable job transition');
      validateProgress(previous, state);
      // A lost cancellation receipt can be requested repeatedly across transport
      // reconnects. Unchanged observations reuse the durable receipt; retries
      // must not consume the bounded history needed for exit and I/O settlement.
      // Validate first so a contradictory action still fails, and keep this in
      // the writer queue so a racing exit selects its actual latest sequence.
      if (!('stage' in snapshot) && previous && isDeepStrictEqual(state, previous)) return structuredClone(previous);
      if (sequence >= 16) throw new UploadError(429, 'Durable transition bound');
      const result: JobStateEvent = { ...state, version:1, sequence:String(sequence + 1) };
      validateWire('JobStateEvent', result);
      try {
        // The adapter owns its record carrier, never this writer's evidence.
        // Retaining or mutating that carrier must not rewrite an acknowledged
        // native outcome or bypass contradiction detection during reconnect.
        await store.record({ ...identity, operationId:eventId(sequence + 1), kind:'job-state', retainedUntil:result.retainedUntil, jobState:structuredClone(result) });
      } catch (cause) {
        // Publication may have completed before its durability receipt failed.
        // Provider exceptions (including TypeError) cannot establish rejection
        // or native completion. The rejected writer queue stays closed; only
        // inspection and an explicit isolation-owner recovery may follow.
        throw Object.assign(new UploadError(503, 'Durable invocation state unavailable; outcome unknown'), { cause });
      }
      sequence++; previous = result;
      return structuredClone(result);
  }
  function append(value: Omit<JobStateEvent, 'version' | 'sequence'> | Pick<JobStateEvent, 'cancelRequested' | 'cancelActed'>): Promise<JobStateEvent> {
    const snapshot = structuredClone(value);
    const work = tail.then(() => commit(snapshot));
    tail = work.then(() => {}); void tail.catch(() => {});
    return work;
  }
  return { append,
    inspect(now: number) {
      if (!Number.isSafeInteger(now) || now < 0) return Promise.reject(new TypeError('Invalid retention time'));
      // Freeze this owner's writer while scanning. Otherwise a slot read as
      // absent can be filled before a later slot is read, mimicking prefix loss.
      // Inspection remains available after failed persistence, but must not
      // reopen the writer that failure permanently closed.
      const prior = tail;
      const work = prior.catch(() => {}).then(() => readHistory(now));
      // Unrecoverable history loss retires this owner even if the ledger is
      // later restored. Reading surviving evidence cannot prove attachment.
      // Keep inspection available, without allowing it to clear that failure.
      tail = work.then(() => prior, error => {
        if (error instanceof UploadError && error.status === 410) throw error;
        return prior;
      }); void tail.catch(() => {});
      return work;
    },
    /** Only the isolation owner can assert loss; a network disconnect cannot.
     * Recovery does not expose any launch operation. */
    recover(now:number,stage:'sandbox-lost'|'unknown-outcome') {
      if (!Number.isSafeInteger(now) || now < 0) return Promise.reject(new TypeError('Invalid retention time'));
      // Inspection and its resulting write share the transition queue. Otherwise
      // an append can advance the journal while recovery restores an older cursor.
      const work=tail.then(async()=>{
        const retained=await readHistory(now);
        if(!retained)throw new UploadError(410,'Durable invocation state unavailable; outcome unknown');
        sequence=Number(retained.sequence);previous=retained;
        // Losing attachment or retained resources does not undo observed writes
        // or completed cleanup. Preserve each completed barrier independently.
        const event=retained.stage==='sandbox-lost'||retained.stage===stage?retained:await commit({...retained,stage,cleanup:retained.cleanup==='complete'?'complete':'unknown',outputComplete:retained.outputComplete===true});
        return {event:structuredClone(event),actions:['inspect','recover-partial-outputs','reauthorize','start-new-invocation'] as const};
      });
      tail=work.then(()=>{});void tail.catch(()=>{});return work;
    },
  };
}
