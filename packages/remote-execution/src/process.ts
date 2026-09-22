import { readBytes, type ByteSource, type FileStat } from '@poe-code/safe-fs/core';
import { decodeFrames, encodeFrame } from './binary.js';
import type { Outcome } from './wire.generated.js';
import type { ExactFileSeekHandle } from '@poe-code/safe-fs/contracts/object';

interface Sink {
  write(bytes: Uint8Array): Promise<void>;
  ownedOutput?: { consumerClosed: AbortSignal; write(bytes: Uint8Array): Promise<void> };
}
export interface ProcessContext {
  onInternalError?: ((error: unknown) => void | Promise<void>) | undefined;
  processSignals?: {
    subscribe(accept: (event: { readonly name: string; readonly number: number; readonly target: 'process-group'; readonly sequence: bigint }) => Promise<{ readonly sequence: bigint }>): () => void | Promise<void>;
  } | undefined;
  stdin: ByteSource;
  stdinInput?: { readonly stat?:FileStat; readonly position: number; read(maxBytes: number, signal: AbortSignal): Promise<IteratorResult<Uint8Array>>; seek?(position: number, signal: AbortSignal): Promise<void> };
  stdout: Sink; stderr: Sink; signal: AbortSignal;
  registerCleanup?(cleanup: () => Promise<void>): void;
  admittedHandles?: {
    acquire(fd:number,rights:readonly ('read'|'write'|'seek'|'stat')[],signal:AbortSignal):Promise<{
      readonly identity?: object;
      readonly position?: number;
      readonly consumerClosed?: AbortSignal;
      read?(count:number,signal:AbortSignal):Promise<IteratorResult<Uint8Array>>;
      write?(bytes:Uint8Array,signal:AbortSignal):Promise<number>;
      seek?(position:number,signal:AbortSignal):Promise<void>;
      readonly exact?: ExactFileSeekHandle;
      stat?(signal:AbortSignal):Promise<FileStat>;
      close():Promise<void>;
    }>;
  } | undefined;
}
/** Authenticated, job-owned binary lanes. Each output lane has its own contiguous
 * sequence and credit window, so a stalled stdout cannot consume stderr credit.
 * send resolves only after a native write completes; ack returns output credit
 * only after the canonical sink completes. Neither network buffering nor a
 * WebSocket send is an acknowledgement. close stops/reaps the process group,
 * resolves admitted effects and drains owned transport work, or rejects with a
 * recovery error when remote termination cannot be confirmed. */
export interface ProcessConnection {
  readonly stdinKind: 'pipe' | 'descriptor';
  readonly maxFrameBytes: number;
  readonly outputs: ReadonlyMap<number, ReadableStream<Uint8Array>>;
  readonly inputChannels?: readonly number[];
  readonly outcome: Promise<Outcome>;
  send(channel: number, frame: Uint8Array, expectedOffset: bigint, signal: AbortSignal): Promise<bigint>;
  ack(channel: number, sequence: bigint, offset: bigint): Promise<void>;
  closeOutput(channel: number, cause: unknown): Promise<void>;
  signal?(name:string, number?:number, target?:'process-group'):void | Promise<void>;
  close(): Promise<void>;
}

/** Portable structural CommandContext adapter. The connector receives the
 * original scoped context, including stdinInput and any admitted handles; it
 * must install seekable native descriptors rather than staging pipe contents. */
