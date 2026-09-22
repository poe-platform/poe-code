/** Node server only. The operator must run this inside its qualified isolation
 * driver. Importing the portable SDK never imports or starts this launcher. */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { constants } from 'node:os';
import type { Readable, Writable } from 'node:stream';
import type { Outcome } from './wire.generated.js';
/** Independent directional pipe limits; retained native leases do not use them. */
export const maxNativeStreamChannels = 64;
export interface NativeProcessSpec {
  /** Trusted driver-supplied native leases; never populated from wire IDs. */
  stdio?:readonly ('pipe'|'ignore'|number)[];
  executable: string; args: readonly (readonly number[])[]; cwd: string;
  env: Readonly<Record<string, string>>; inputChannels: readonly number[];
  outputChannels: readonly number[]; maxFrameBytes: number;
  /** Includes one native NUL terminator per token. */
  maxArgvBytes?: number;
}
export interface ProcessStreams {
  output(channelId: number, bytes: Uint8Array): Promise<void>;
  end(channelId: number): Promise<void>;
}
/** Transport reader retirement, not a failed canonical delivery receipt.
 * Only the owning transport may issue this observation; ordinary EPIPE errors
 * from admitted delivery operations must still fail settlement. */
export class NativeOutputRetired extends Error {
  constructor(cause: unknown) { super('Native output reader retired', { cause }); }
}
export interface NativeProcess {
  readonly exit: Promise<Outcome>;
  /** Native close plus admitted input receipts and output delivery, distinct from exit. */
  readonly settled: Promise<void>;
  write(channelId: number, bytes: Uint8Array): Promise<void>;
  end(channelId: number): Promise<void>;
  signal(signal: string): void;
  /** Release the transport-owned writer; this is distinct from orderly EOF. */
  closeInput?(channelId: number): void;
  closeOutput?(channelId: number): void;
  /** Qualified isolation owns the process-group identity through retirement. */
  terminateGroup?(): Promise<void>;
}
export interface NativeLauncher {
  /** Server-owned, build-bound launcher qualification. Omission selects Node's
   * lossless UTF-8 profile; a backend cannot advertise raw argv on its behalf. */
  readonly argvProfile?: {readonly kind:'bytes';readonly revision:string;readonly evidence:readonly string[];readonly maxArgvBytes?:number;readonly maxDescriptors?:number};
  launch(spec: NativeProcessSpec, streams: ProcessStreams): NativeProcess;
}
function outputFailures(results: readonly PromiseSettledResult<void>[]): void {
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Native output settlement failed');
}
function text(value: string) {
  if (typeof value !== 'string' || value.includes('\0') || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value) throw new TypeError('Native text is unrepresentable');
}
/** Retain and validate the exact environment passed to the native process API.
 * Call before namespace acquisition as well as at the final launch boundary. */
export function nativeEnvironment(env: Readonly<Record<string, string>>): Record<string, string> {
  if (!env || typeof env !== 'object' || Array.isArray(env)
    || Object.getPrototypeOf(env) !== Object.prototype && Object.getPrototypeOf(env) !== null) throw new TypeError('Invalid native environment');
  const admitted = { ...env };
  for (const [key, value] of Object.entries(admitted)) {
    text(key); text(value);
    if (!key || key.includes('=')) throw new TypeError('Invalid native env key');
  }
  return admitted;
}
/** Snapshot the admitted octets once; decoding must not become the source of
 * native argv identity, and callers must not reread accessor-backed carriers. */
