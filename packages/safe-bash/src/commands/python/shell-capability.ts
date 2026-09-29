import type { CommandContext } from '../../contracts/index.js';
import type { PythonHostCapability, PythonHostValue } from './host-capabilities.js';

const dispatching = new WeakMap<object, number>();
export function pythonShellDispatchActive(scope: object | undefined): boolean {
  return scope !== undefined && (dispatching.get(scope) ?? 0) > 0;
}

/** Uses the parent's invoker, filesystem and execution budget, never an OS process. */
export function createPythonShellCapability(context: CommandContext, options: { readonly maxInputBytes?: number; readonly maxOutputBytes?: number } = {}): PythonHostCapability {
  if (!context.invoke || !context.executionScope) throw new TypeError('Python shell capability requires a parent shell invocation');
  const maxInputBytes = options.maxInputBytes ?? 8192;
  const maxOutputBytes = options.maxOutputBytes ?? 8192;
  for (const limit of [maxInputBytes, maxOutputBytes]) if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid Python shell limit');
  const scope = context.executionScope;
  const invoke = context.invoke;
  let running = false;
  const execute: NonNullable<PythonHostCapability['call']> = async (value, { signal }) => {
    signal.throwIfAborted();
    if (running) throw new Error('Python nested shell concurrency limit exceeded');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a Python shell request');
    const request = value as Record<string, PythonHostValue>;
    const requestedOutput = request.maxOutputBytes;
    if (requestedOutput !== undefined && (typeof requestedOutput !== 'number' || !Number.isSafeInteger(requestedOutput) || requestedOutput < 0)) throw new RangeError('Invalid Python shell output limit');
    const outputLimit = Math.min(maxOutputBytes, typeof requestedOutput === 'number' ? requestedOutput : maxOutputBytes);
    const timeoutMs = request.timeoutMs;
    if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)) throw new RangeError('Invalid Python shell timeout');
    const childSignal = typeof timeoutMs === 'number' ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : signal;
    const script = request.script;
    const argv = request.argv;
    if ((typeof script === 'string') === Array.isArray(argv)) throw new TypeError('Provide either literal argv or a script');
    if (argv !== undefined && (!Array.isArray(argv) || !argv.length || argv.some(item => typeof item !== 'string' || item.includes('\0')))) throw new TypeError('Invalid Python shell argv');
    if (request.cwd !== undefined && (typeof request.cwd !== 'string' || request.cwd.includes('\0'))) throw new TypeError('Invalid Python shell cwd');
    const env = { ...context.env };
    if (request.env !== undefined) {
      if (!request.env || typeof request.env !== 'object' || Array.isArray(request.env)) throw new TypeError('Invalid Python shell environment');
      for (const [key, item] of Object.entries(request.env)) {
        if (typeof item !== 'string' || key.includes('=') || key.includes('\0') || item.includes('\0')) throw new TypeError('Invalid Python shell environment');
        Object.defineProperty(env, key, { value: item, enumerable: true, configurable: true, writable: true });
      }
    }
    const input = request.stdin ?? [];
    if (typeof input !== 'string' && (!Array.isArray(input) || input.some(byte => typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255))) throw new TypeError('Invalid Python shell stdin');
    if (input.length > maxInputBytes) throw new RangeError('Python shell input limit exceeded');
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : Uint8Array.from(input as number[]);
    if (bytes.length > maxInputBytes) throw new RangeError('Python shell input limit exceeded');
    const source = request.stdinMode === 'inherit' && request.stdin === undefined ? context.stdin : { async *[Symbol.asyncIterator]() { yield bytes; } };
    const childInput = { async *[Symbol.asyncIterator]() {
      let received = 0;
      for await (const fragment of source) {
        childSignal.throwIfAborted();
        received += fragment.length;
        if (received > maxInputBytes) throw new RangeError('Python shell input limit exceeded');
        yield fragment;
      }
    } };
    const stdout: number[] = [];
    const stderr: number[] = [];
    let captured = 0;
    const sink = (target: number[]) => ({ async write(chunk: Uint8Array) {
      childSignal.throwIfAborted();
      if (chunk.length > outputLimit - captured) throw new RangeError('Python shell output limit exceeded');
      captured += chunk.length;
      for (const byte of chunk) target.push(byte);
    } });
    running = true;
    dispatching.set(scope, (dispatching.get(scope) ?? 0) + 1);
    try {
      const args = argv as string[] | undefined;
      const result = await invoke(args ? args[0]! : 'sh', args ? args.slice(1) : ['-c', script as string], {
        signal: childSignal, cwd: request.cwd as string | undefined ?? context.cwd, env, replaceEnv: true,
        stdin: childInput, stdout: sink(stdout), stderr: sink(stderr), externalInvocation: true,
      });
      childSignal.throwIfAborted();
      return { stdout, stderr, exitCode: result.exitCode };
    } finally {
      running = false;
      const count = dispatching.get(scope)! - 1;
      if (count) dispatching.set(scope, count); else dispatching.delete(scope);
    }
  };
  return { call: execute, async *stream(value, context) {
    const result = await execute(value, context) as { stdout: number[]; stderr: number[]; exitCode: number };
    if (result.stdout.length) yield { type: 'stdout', data: result.stdout };
    if (result.stderr.length) yield { type: 'stderr', data: result.stderr };
    yield { type: 'exit', returncode: result.exitCode };
  } };
}