export async function executeRemoteProcess<Context extends ProcessContext>(
  context: Context,
  connect: (context: Context, signal: AbortSignal) => Promise<ProcessConnection>,
  signalStatus?: (signal: string, number: number) => number,
): Promise<{ exitCode: number }> {
  const controller = new AbortController();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  const inputController = new AbortController();
  const inputSignal = AbortSignal.any([signal, inputController.signal]);
  let connection: ProcessConnection | undefined;
  let acquisition: Promise<ProcessConnection> | undefined;
  let closing: Promise<void> | undefined;
  let finalizing = false;
  let observationFailure: {cause:unknown} | undefined;
  let unsubscribeSignals: (() => void | Promise<void>) | undefined;
  const signalWork = new Set<Promise<unknown>>();
  let rejectSignal!: (cause: unknown) => void;
  const signalFailure = new Promise<never>((_resolve, reject) => { rejectSignal = reject; });
  void signalFailure.catch(() => {});
  const writes = new Set<Promise<void>>();
  const acknowledgements = new Set<Promise<void>>();
  const failedAcknowledgements = new Set<unknown>();
  const inputWork = new Set<Promise<void>>();
  const inputCleanup = new Set<Promise<unknown>>();
  const leases = new Set<{close():Promise<void>}>();
  const descriptorAcquisitions = new Set<Promise<unknown>>();
  const outputClosures = new Map<number,Promise<void>>();
  const destinationPipeClosures = new Set<unknown>();
  function stopOutput(channel:number,cause:unknown):Promise<void> {
    const existing=outputClosures.get(channel);if(existing)return existing;
    if(finalizing)return Promise.resolve();
    const operation=Promise.resolve().then(()=>connection!.closeOutput(channel,cause));
    outputClosures.set(channel,operation);void operation.catch(()=>{});return operation;
  }
  const close = (): Promise<void> => {
    finalizing = true;
    controller.abort(new Error('Remote invocation finalized'));
    closing ??= (async () => {
      const acquired = connection ?? await acquisition?.catch(() => undefined);
      // Delivery includes returning credit for effects the canonical sink accepted.
      // Retiring the transport first would erase that acknowledgement on cancel.
      const delivered = await Promise.allSettled([...writes, ...acknowledgements]);
      // A borrowed subscribe can synchronously cancel before returning its
      // acquired cleanup. Close admission immediately, then capture that
      // cleanup after the current acquisition stack has unwound.
      const unsubscribe = unsubscribeSignals;
      unsubscribeSignals = undefined;
      const results = await Promise.allSettled([
        ...(acquired ? [Promise.resolve().then(() => acquired.close())] : []),
        Promise.resolve().then(() => unsubscribe?.()),
        ...signalWork,
        ...outputClosures.values(),
      ]);
      results.push(...delivered);
      // Retire transport writers first to unblock pending native credits, then
      // drain borrowed reads and their iterator finalizers before lease release.
      await Promise.allSettled([...inputWork]);
      results.push(...await Promise.allSettled([...inputCleanup]));
      await Promise.allSettled([...descriptorAcquisitions]);
      // A synchronous release failure must not skip or abandon sibling drains.
      results.push(...await Promise.allSettled([...leases].map(lease=>Promise.resolve().then(()=>lease.close()))));
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length === 1) throw failures[0]!.reason;
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Remote process cleanup failed');
    })();
    void closing.catch(() => {});
    return closing;
  };
  context.registerCleanup?.(close);
  const cancel = () => { void close().catch(() => {}); };
  context.signal.addEventListener('abort',cancel,{once:true});
  let failure: { cause: unknown } | undefined;
  let result: { exitCode: number } | undefined;
  try {
    result = await (async () => {
    signal.throwIfAborted();
    acquisition = Promise.resolve().then(() => { signal.throwIfAborted(); return connect(context, signal); });
    connection = await acquisition;
    signal.throwIfAborted();
    const remote = connection;
    // Observe failure before descriptor acquisition can block. A failed remote
    // job retires that admission through the invocation signal; normal native
    // exit still leaves input acceptance and output delivery to their barriers.
    const nativeOutcome = remote.outcome.then((outcome): Outcome => {
      // An unknown or failed launch cannot leave idle lanes holding execution
      // open. Keep the remote observation for recovery instead of inventing a
      // numeric native status, then drain the same owned cleanup barrier.
      // Validate and retain the observation before waiting on independent lanes
      // or descriptor acquisition. A malformed terminal status must retire idle
      // work, and borrowed accessors cannot replace a native status during drain.
      const kind = outcome.kind;
      if (kind === 'exited') {
        const exitCode = outcome.exitCode;
        if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new TypeError('Invalid native exit status');
        return {kind,exitCode};
      }
      if (kind === 'signaled') {
        const {signal: name,signalNumber} = outcome;
        if (typeof name !== 'string' || !name || name.includes('\0')
          || !Number.isSafeInteger(signalNumber) || signalNumber < 1 || signalNumber > 255) throw new TypeError('Invalid native signal observation');
        return {kind,signal:name,signalNumber};
      }
      throw Object.assign(new Error('Remote process did not produce a qualified shell exit status'),{outcome});
    }).catch(cause => {
      if (!finalizing) observationFailure ??= {cause};
      inputController.abort(cause);
      void close().catch(() => {});
      throw cause;
    });
    void nativeOutcome.catch(() => {});
    // Negotiated credit is invocation authority. Retain it once so connector
    // mutation cannot widen reads, change chunk strides or stall an upload.
    const maxFrameBytes = remote.maxFrameBytes;
    const stdinKind = remote.stdinKind;
    const suppliedOutputs = remote.outputs;
    const suppliedChannels = remote.inputChannels ?? (stdinKind === 'pipe' ? [1] : []);
    if (!Array.isArray(suppliedChannels) || suppliedChannels.length > 64) throw new TypeError('Invalid native input channels');
    const channels = Array.from({length:suppliedChannels.length},(_,index)=>{
      if (!Object.hasOwn(suppliedChannels,index)) throw new TypeError('Invalid native input channels');
      return suppliedChannels[index]!;
    });
    if (suppliedOutputs.size > 64) throw new TypeError('Invalid process lane admission');
    // Retain lane identity before awaiting descriptor leases. The connector's
    // mutable maps and arrays cannot replace streams or widen acquired rights.
    const outputs = new Map(suppliedOutputs);
    async function acknowledge(channel: number, sequence: bigint, offset: bigint) {
      const operation = Promise.resolve().then(() => remote.ack(channel, sequence, offset));
      acknowledgements.add(operation);
      try { await operation; }
      catch (cause) { failedAcknowledgements.add(cause); throw cause; }
      finally { acknowledgements.delete(operation); }
    }
    if ((stdinKind !== 'pipe' && stdinKind !== 'descriptor')
      || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > 1048576
      || !outputs.has(2) || !outputs.has(3) || outputs.size > 64
      || [...outputs.keys()].some(id=>!Number.isSafeInteger(id)||id<2||id>1024)) throw new TypeError('Invalid process lane admission');
    const stdinInput = context.stdinInput;
    if (stdinInput?.seek && stdinKind !== 'descriptor') throw new TypeError('Native seekable stdin descriptor is required');
    if(channels.includes(1)!==(stdinKind==='pipe')||new Set(channels).size!==channels.length||channels.some(id=>!Number.isSafeInteger(id)||id<1||id===2||id===3||id>1024))throw new TypeError('Invalid native input channels');
    const readInput = stdinKind === 'pipe' ? stdinInput?.read.bind(stdinInput) : undefined;
    const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
    async function* readProcessInput(read: (count: number, signal: AbortSignal) => Promise<IteratorResult<Uint8Array>>, description: string) {
      for (;;) {
        const count = Math.min(maxFrameBytes,65536);
        const result = await read(count,inputSignal);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Invalid process input read result');
        // Observe EOF once. Truthy malformed values must not truncate input or
        // obtain an END receipt; an empty byte fragment remains ordinary data.
        const done = result.done;
        if (done === true) return;
        if (done !== false && done !== undefined) throw new TypeError('Invalid process input read result');
        const bytes = result.value;
        if (!(bytes instanceof Uint8Array) || byteLength.call(bytes) > count) throw new TypeError(`Invalid ${description} read size`);
        yield bytes;
      }
    }
    const stdin: ByteSource = readInput ? {[Symbol.asyncIterator]: () => readProcessInput(readInput,'stdinInput')} : context.stdin;
    const inputs=new Map<number,ByteSource>(stdinKind==='pipe'?[[1,stdin]]:[]);
    const sinks=new Map<number,Sink>([[2,context.stdout],[3,context.stderr]]);
    const descriptorSinks = new Set<Sink>();
    for(const channel of new Set([...channels,...outputs.keys()])) {
      if(channel<4)continue;
      if(!context.admittedHandles)throw new TypeError('Shell descriptor admission is required');
      const rights:('read'|'write')[]=[];if(channels.includes(channel))rights.push('read');if(outputs.has(channel))rights.push('write');
      signal.throwIfAborted();
      const admission=Promise.resolve().then(()=>{
        signal.throwIfAborted();
        return context.admittedHandles!.acquire(channel-1,rights,signal);
      }).then(lease=>{
        // Enroll release before inspecting the remaining acquired capability.
        // Retain operations once with their original receiver: partial writes
        // and finalization must not reread a mutable provider's lease methods.
        const close = lease.close.bind(lease);
        leases.add({close});
        return {
          close,
          consumerClosed: lease.consumerClosed,
          read: rights.includes('read') ? lease.read?.bind(lease) : undefined,
          write: rights.includes('write') ? lease.write?.bind(lease) : undefined,
        };
      });
      descriptorAcquisitions.add(admission);
      let lease: Awaited<typeof admission>;
      try {lease=await admission;}finally{descriptorAcquisitions.delete(admission);}
      signal.throwIfAborted();
      if(rights.includes('read')&&!lease.read||rights.includes('write')&&!lease.write)throw new TypeError('Descriptor lease is missing admitted operations');
      if(rights.includes('read'))inputs.set(channel,{[Symbol.asyncIterator]: () => readProcessInput(lease.read!,'descriptor')});
      if(rights.includes('write')) {
        const sink: Sink = {async write(bytes){
        let offset=0;
        while(offset<bytes.length){
          // A short-write receipt settles only this prefix. Retain it, but do
          // not admit another effect after invocation or destination closure.
          signal.throwIfAborted();
          lease.consumerClosed?.throwIfAborted();
          const count=await lease.write!(bytes.subarray(offset,Math.min(bytes.length,offset+65536)),signal);
          if(!Number.isSafeInteger(count)||count<1||count>Math.min(bytes.length-offset,65536))throw new TypeError('Invalid descriptor partial write');
          offset+=count;
        }
        }};
        if (lease.consumerClosed) sink.ownedOutput = { consumerClosed: lease.consumerClosed, write: sink.write };
        sinks.set(channel, sink);
        descriptorSinks.add(sink);
      }
    }
    let lastSignal = 0n;
    const processSignals = context.processSignals;
    signal.throwIfAborted();
    if (processSignals) {
      unsubscribeSignals = processSignals.subscribe(event => {
        const operation = (async () => {
          signal.throwIfAborted();
          const { sequence, name, number, target } = event;
          // Borrowed hosts may expose accessors. Validate, deliver and acknowledge
          // the same event, then recheck lifetime after inspecting host fields.
          signal.throwIfAborted();
          if (finalizing || typeof sequence !== 'bigint' || sequence <= lastSignal
            || typeof name !== 'string' || !name || name.includes('\0')
            || !Number.isSafeInteger(number) || number < 1 || number > 255
            || target !== 'process-group') throw new TypeError('Invalid ordered process signal');
          lastSignal = sequence;
          if (!remote.signal) throw new TypeError('Native process signals are not admitted');
          await remote.signal(name, number, target);
          return { sequence };
        })();
        signalWork.add(operation);
        void operation.then(() => signalWork.delete(operation), cause => {
          // Record the native rejection before cleanup aborts blocked lanes.
          // The outcome observer runs later and must not replace it with the
          // local retirement reason, including when the rejection is falsey.
          if (!finalizing) observationFailure ??= {cause};
          signalWork.delete(operation); rejectSignal(cause); void close().catch(() => {});
        });
        return operation;
      });
      signal.throwIfAborted();
    }
    const limits = { maxFrameBytes, maxControlBytes: maxFrameBytes, channels };
    let executionFailure: {cause:unknown} | undefined;
    function failExecution(cause:unknown) {
      if (!finalizing) executionFailure ??= {cause};
      void close().catch(() => {});
    }
    const observed = Promise.race([nativeOutcome, signalFailure]).then(outcome => { inputController.abort(new Error('Native process exited')); return outcome; },cause=>{
      if(!finalizing)observationFailure??={cause};
      inputController.abort(cause);
      void close().catch(()=>{});
      throw cause;
    });
    void observed.catch(() => {});
    const inputTasks = [...inputs].map(([channel,source])=>(async () => {
      let sequence = 1n; let offset = 0n;
      const nativeInputClosed = {};
      let receiptFailed = false;
      async function send(kind: 'data' | 'end', payload: Uint8Array) {
        inputSignal.throwIfAborted();
        const expected = offset + BigInt(payload.length);
        const frame = encodeFrame({kind,channelId:channel,sequence,offset,correlationId:0n,payload},limits);
        let accepted: bigint;
        // Exit stops new stdin reads/admission, not a dispatched native write's
        // acceptance receipt. Caller cancellation still retires both scopes.
        try { accepted = await remote.send(channel,frame,expected,signal); }
        catch (cause) {
          // Only the native writer's EPIPE retires this input. A borrowed
          // source or iterator finalizer with the same errno still failed.
          if ((cause as {code?:string})?.code === 'EPIPE') throw nativeInputClosed;
          receiptFailed = true;
          throw cause;
        }
        if (accepted !== expected) throw new TypeError('Native input credit offset conflict');
        sequence++; offset = expected;
      }
      try {
        const iterator = source[Symbol.asyncIterator]();
        let returning: Promise<IteratorResult<Uint8Array>> | undefined;
        const ownedSource: ByteSource = { [Symbol.asyncIterator]() {
          return {
            next: iterator.next.bind(iterator),
            ...(iterator.return ? { return() {
              returning ??= Promise.resolve().then(() => iterator.return!());
              inputCleanup.add(returning);
              void returning.catch(() => {});
              return returning;
            } } : {}),
          };
        } };
        for await (const bytes of readBytes(ownedSource,inputSignal)) {
          // Fragment properties and methods are not stream authority. Slice
          // only the real typed-array span, retaining frame-sized credit even
          // when a borrowed producer shadows length or subarray.
          const length = byteLength.call(bytes) as number;
          for (let start = 0; start < length; start += maxFrameBytes) await send('data',Uint8Array.prototype.subarray.call(bytes,start,start+maxFrameBytes));
        }
        await send('end',new Uint8Array());
      } catch (cause) {
        // Exit retires a blocked read, but cannot settle an independently
        // failed native acceptance receipt. Preserve that uncertainty even
        // when the native process has already supplied an explicit status.
        if (!receiptFailed && inputController.signal.aborted && !signal.aborted && cause === inputController.signal.reason) return;
        if (cause === nativeInputClosed && !signal.aborted) return;
        failExecution(cause);
        throw cause;
      }
    })());
    for (const task of inputTasks) {
      inputWork.add(task);
      void task.then(() => inputWork.delete(task), () => inputWork.delete(task));
    }
    async function output(channel: number, sink: Sink) {
      let consumerClosed: AbortSignal | undefined;
      const sinkFailures = new Set<unknown>();
      let destinationClosed=false;
      const consumerClose=()=>{
        destinationClosed=true;
        void stopOutput(channel,consumerClosed!.reason).catch(failExecution);
      };
      try {
        // Capability inspection can fail before any frame is delivered. Enroll
        // those failures in invocation retirement too, so idle sibling lanes
        // cannot keep settlement waiting after destination admission fails.
        const capability = sink.ownedOutput;
        // Retain the admitted destination with its receiver, just as descriptor
        // leases retain their operations. Later frames cannot change enrollment
        // or substitute a different writer while an accepted effect is draining.
        const destination = capability ?? sink;
        const write = destination.write.bind(destination);
        consumerClosed = capability?.consumerClosed;
        const outputSignal = consumerClosed ? AbortSignal.any([signal, consumerClosed]) : signal;
        consumerClosed?.addEventListener('abort',consumerClose,{once:true});
        if(consumerClosed?.aborted){destinationClosed=true;await stopOutput(channel,consumerClosed.reason);throw consumerClosed.reason;}
        const source = outputs.get(channel)!;
        for await (const frame of decodeFrames(source,{...limits,channels:[channel],requireEnd:true},outputSignal)) {
          if(frame.correlationId!==0n)throw new TypeError('Unexpected process stream correlation');
          signal.throwIfAborted();
          if (finalizing) return;
          if (consumerClosed?.aborted) throw consumerClosed.reason;
          if (frame.kind === 'data') {
            const owned = capability !== undefined || descriptorSinks.has(sink);
            const pending = Promise.resolve().then(async () => {
              if (finalizing) throw signal.reason;
              if (destinationClosed) throw consumerClosed!.reason;
              try {await write(frame.payload);}
              catch(cause){sinkFailures.add(cause);if((cause as {code?:string})?.code==='EPIPE')destinationPipeClosures.add(cause);throw cause;}
              // Opaque destinations cannot enroll host work in our cleanup.
              // Observe their eventual receipt without admitting late credit
              // after cancellation has finalized the invocation.
              if (!owned) outputSignal.throwIfAborted();
              await acknowledge(channel,frame.sequence,frame.offset+BigInt(frame.payload.length));
            });
            // The invocation owns descriptor leases even when their destination
            // has no consumer-close notification. Drain accepted writes and
            // their credit before retiring that lease or the transport.
            if (owned) {
              writes.add(pending);
              try { await pending; } finally { writes.delete(pending); }
            } else {
              let abortWrite!: () => void;
              const canceled = new Promise<never>((_resolve,reject) => {
                abortWrite = () => reject(outputSignal.reason);
                outputSignal.addEventListener('abort',abortWrite,{once:true});
                if (outputSignal.aborted) abortWrite();
              });
              // Promise.race observes late rejection of opaque host work;
              // cancellation only retires our await, not the host operation.
              try { await Promise.race([pending,canceled]); }
              finally { outputSignal.removeEventListener('abort',abortWrite); }
            }
          } else {
          // Preserve delivery already acknowledged by the canonical destination,
          // even if cancellation arrived during that owned write.
          await acknowledge(channel,frame.sequence,frame.offset+BigInt(frame.payload.length));
          }
        }
      } catch (cause) {
        // Closure stops new delivery; it cannot replace the receipt of an
        // already admitted write or acknowledgement. Decoder cancellation
        // carries the consumer's own reason when no operation failed.
        const failure=cause;
        // EPIPE from a credit transport is delivery uncertainty, even when
        // the destination independently closed its pipe at the same time.
        if(failedAcknowledgements.has(failure)&&!finalizing)executionFailure??={cause:failure};
        // A lane read can fail independently while its consumer closes. Only
        // that destination's own closure reason (or a failed sink write above)
        // qualifies as a broken pipe; transport EPIPE remains uncertainty.
        if(destinationClosed&&failure===consumerClosed?.reason&&!failedAcknowledgements.has(failure)&&(failure as {code?:string})?.code==='EPIPE')destinationPipeClosures.add(failure);
        if (destinationClosed || sinkFailures.has(failure)) {
          if (!destinationPipeClosures.has(failure) && !finalizing) executionFailure ??= {cause:failure};
          try { await stopOutput(channel,failure); }
          catch(cause) { failExecution(cause); throw cause; }
        } else if (!finalizing) {
          failExecution(failure);
        } else {
          try { await stopOutput(channel,failure); }
          catch(cause) { failExecution(cause); throw cause; }
        }
        throw failure;
      } finally {consumerClosed?.removeEventListener('abort',consumerClose);}
    }
    const tasks = [...inputTasks,...[...sinks].map(([channel,sink])=>output(channel,sink))];
    const results = await Promise.allSettled(tasks);
    context.signal.throwIfAborted();
    if(observationFailure)throw observationFailure.cause;
    if(executionFailure)throw executionFailure.cause;
    for (const result of results) if (result.status === 'rejected'&&!destinationPipeClosures.has(result.reason)) throw result.reason;
    // END on every lane does not imply that native termination has been
    // observed. Cancellation must also retire this independent wait, without
    // inventing a native outcome or bypassing the owned cleanup barrier.
    let abortOutcome!: () => void;
    const canceledOutcome = new Promise<never>((_resolve,reject) => {
      abortOutcome = () => reject(signal.reason);
      signal.addEventListener('abort',abortOutcome,{once:true});
      if (signal.aborted) abortOutcome();
    });
    let outcome: Outcome;
    try { outcome = await Promise.race([observed,canceledOutcome]); }
    finally { signal.removeEventListener('abort',abortOutcome); }
    if (outcome.kind === 'exited') {
      return {exitCode:outcome.exitCode};
    }
    if (outcome.kind === 'signaled' && signalStatus) {
      const exitCode = signalStatus(outcome.signal,outcome.signalNumber);
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new TypeError('Invalid shell signal status');
      return {exitCode};
    }
    throw Object.assign(new Error('Remote process did not produce a qualified shell exit status'),{outcome});
    })();
  } catch (cause) {
    failure = {cause: observationFailure ? observationFailure.cause : cause};
  } finally {
    context.signal.removeEventListener('abort',cancel);
  }
  let cleanupFailure: {cause: unknown} | undefined;
  try { await close(); } catch (cause) { cleanupFailure = {cause}; }
  if (cleanupFailure && (context.signal.aborted || failure && context.onInternalError)) {
    // The shell owns primary-error precedence, but local retirement is not
    // proof of remote death. Keep the cleanup observation available to the host.
    try { await context.onInternalError?.(cleanupFailure.cause); }
    catch { /* A diagnostic hook cannot replace the primary shell failure. */ }
    context.signal.throwIfAborted();
    throw failure!.cause;
  }
  context.signal.throwIfAborted();
  if (failure && cleanupFailure) throw new AggregateError([failure.cause,cleanupFailure.cause],'Remote invocation and cleanup failed',{cause:failure.cause});
  if (failure) throw failure.cause;
  if (cleanupFailure) throw cleanupFailure.cause;
  return result!;
}