export function nativeArgumentOctets(args: NativeProcessSpec['args'], maxArgvBytes = 1048576): number[][] {
  if (!Number.isSafeInteger(maxArgvBytes) || maxArgvBytes < 0) throw new TypeError('Invalid native argv bound');
  if (!Array.isArray(args)) throw new TypeError('Invalid native argv');
  if (args.length > maxArgvBytes) throw new TypeError('Native argv byte bound');
  const tokens = Array.from({ length: args.length }, (_, index) => {
    if (!Object.hasOwn(args, index)) throw new TypeError('Invalid native argv');
    const arg = args[index];
    if (!Array.isArray(arg)) throw new TypeError('Invalid native argv');
    return { arg, length: arg.length };
  });
  let remaining = maxArgvBytes;
  // Complete size admission precedes octet iteration, typed-array allocation and
  // decoding, including when a later token alone exceeds the remaining budget.
  for (const { length } of tokens) {
    if (length >= remaining) throw new TypeError('Native argv byte bound');
    remaining -= length + 1;
  }
  return tokens.map(({ arg, length }) => {
    const octets = Array.from({ length }, (_, index) => {
      if (!Object.hasOwn(arg, index)) throw new TypeError('Invalid native argv octets');
      return arg[index];
    });
    if (octets.some(n => !Number.isInteger(n) || n < 1 || n > 255)) throw new TypeError('Invalid native argv octets');
    return octets;
  });
}
export function nativeArgumentText(args: NativeProcessSpec['args'], maxArgvBytes = 1048576) {
  return nativeArgumentOctets(args, maxArgvBytes).map(octets => {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(octets)); }
    catch { throw new TypeError('Native argv octets are unrepresentable by the Node process API'); }
  });
}
/** Dependencies are injectable only for in-memory process-event tests. Defaults
 * use a real argv process API, an isolated POSIX group and no inherited env. */
