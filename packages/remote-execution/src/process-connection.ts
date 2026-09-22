/** Node-only framed adapter for an already admitted isolated native invocation.
 * This is transport machinery, not an isolation driver or host fallback. */
import { constants } from 'node:os';
import { decodeFrames, encodeFrame } from './binary.js';
import { createNativeLauncher, NativeOutputRetired, type NativeLauncher, type NativeProcessSpec } from './native-process.js';
import type { ProcessConnection } from './process.js';

export function createProcessConnection(spec: NativeProcessSpec, launcher: NativeLauncher = createNativeLauncher()): ProcessConnection {
  spec = { ...spec };
  if (!Number.isSafeInteger(spec.maxFrameBytes) || spec.maxFrameBytes < 1 || spec.maxFrameBytes > 1048576) throw new TypeError('Invalid native frame bound');
  if (!Array.isArray(spec.inputChannels) || !Array.isArray(spec.outputChannels)
    || spec.inputChannels.length > 64 || spec.outputChannels.length > 64) throw new TypeError('Native descriptor admission exceeded');
  // Admit before copying. Transport authority outlives launch and must not alias
  // either its caller or an injected launcher's retained configuration.
  const inputChannels = spec.inputChannels;
  const outputChannels = spec.outputChannels;
  spec = { ...spec,
    inputChannels: Object.freeze(Array.from({length:inputChannels.length},(_,index)=>{
      if (!Object.hasOwn(inputChannels,index)) throw new TypeError('Invalid native lanes');
      return inputChannels[index]!;
    })),
    outputChannels: Object.freeze(Array.from({length:outputChannels.length},(_,index)=>{
      if (!Object.hasOwn(outputChannels,index)) throw new TypeError('Invalid native lanes');
      return outputChannels[index]!;
    })),
  };
  if (!spec.inputChannels.includes(1) && typeof spec.stdio?.[0] !== 'number') throw new TypeError('Native stdin descriptor was not installed');
  for (const channels of [spec.inputChannels, spec.outputChannels]) {
    if (new Set(channels).size !== channels.length
      || channels.some(channel => !Number.isSafeInteger(channel) || channel < 1 || channel > 1024)) throw new TypeError('Invalid native lanes');
  }
  if (spec.inputChannels.includes(2) || spec.inputChannels.includes(3)
    || spec.outputChannels.includes(1) || !spec.outputChannels.includes(2) || !spec.outputChannels.includes(3)) throw new TypeError('Invalid standard process lanes');
  const limits = {maxFrameBytes:spec.maxFrameBytes,maxControlBytes:spec.maxFrameBytes,channels:spec.inputChannels};
  const controllers = new Map<number,ReadableStreamDefaultController<Uint8Array>>();
  const sequences = new Map<number,bigint>(); const offsets = new Map<number,bigint>();
  const inputSequence = new Map<number,bigint>(); const inputOffsets = new Map<number,bigint>();
  const inputEnded = new Set<number>(); const inputBusy = new Set<number>();
  const inputFailures = new Map<number,unknown>();
  const inputWork = new Set<Promise<bigint>>();
  const stopped = new Set<number>();
  const outputEnded = new Set<number>();
  const credits = new Map<number,{sequence:bigint;offset:bigint;resolve():void;reject(cause:unknown):void}>();
  let closing: Promise<void> | undefined; let finalized = false;
  const inputRetired = new Error('Native input admission finalized');
  const outputs = new Map(spec.outputChannels.map(channel=>[channel,new ReadableStream<Uint8Array>({
    start(controller){controllers.set(channel,controller);},
    cancel(cause){
      retire(channel,cause ?? Object.assign(new Error('Native output consumer closed'),{code:'EPIPE'}));
      run.closeOutput?.(channel);
    },
  },{highWaterMark:0})]));
  async function emit(kind:'data'|'end',channel:number,payload:Uint8Array) {
    if (stopped.has(channel)) return;
    if (finalized) throw new Error('Native lane finalized');
    if (outputEnded.has(channel)) throw new TypeError('Native output channel ended');
    if (credits.has(channel)) throw new TypeError('Native output exceeded channel credit');
    const sequence=sequences.get(channel)??1n;const offset=offsets.get(channel)??0n;
    const wire=encodeFrame({kind,channelId:channel,sequence,offset,correlationId:0n,payload},{...limits,channels:[channel]});
    if (kind === 'end') outputEnded.add(channel);
    const delivered=new Promise<void>((resolve,reject)=>{credits.set(channel,{sequence,offset:offset+BigInt(payload.length),resolve,reject});});
    controllers.get(channel)!.enqueue(wire);
    await delivered; sequences.set(channel,sequence+1n);offsets.set(channel,offset+BigInt(payload.length));
    // Retirement can follow the acknowledged EOF before this pump resumes.
    // Its controller is already errored; the accepted receipt remains settled.
    if(kind==='end'&&!stopped.has(channel))controllers.get(channel)!.close();
  }
  const run=launcher.launch({...spec,inputChannels:[...spec.inputChannels],outputChannels:[...spec.outputChannels]},{output:(channel,payload)=>emit('data',channel,payload),end:channel=>emit('end',channel,new Uint8Array())});
  // A delegate can retain the pipes after the leader's exit. Retire the group
  // before waiting for EOF, while leaving buffered output and its credits alive.
  let leaderExited = false;
  const retirement=run.exit.then(()=>{leaderExited=true;return run.terminateGroup?.();});
  void retirement.catch(()=>{});
  const outcome=run.exit.then(async value=>{await retirement;return value;});
  void outcome.catch(()=>{});
  function retire(channel:number,cause:unknown) {
    if(stopped.has(channel))return;
    stopped.add(channel);credits.get(channel)?.reject(new NativeOutputRetired(cause));
    // Reader retirement stops native production, but a delivered frame may
    // still be inside an owned canonical write. Keep its bounded credit record
    // so that completion can acknowledge it before invocation finalization.
    try{controllers.get(channel)?.error(cause);}catch{/* Already ended. */}
  }
  return {stdinKind:spec.inputChannels.includes(1)?'pipe':'descriptor',inputChannels:spec.inputChannels,maxFrameBytes:spec.maxFrameBytes,outputs,outcome,
    async send(channel,wire,expectedOffset,signal){
      signal.throwIfAborted();
      if(inputFailures.has(channel))throw inputFailures.get(channel);
      if(finalized||inputBusy.has(channel)||inputEnded.has(channel)||!spec.inputChannels.includes(channel))throw new TypeError('Native input admission closed or busy');
      if(!(wire instanceof Uint8Array))throw new TypeError('Native input frame bytes required');
      // Typed-array instances may shadow their span properties. Admit the real
      // span before allocation and before any frame can cause a native effect.
      const prototype=Object.getPrototypeOf(Uint8Array.prototype);
      const length=Object.getOwnPropertyDescriptor(prototype,'byteLength')!.get!.call(wire) as number;
      if(length>40+spec.maxFrameBytes)throw new TypeError('Native input exceeds credit');
      const buffer=Object.getOwnPropertyDescriptor(prototype,'buffer')!.get!.call(wire) as ArrayBuffer;
      const byteOffset=Object.getOwnPropertyDescriptor(prototype,'byteOffset')!.get!.call(wire) as number;
      if(length<40||new DataView(buffer,byteOffset,length).getUint32(12)!==length-40)throw new TypeError('Native input requires exactly one complete frame');
      // Decode/accept is asynchronous; own this admitted bounded frame before
      // returning control to a producer that may reuse its backing buffer.
      const owned=new Uint8Array(length);
      Uint8Array.prototype.set.call(owned,wire);
      wire=owned;
      inputBusy.add(channel);
      const operation=(async()=>{
      try {
        const source=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(wire);controller.close();}});
        let count=0;
        for await(const frame of decodeFrames(source,{...limits,channels:[channel],firstSequence:inputSequence.get(channel)??1n,offsets:new Map([[channel,inputOffsets.get(channel)??0n]])})) {
          if(++count!==1||frame.kind==='control'||frame.correlationId!==0n||frame.offset+BigInt(frame.payload.length)!==expectedOffset)throw new TypeError('Native input credit mismatch');
          signal.throwIfAborted();
          // Frame decoding is asynchronous. Finalization may have closed input
          // admission since send enrolled this work; do not dispatch a new
          // native effect then. A write already dispatched below retains its
          // acceptance receipt and is drained by close.
          if(finalized)throw inputRetired;
          try {
            if(frame.kind==='end'){await run.end(channel);inputEnded.add(channel);}else await run.write(channel,frame.payload);
          } catch(cause) {
            // Native failure may follow partial acceptance. The old offset is
            // not authority to replay those bytes; only this input loses credit.
            inputFailures.set(channel,cause);
            throw cause;
          }
          inputSequence.set(channel,frame.sequence+1n);inputOffsets.set(channel,expectedOffset);
        }
        if(count!==1)throw new TypeError('Missing native input frame');
        return expectedOffset;
      } finally {inputBusy.delete(channel);}
      })();
      inputWork.add(operation);
      try{return await operation;}finally{inputWork.delete(operation);}
    },
    async ack(channel,sequence,offset){
      const credit=credits.get(channel);
      if(!credit||credit.sequence!==sequence||credit.offset!==offset)throw new TypeError('Native output credit mismatch');
      credits.delete(channel);credit.resolve();
    },
    async closeOutput(channel,cause){
      if(!controllers.has(channel))throw new TypeError('Output channel is not admitted');
      retire(channel,cause);run.closeOutput?.(channel);
    },
    signal(name, number, target){
      if(finalized)throw new TypeError('Native invocation finalized');
      if (number !== undefined && constants.signals[name as NodeJS.Signals] !== number || target !== undefined && target !== 'process-group') throw new TypeError('Native signal admission mismatch');
      run.signal(name);
    },
    close(){
      closing??=(async()=>{
        finalized=true;
        const cause=new Error('Native invocation finalized');for(const channel of controllers.keys())retire(channel,cause);
        credits.clear();
        // Finalization owns every local reader. Release them even if remote
        // group death is unconfirmed; idle inherited pipes cannot hold cleanup.
        const localShutdown=Promise.allSettled([
          ...spec.outputChannels.map(async channel=>run.closeOutput?.(channel)),
          ...spec.inputChannels.map(async channel=>run.closeInput?.(channel)),
        ]);
        let signalFailure:PromiseRejectedResult|undefined;
        try{run.signal('SIGTERM');}catch(reason){signalFailure={status:'rejected',reason};}
        let rejectUnconfirmed!: (cause: unknown) => void;
        const unconfirmed = new Promise<never>((_resolve,reject)=>{rejectUnconfirmed=reject;});
        void unconfirmed.catch(()=>{});
        const escalation=setTimeout(()=>{
          if (run.terminateGroup) {
            // Confirmation must also run when the leader never emits exit.
            // An unreachable live process is not cooperative local cleanup.
            void Promise.resolve().then(()=>run.terminateGroup!()).catch(cause=>{
              if (!leaderExited) rejectUnconfirmed(cause);
            });
          } else {
            try{run.signal('SIGKILL');}catch{/* Settlement determines confirmation. */}
          }
        },100);
        try {
          const nativeSettlement=Promise.allSettled([
            run.exit,
            retirement,
            ...inputWork,
            run.settled,
          ]);
          let results: PromiseSettledResult<unknown>[];
          try {results=await Promise.race([nativeSettlement,unconfirmed]);}
          catch(cause) {
            // Local readers/writers were retired above. Drain their admitted
            // operations; observe eventual native settlement without claiming
            // that a denied signal killed or reaped the remote process.
            await localShutdown;
            await Promise.allSettled([...inputWork]);
            throw cause;
          }
          results.push(...await localShutdown);
          if(signalFailure)results.push(signalFailure);
          const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected'&&result.reason!==inputRetired);
          if(failures.length===1)throw failures[0]!.reason;
          if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Native retirement failed');
        }finally{clearTimeout(escalation);}
      })();
      void closing.catch(()=>{});return closing;
    },
  };
}
