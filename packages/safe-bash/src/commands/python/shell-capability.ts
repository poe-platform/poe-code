import type { ByteSink, CommandContext, CommandInvokeOptions } from '../../contracts/index.js';
import { combineManagedSignals } from '../../fs/creation-mask.js';
import type { PythonInvocationCapabilities } from './index.js';

/** Invoke the parent's configured shell; no second workspace or OS subprocess. */
export function createPythonShellCapability(context: CommandContext): PythonInvocationCapabilities {
  const controller = new AbortController();
  const signal = combineManagedSignals(context.signal, controller.signal);
  const pending = new Set<Promise<unknown>>();
  const maxBytes = 128 * 1024;
  let closed = false;
  let sequence = 0;
  const streams = new Map<string, {next():Promise<unknown>;close():Promise<void>}>();

  async function run(payload: Readonly<Record<string, unknown>>, emit?: (event: Record<string, unknown>) => Promise<void>, streamSignal?: AbortSignal): Promise<unknown> {
    if (!context.invoke) throw new Error('Parent invocation has no shell capability');
    if (closed) throw new Error('Python shell capability retired');
    signal.throwIfAborted();
    const argv = payload.argv;
    const script = payload.script;
    if ((argv === undefined) === (script === undefined)) throw new TypeError('Supply literal argv or an explicit script');
    if (argv !== undefined && (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string' || value.includes('\0')) || !argv[0])) throw new TypeError('Invalid literal argv');
    if (script !== undefined && (typeof script !== 'string' || script.includes('\0'))) throw new TypeError('Invalid Safe Bash script');
    if (Array.isArray(argv) && ['python', 'python3'].includes(argv[0])) return {error:{code:'nested_python', message:'Nested Python execution is not supported by this capability'}};
    const requestedLimit = payload.max_output_bytes ?? maxBytes;
    if (!Number.isSafeInteger(requestedLimit) || (requestedLimit as number) < 0) throw new TypeError('Invalid output limit');
    const limit = Math.min(requestedLimit as number, maxBytes);
    const timeout = payload.timeout;
    if (timeout !== undefined && timeout !== null && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0)) throw new TypeError('Invalid timeout');
    const child = new AbortController();
    const childSignal = streamSignal ? combineManagedSignals(signal, child.signal, streamSignal) : combineManagedSignals(signal, child.signal);
    let expired = false;
    let overflow = false;
    const timer = typeof timeout === 'number' ? setTimeout(() => { expired = true; child.abort(new Error('Python shell deadline')); }, timeout * 1000) : undefined;
    const stdout: number[] = [];
    const stderr: number[] = [];
    let bytes = 0;
    const sink = (target: number[], mode: unknown, inherited: ByteSink, type: string): ByteSink => ({
      async write(chunk) {
        childSignal.throwIfAborted();
        bytes += chunk.length;
        if (bytes > limit) { overflow = true; child.abort(new Error('Python shell output limit')); throw childSignal.reason; }
        if (emit) await emit({type,data:Array.from(chunk)});
        else if (mode === 'inherit') await inherited.write(chunk);
        else if (mode !== 'discard') for (const byte of chunk) target.push(byte);
      },
    });
    try {
      let options: CommandInvokeOptions = {signal:childSignal, stdout:sink(stdout,payload.stdout,context.stdout,'stdout'), stderr:sink(stderr,payload.stderr,context.stderr,'stderr')};
      if (payload.cwd !== undefined && payload.cwd !== null) {
        if (typeof payload.cwd !== 'string' || payload.cwd.includes('\0')) throw new TypeError('Invalid child cwd');
        options = {...options, cwd:payload.cwd};
      }
      if (payload.env !== undefined && payload.env !== null) {
        if (typeof payload.env !== 'object' || Array.isArray(payload.env) || Object.entries(payload.env).some(([key,value]) => !key || key.includes('=') || key.includes('\0') || typeof value !== 'string' || value.includes('\0'))) throw new TypeError('Invalid child environment');
        options = {...options, env:payload.env as Record<string,string>, replaceEnv:true};
      }
      if (payload.input !== undefined) {
        if (!Array.isArray(payload.input) || payload.input.length > 16384 || payload.input.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new TypeError('Invalid bounded binary input');
        const input = Uint8Array.from(payload.input);
        options = {...options, stdin:(async function* () { yield input; })()};
      } else if (payload.stdin === 'empty') options = {...options, stdin:(async function* () {})()};
      const result = await context.invoke(script === undefined ? (argv as string[])[0]! : 'bash', script === undefined ? (argv as string[]).slice(1) : ['-c', script as string], options);
      if (expired) return {error:{code:'timeout',message:'Shell execution exceeded timeout',stdout,stderr}};
      if (overflow) return {error:{code:'limit',message:'Shell output limit exceeded'}};
      return {returncode:result.exitCode,stdout,stderr};
    } catch (error) {
      if (expired) return {error:{code:'timeout',message:'Shell execution exceeded timeout',stdout,stderr}};
      if (overflow) return {error:{code:'limit',message:'Shell output limit exceeded'}};
      throw error;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  function openStream(payload: Readonly<Record<string, unknown>>): {handle:string} {
    if (closed) throw new Error('Python shell capability retired');
    const handle = 'shell-' + ++sequence;
    const streamController = new AbortController();
    const queue: {value:Record<string,unknown>;resolve():void;reject(reason:unknown):void}[] = [];
    let wake: (() => void) | undefined;
    let stopped = false;
    let done = false;
    let reading = false;
    let failure: unknown;
    const emit = (value: Record<string,unknown>): Promise<void> => new Promise((resolve,reject) => {
      if (stopped) { reject(new Error('Python shell stream closed')); return; }
      queue.push({value,resolve,reject});
      wake?.();
    });
    const task = run(payload, emit, streamController.signal).then(async result => {
      await emit({type:'result', ...(result as Record<string,unknown>)});
    }).catch(error => { failure = error; }).finally(() => { done = true; wake?.(); });
    pending.add(task);
    void task.finally(() => pending.delete(task));
    streams.set(handle, {
      async next() {
        if (reading) throw new Error('Concurrent Python shell stream read');
        reading = true;
        try {
          while (!queue.length && !done && !stopped) await new Promise<void>(resolve => { wake = resolve; });
          wake = undefined;
          const event = queue.shift();
          if (event) { event.resolve(); return {done:false,value:event.value}; }
          if (failure && !stopped) throw failure;
          return {done:true};
        } finally { reading = false; }
      },
      async close() {
        stopped = true;
        streamController.abort(new Error('Python shell stream closed'));
        for (const event of queue.splice(0)) event.reject(streamController.signal.reason);
        wake?.();
        await task;
        streams.delete(handle);
      },
    });
    return {handle};
  }

  return {
    async request(operation, payload) {
      if (operation === 'shell.stream.open') return openStream(payload);
      if (operation === 'shell.stream.next' || operation === 'shell.stream.close') {
        const stream = typeof payload.handle === 'string' ? streams.get(payload.handle) : undefined;
        if (!stream) throw new TypeError('Unknown invocation-owned shell stream');
        if (operation === 'shell.stream.next') return stream.next();
        await stream.close();
        return {closed:true};
      }
      if (operation !== 'shell.run') throw new TypeError('Unsupported Python shell operation');
      const operationPromise = run(payload);
      pending.add(operationPromise);
      try { return await operationPromise; }
      finally { pending.delete(operationPromise); }
    },
    async close() {
      if (closed) return;
      closed = true;
      controller.abort(new Error('Python shell capability retired'));
      await Promise.allSettled([...streams.values()].map(stream => stream.close()));
      await Promise.allSettled([...pending]);
    },
  };
}