export function createNativeLauncher(dependencies: {
  spawn?: (executable: string, args: string[], options: SpawnOptions) => ChildProcess;
  /** A real byte process API supplies a distinct launch-error observation. */
  spawnOctets?: (executable:string,args:number[][],options:SpawnOptions)=>{child:ChildProcess;launchOutcome:Promise<Outcome|undefined>};
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  groupAlive?: (pid:number) => boolean;
  terminationTimeoutMs?: number;
  maxDescriptors?:number;
  maxArgvBytes?:number;
} = {}): NativeLauncher {
  // Node permission mode injects ambient permission flags into NODE_OPTIONS,
  // even with an explicit environment. Refuse this unqualified launch profile.
  if (process.permission !== undefined) throw new TypeError('Node permission mode cannot preserve the exact native environment');
  const spawn = dependencies.spawn ?? nodeSpawn;
  const spawnOctets=dependencies.spawnOctets;
  const killGroup = dependencies.killGroup ?? ((pid, signal) => { process.kill(-pid, signal); });
  const groupAlive=dependencies.groupAlive??((pid:number)=>{try{process.kill(-pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;if((error as NodeJS.ErrnoException).code==='EPERM')return true;throw error;}});
  const terminationTimeoutMs=dependencies.terminationTimeoutMs??1000;
  if(!Number.isSafeInteger(terminationTimeoutMs)||terminationTimeoutMs<1||terminationTimeoutMs>2147483647)throw new TypeError('Invalid termination bound');
  const maxDescriptors=dependencies.maxDescriptors??1024;
  const maxArgvBytes=dependencies.maxArgvBytes;
  if(!Number.isSafeInteger(maxDescriptors)||maxDescriptors<3||maxDescriptors>1024||maxArgvBytes!==undefined&&(!Number.isSafeInteger(maxArgvBytes)||maxArgvBytes<0))throw new TypeError('Invalid native process bound');
  return {
    launch(spec, streams) {
      // Read each supplied carrier once. Accessor-backed input must not change
      // executable, cwd or environment between admission and the process API.
      spec = { executable: spec.executable, args: spec.args, cwd: spec.cwd,
        env: spec.env, inputChannels: spec.inputChannels, outputChannels: spec.outputChannels,
        stdio: spec.stdio, maxFrameBytes: spec.maxFrameBytes, maxArgvBytes: spec.maxArgvBytes };
      // Reject capacity before iteration or retained copies of descriptor lists.
      if (!Array.isArray(spec.inputChannels) || !Array.isArray(spec.outputChannels)
        || spec.inputChannels.length > maxNativeStreamChannels || spec.outputChannels.length > maxNativeStreamChannels
        || spec.stdio !== undefined && (!Array.isArray(spec.stdio) || spec.stdio.length < 3 || spec.stdio.length > maxDescriptors)) throw new TypeError('Invalid native descriptors');
      // Snapshot own entries before validation. Re-reading accessors can widen
      // channel authority between the check, pipe allocation and later writes.
      spec.inputChannels = Array.from({ length: spec.inputChannels.length }, (_, index) => {
        if (!Object.hasOwn(spec.inputChannels, index)) throw new TypeError('Invalid native descriptors');
        return spec.inputChannels[index];
      });
      spec.outputChannels = Array.from({ length: spec.outputChannels.length }, (_, index) => {
        if (!Object.hasOwn(spec.outputChannels, index)) throw new TypeError('Invalid native descriptors');
        return spec.outputChannels[index];
      });
      if (spec.stdio !== undefined) {
        const supplied = spec.stdio;
        spec.stdio = Array.from({ length: supplied.length }, (_, index) => {
          if (!Object.hasOwn(supplied, index)) throw new TypeError('Invalid native descriptors');
          return supplied[index];
        });
      }
      spec.env = nativeEnvironment(spec.env);
      const requestedArgvBytes=spec.maxArgvBytes??1048576;
      if(!Number.isSafeInteger(requestedArgvBytes)||requestedArgvBytes<0)throw new TypeError('Invalid native argv bound');
      const argvBudget=maxArgvBytes===undefined?requestedArgvBytes:Math.min(requestedArgvBytes,maxArgvBytes);
      const args = spawnOctets?nativeArgumentOctets(spec.args,argvBudget):undefined;
      const argvText=spawnOctets?undefined:nativeArgumentText(spec.args,argvBudget);
      text(spec.executable); text(spec.cwd);
      if (!spec.executable.startsWith('/') || !spec.cwd.startsWith('/')) throw new TypeError('Native executable/cwd must be absolute');
      if (!Number.isSafeInteger(spec.maxFrameBytes) || spec.maxFrameBytes < 1 || spec.maxFrameBytes > 1048576) throw new TypeError('Invalid native frame bound');
      const channels = [...spec.inputChannels, ...spec.outputChannels];
      if (channels.some(c => !Number.isInteger(c) || c < 1 || c > maxDescriptors) || new Set(spec.inputChannels).size !== spec.inputChannels.length || new Set(spec.outputChannels).size !== spec.outputChannels.length) throw new TypeError('Invalid native descriptors');
      if (spec.inputChannels.some(c => c === 2 || c === 3) || spec.outputChannels.includes(1)) throw new TypeError('Invalid native standard stream direction');
      const stdio: ('pipe' | 'ignore'|number)[] = spec.stdio?[...spec.stdio]:Array.from({ length: Math.max(3, ...channels) }, (_, i) => channels.includes(i + 1) ? 'pipe' : 'ignore');
      if(stdio.length<3||stdio.length>1024||stdio.some(fd=>fd!=='pipe'&&fd!=='ignore'&&(!Number.isInteger(fd)||fd<0||fd>2147483647)))throw new TypeError('Invalid native stdio leases');
      if(channels.some(channel=>stdio[channel-1]!=='pipe'))throw new TypeError('A streamed channel must map to a native pipe');
      if(stdio.some((slot,fd)=>slot==='pipe'&&!channels.includes(fd+1)))throw new TypeError('A native pipe must have an admitted channel owner');
      // Async pumps and input operations retain the validated authority, never
      // caller-owned channel lists or a subsequently enlarged frame budget.
      spec = { ...spec, inputChannels: [...spec.inputChannels], outputChannels: [...spec.outputChannels] };
      let resolveExit!: (outcome: Outcome) => void; const exit = new Promise<Outcome>(resolve => { resolveExit = resolve; });
      let resolveClose!: () => void; const closed = new Promise<void>(resolve => { resolveClose = resolve; });
      let observed = false; let groupClosed = false; let nativeClosed = false; let child: ChildProcess;
      const inputOperations = new Set<Promise<void>>();
      const observe = (outcome: Outcome) => { if (!observed) { observed = true; resolveExit(outcome); } };
      const spawnError = (error: unknown): Outcome => ({ kind: 'spawnError', code: typeof (error as NodeJS.ErrnoException)?.code === 'string' ? (error as NodeJS.ErrnoException).code! : 'UNKNOWN', stage: 'spawn', message: 'Native process could not be started' });
      let launchOutcome:Promise<Outcome|undefined>|undefined;
      try {
        // Node spawn deliberately enumerates inherited environment properties.
        // It also copies ambient NODE_V8_COVERAGE unless the supplied map owns
        // that key. A non-enumerable guard preserves its absence in native env.
        const env: Record<string, string> = Object.assign(Object.create(null), spec.env);
        if (!Object.hasOwn(env, 'NODE_V8_COVERAGE')) Object.defineProperty(env, 'NODE_V8_COVERAGE', { value: undefined });
        const options={cwd:spec.cwd,env,shell:false,detached:true,stdio};
        if(spawnOctets){const launched=spawnOctets(spec.executable,args!,options);child=launched.child;launchOutcome=launched.launchOutcome;void launchOutcome.catch(()=>{});}
        else child=spawn(spec.executable,argvText!,options);
      }
      catch (error) {
        observe(spawnError(error)); resolveClose();
        // Failed acquisition still owns each admitted EOF. One failed lane
        // must not abandon a sibling's receipt or escape the lifecycle API.
        const settled = (async () => {
          const results = await Promise.allSettled(spec.outputChannels.map(c => Promise.resolve().then(() => streams.end(c))));
          outputFailures(results);
        })();
        void settled.catch(() => {});
        return { exit, settled, async write() { throw new Error('Process not started'); }, async end() {}, signal() {} };
      }
      child.once('error', error => { observe(spawnError(error)); });
      let exitObservation:Promise<void>|undefined;
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        const nativeExit=()=>{
        if (code !== null && Number.isInteger(code) && code >= 0 && code <= 255) observe({ kind: 'exited', exitCode: code });
        else if (signal) observe({ kind: 'signaled', signal, signalNumber: constants.signals[signal] });
        else observe({ kind: 'unknown', reason: 'Missing native exit observation' });
        };
        if(launchOutcome)exitObservation=launchOutcome.then(outcome=>{if(outcome)observe(outcome);else nativeExit();},()=>{observe({kind:'unknown',reason:'Native launch diagnostic unavailable'});});
        else nativeExit();
      });
      child.once('close', () => {
        nativeClosed=true;
        const complete=()=>{if(!observed)observe({kind:'unknown',reason:'Closed without native exit observation'});resolveClose();};
        if(exitObservation)void exitObservation.then(complete);else complete();
      });
      const closedOutputs = new Set<number>();
      const pumps = spec.outputChannels.map(async channel => {
        const stream = child.stdio[channel - 1] as Readable | null;
        const failures: PromiseSettledResult<void>[] = [];
        try {
          if (stream) pumping: for await (const chunk of stream) {
            const bytes = chunk as Uint8Array;
            for (let offset = 0; offset < bytes.length; offset += spec.maxFrameBytes) {
              // Closing the reader may race an accepted frame's receipt. Drain
              // that receipt, then stop admission even within this native chunk.
              if (closedOutputs.has(channel)) break;
              try { await streams.output(channel, new Uint8Array(bytes.subarray(offset, offset + spec.maxFrameBytes))); }
              catch (cause) {
                if (closedOutputs.has(channel) && cause instanceof NativeOutputRetired) break pumping;
                // Retirement may discard unread bytes, never an admitted frame's
                // failed receipt. Only reader errors caused by close are ignored.
                failures.push({ status: 'rejected', reason: cause });
                break pumping;
              }
            }
          }
        } catch (cause) {
          if (!closedOutputs.has(channel)) failures.push({ status: 'rejected', reason: cause });
        }
        try { await streams.end(channel); }
        catch (cause) {
          if (!closedOutputs.has(channel) || !(cause instanceof NativeOutputRetired)) failures.push({ status: 'rejected', reason: cause });
        }
        outputFailures(failures);
      });
      // Observe pump rejections immediately, but wait for every sibling and close.
      const outputs = Promise.allSettled(pumps);
      const settled = (async () => {
        const results = await outputs;
        await closed;
        // Close stops new input admission. Failed writes retain their own error;
        // draining them must not turn EPIPE into a sibling-output failure.
        await Promise.allSettled(inputOperations);
        const diagnostics=await Promise.allSettled(launchOutcome?[launchOutcome.then(()=>{})]:[]);
        outputFailures([...results,...diagnostics]);
      })();
      void settled.catch(() => {});
      const inputErrors=new Map<number,unknown>();
      for(const channel of spec.inputChannels)child.stdio[channel-1]?.on('error',cause=>{inputErrors.set(channel,cause);});
      const ended = new Set<number>();
      function input(channel: number): Writable {
        if (nativeClosed) throw Object.assign(new Error('Native input closed'), { code: 'EPIPE' });
        if(inputErrors.has(channel))throw inputErrors.get(channel);
        if (!spec.inputChannels.includes(channel)) throw new TypeError('Input channel is not admitted');
        if (ended.has(channel)) throw Object.assign(new Error('Native input ended'), { code: 'EPIPE' });
        const stream = child.stdio[channel - 1] as Writable | null;
        if (!stream || stream.destroyed) throw Object.assign(new Error('Native input unavailable'), { code: 'EPIPE' });
        return stream;
      }
      function inputOperation(stream:Writable,start:(done:(error?:Error|null)=>void)=>void):Promise<void> {
        const operation = new Promise<void>((resolve,reject)=>{
          let finished=false;
          const done=(error?:Error|null)=>{
            if(finished)return;finished=true;
            stream.removeListener('error',done);stream.removeListener('close',closed);
            if(error)reject(error);else resolve();
          };
          const closed=()=>done(Object.assign(new Error('Native input closed'),{code:'EPIPE'}));
          stream.once('error',done);stream.once('close',closed);
          try{start(done);}catch(cause){finished=true;stream.removeListener('error',done);stream.removeListener('close',closed);reject(cause);}
        });
        inputOperations.add(operation);
        void operation.then(() => inputOperations.delete(operation), () => inputOperations.delete(operation));
        return operation;
      }
      let terminating:Promise<void>|undefined;
      return { exit, settled,
        closeInput(channel){
          if(!spec.inputChannels.includes(channel))throw new TypeError('Input channel is not admitted');
          (child.stdio[channel-1] as Writable|null)?.destroy(Object.assign(new Error('Native input retired'),{code:'EPIPE'}));
        },
        terminateGroup(){
          terminating??=(async()=>{
            if(child.pid===undefined)return;
            const deadline=Date.now()+terminationTimeoutMs;
            if(!groupAlive(child.pid)){groupClosed=true;return;}
            let denial:unknown;
            try{killGroup(child.pid,'SIGKILL');}catch(error){
              if((error as NodeJS.ErrnoException).code==='EPERM')denial=error;
              else if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;
            }
            while(groupAlive(child.pid)){
              if(Date.now()>=deadline)throw Object.assign(new Error('Process-group termination could not be confirmed',{cause:denial}),{category:'transport',code:'termination-unconfirmed'});
              await new Promise<void>(resolve=>setTimeout(resolve,Math.min(10,deadline-Date.now())));
            }
            groupClosed=true;
          })();return terminating;
        },
        closeOutput(channel) {
          if (!spec.outputChannels.includes(channel)) throw new TypeError('Output channel is not admitted');
          closedOutputs.add(channel);
          (child.stdio[channel - 1] as Readable | null)?.destroy();
        },
        async write(channel, bytes) {
          if (!(bytes instanceof Uint8Array)) throw new TypeError('Native input bytes required');
          // A caller can shadow length/byteLength or conversion methods. Admit
          // the real typed-array span before allocating an owned native write.
          const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(bytes) as number;
          if (length > spec.maxFrameBytes) throw new TypeError('Input frame length exceeds admission');
          const stream = input(channel);
          const owned = new Uint8Array(length);
          Uint8Array.prototype.set.call(owned, bytes);
          await inputOperation(stream,done=>{stream.write(owned,done);});
        },
        async end(channel) {
          const stream = input(channel); ended.add(channel);
          await inputOperation(stream,done=>{stream.end(done);});
        },
        signal(signal) {
          if (!Object.hasOwn(constants.signals, signal)) throw new TypeError('Unknown native signal');
          if (!groupClosed && child.pid !== undefined) {
            try { killGroup(child.pid, signal as NodeJS.Signals); }
            catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') throw error; }
          }
        },
      };
    },
  };
}
