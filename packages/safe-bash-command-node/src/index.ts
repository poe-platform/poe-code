import { newQuickJSAsyncWASMModule, type QuickJSAsyncContext } from 'quickjs-emscripten';
import { collectBytes, resolvePath, dirname, posixPath, type FileSystem } from '@poe-code/safe-fs/core';
import type { CommandDefinition } from 'safe-bash-contracts/command';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { bootstrap } from './runtime.js';

export interface NodeLimits {
  memoryBytes: number;
  sourceBytes: number;
  outputBytes: number;
  fileBytes: number;
  operations: number;
  timeoutMs: number;
}
export interface NodeCommandsOptions { readonly limits?: Partial<NodeLimits>; readonly replace?: boolean; }
const defaults: NodeLimits = { memoryBytes: 32 * 1024 * 1024, sourceBytes: 1024 * 1024, outputBytes: 1024 * 1024, fileBytes: 4 * 1024 * 1024, operations: 1000, timeoutMs: 5000 };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createNodeCommand(options: NodeCommandsOptions = {}): CommandDefinition {
  const limits = { ...defaults, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(defaults, key) || !Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Invalid node limit: ${key}`);
  }
  return { name: 'node', description: 'Execute JavaScript in QuickJS with safe-fs and safe-bash', async execute(context) {
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const timeout = setTimeout(() => controller.abort(new Error('Node execution deadline exceeded')), limits.timeoutMs);
    const deadline = Date.now() + limits.timeoutMs;
    let closeRequested = false;
    let completed!: () => void;
    const completion = new Promise<void>(resolve => { completed = resolve; });
    context.registerCleanup?.(async () => { closeRequested = true; controller.abort(); await completion; });
    let vm: QuickJSAsyncContext | undefined;
    let outputBytes = 0;
    let sourceBytes = 0;
    let operations = 0;
    let limitFailure: Error | undefined;
    const check = () => { signal.throwIfAborted(); if (closeRequested || Date.now() > deadline) throw new Error('Node execution deadline exceeded'); if (limitFailure) throw limitFailure; };
    const bound = (size: number, max: number, name: string) => { if (size > max) { limitFailure = new Error(`Node ${name} limit exceeded`); throw limitFailure; } };
    const path = (value: unknown) => { if (typeof value !== 'string' || value.includes('\0')) throw new TypeError('Expected a virtual path'); return resolvePath(context.cwd, value); };
    const fs: FileSystem = context.fs;
    const read = async (name: unknown, source = false) => {
      check();
      const bytes = await fs.readFile(path(name), { signal, maxBytes: source ? limits.sourceBytes - sourceBytes : limits.fileBytes });
      bound(bytes.length, source ? limits.sourceBytes - sourceBytes : limits.fileBytes, source ? 'source' : 'file');
      if (source) sourceBytes += bytes.length;
      return bytes;
    };
    const emit = async (value: string | Uint8Array, stderr: boolean) => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value; outputBytes += bytes.length; bound(outputBytes, limits.outputBytes, 'output');
      await (stderr ? context.stderr : context.stdout).write(bytes); check();
    };
    try {
      const args = [...context.args];
      let source: string;
      let filename = '[stdin]';
      let print = false;
      const flag = args[0];
      if (flag === '-e' || flag === '--eval' || flag === '-p' || flag === '--print') {
        args.shift();
        if (args.length === 0) throw new Error(`${flag} requires source`);
        source = args.shift()!; print = flag === '-p' || flag === '--print'; filename = '[eval]';
      } else {
        if (flag === '--') args.shift();
        if (args[0]?.startsWith('-') && args[0] !== '-') throw new Error(`Unsupported node option: ${args[0]}`);
        const file = args.shift();
        if (file && file !== '-') { filename = path(file); source = decoder.decode(await read(filename, true)); }
        else source = decoder.decode(await collectBytes(context.stdin, { signal, maxBytes: limits.sourceBytes }));
      }
      if (filename[0] === '[') sourceBytes = encoder.encode(source).length;
      bound(sourceBytes, limits.sourceBytes, 'source');
      if (source.startsWith('#!')) { const end = source.indexOf('\n'); source = end < 0 ? '' : source.slice(end); }
      check();
      const engine = await newQuickJSAsyncWASMModule();
      const contextVm = engine.newContext();
      vm = contextVm;
      vm.runtime.setMemoryLimit(limits.memoryBytes);
      vm.runtime.setMaxStackSize(512 * 1024);
      vm.runtime.setInterruptHandler(() => signal.aborted || closeRequested || Date.now() > deadline || !!limitFailure);
      const host = contextVm.newAsyncifiedFunction('__host', async (operation, payload) => {
        try {
          check(); bound(++operations, limits.operations, 'operations');
          const op = contextVm.getString(operation);
          const values: unknown[] = JSON.parse(contextVm.getString(payload));
          let value: unknown = null;
          switch (op) {
            case 'read': value = Array.from(await read(values[0])); break;
            case 'source': value = decoder.decode(await read(values[0], true)); break;
            case 'write': {
              if (!Array.isArray(values[1]) || !values[1].every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new TypeError('Expected bytes');
              bound(values[1].length, limits.fileBytes, 'file');
              await fs.writeFile(path(values[0]), new Uint8Array(values[1]), { signal }); break;
            }
            case 'stat': { const stat = await fs.stat(path(values[0]), { signal }); value = { type: stat.type, size: stat.size }; break; }
            case 'mkdir': await fs.mkdir(path(values[0]), { signal, recursive: values[1] === true }); break;
            case 'output': await emit(String(values[0]), values[1] === true); break;
            case 'encode': value = Array.from(encoder.encode(String(values[0]))); break;
            case 'decode': value = decoder.decode(new Uint8Array(values[0] as number[])); break;
            case 'resolve': value = resolvePath(String(values[0]), String(values[1])); break;
            case 'dirname': value = dirname(String(values[0])); break;
            case 'path': {
              const method = values[0];
              if (method === 'join') value = posixPath.join(...values.slice(1) as string[]);
              else if (method === 'basename') value = posixPath.basename(String(values[1]));
              else if (method === 'extname') value = posixPath.extname(String(values[1]));
              else throw new Error('Unsupported path operation');
              break;
            }
            case 'exec': {
              if (!context.invoke) throw new Error('safe-bash command dispatch unavailable');
              if (typeof values[0] !== 'string' || !Array.isArray(values[1]) || !values[1].every(v => typeof v === 'string')) throw new TypeError('Expected command and string argv');
              const chunks: Uint8Array[] = [];
              let total = 0;
              const result = await context.invoke(values[0], values[1], {
                signal, stdin: { async *[Symbol.asyncIterator]() {} },
                stdout: { async write(bytes) { total += bytes.length; bound(total, limits.outputBytes, 'child output'); chunks.push(new Uint8Array(bytes)); } },
                stderr: { async write(bytes) { await emit(bytes, true); } },
              });
              const bytes = new Uint8Array(total); let offset = 0;
              for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
              value = { status: result.exitCode, bytes: Array.from(bytes) }; break;
            }
            default: throw new Error('Unsupported host operation');
          }
          check();
          return contextVm.newString(JSON.stringify({ value }));
        } catch (error) {
          const failure = error as { message?: string; code?: string };
          return contextVm.newString(JSON.stringify({ error: { message: failure?.message ?? String(error), code: failure?.code } }));
        }
      });
      vm.setProp(vm.global, '__host', host); host.dispose();
      const configuration = JSON.stringify({ cwd: context.cwd, env: context.env, argv: ['/virtual/bin/node', ...(filename === '[eval]' ? [] : [filename]), ...args], filename });
      const setup = await vm.evalCodeAsync(`${bootstrap}(${configuration});`, 'safe-bash-node');
      vm.unwrapResult(setup).dispose();
      const result = await vm.evalCodeAsync(print ? `console.log((${source}\n))` : source, filename);
      vm.unwrapResult(result).dispose();
      check();
      // This synchronous CommonJS profile does not silently report pending jobs as completed.
      if (vm.runtime.hasPendingJob()) throw new Error('Asynchronous jobs are unsupported by this Node profile');
      const exit = vm.unwrapResult(await vm.evalCodeAsync('process.exitCode', 'exitCode'));
      const exitCode = vm.getNumber(exit); exit.dispose();
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error('Invalid process.exitCode');
      return { exitCode };
    } catch (error) {
      context.signal.throwIfAborted();
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      await context.stderr.write(encoder.encode(`node: ${message}\n`).slice(0, limits.outputBytes));
      return { exitCode: 1 };
    } finally {
      clearTimeout(timeout);
      try { if (vm?.alive) vm.dispose(); } finally { completed(); }
    }
  } };
}

export function createNodeCommands(options: NodeCommandsOptions = {}): readonly CommandDefinition[] { return [createNodeCommand(options)]; }
export function nodeCommands(options: NodeCommandsOptions = {}): VirtualShellPlugin {
  const command = createNodeCommand(options);
  return { name: 'quickjs-node', setup(host) { host.commands.register(command, { replace: options.replace ?? false }); } };
}
