import {LlmPluginExit, createLlmSpool, createLlmToolRegistry, type LlmToolLoader, type LlmRegisteredTool, type LlmToolOutput, type LlmSourceAttachment, type LlmToolContext, type LlmToolboxDescription, type LlmPluginInfo} from 'safe-bash-command-llm';
import {toByteSource} from 'safe-bash-contracts';
import {createPythonExecutorCommands, type PythonCommandsOptions} from './executor.js';
import type {PythonHostCapability, PythonHostValue} from './host-capabilities.js';
import {pythonLlmFunctionsProgram} from './llm-functions-program.js';

type Spool = Awaited<ReturnType<typeof createLlmSpool>>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function record(value: PythonHostValue): Record<string, PythonHostValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Python tool protocol');
  return value as Record<string, PythonHostValue>;
}

export interface PythonLlmToolLoaderOptions extends PythonCommandsOptions {
  /** Explicit installed distributions whose tooling hooks the host authorizes. */
  readonly plugins?: readonly string[];
}

/** Reuse one configured interpreter per load, retaining only caller-backed tool
 * payloads. The session must outlive consumption of its borrowed results. */
export function createPythonLlmToolLoader(options: PythonLlmToolLoaderOptions): LlmToolLoader {
  if (!options.createExecutor) throw new TypeError('Python tool loading requires an asynchronous executor');
  if (options.plugins !== undefined && (!Array.isArray(options.plugins) || options.plugins.some(name=>typeof name!=='string' || !name || name!==name.trim() || name.includes(',')))) throw new TypeError('Python tool plugins must be explicit distribution names');
  const pluginNames=Object.freeze([...(options.plugins ?? [])]);
  const capabilitiesByArguments = new WeakMap<readonly string[], PythonHostCapability>();
  const command = createPythonExecutorCommands({...options, createCapabilities: current => {
    const capabilities = options.createCapabilities?.(current) ?? {};
    if (capabilities.llm_tools) throw new Error('Python tool capability is reserved');
    const capability = capabilitiesByArguments.get(current.args);
    if (!capability) throw new Error('Unknown Python tool invocation');
    return {...capabilities, llm_tools: capability};
  }})[0]!;
  return async ({context, definitions, toolNames = [], discovery = false, pluginQuery, maxInputBytes, maxOutputBytes}) => {
    if (!Array.isArray(definitions) || definitions.some(value => typeof value !== 'string')) throw new TypeError('Python tool definitions must be strings');
    if (!Array.isArray(toolNames) || toolNames.some(value => typeof value !== 'string') || typeof discovery !== 'boolean') throw new TypeError('Invalid Python tool selection');
    if (pluginQuery && (typeof pluginQuery.all !== 'boolean' || !Array.isArray(pluginQuery.hooks) || pluginQuery.hooks.some(value => typeof value !== 'string'))) throw new TypeError('Invalid Python plugin query');
    for (const limit of [maxInputBytes, maxOutputBytes]) if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Invalid Python tool byte limit');
    context.signal.throwIfAborted();
    const controller = new AbortController();
    const runtimeController = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const ready = deferred<void>();
    const tools: LlmRegisteredTool[] = [];
    const toolboxes: LlmToolboxDescription[] = [];
    let plugins: readonly LlmPluginInfo[] | undefined;
    const spools = new Set<Spool>();
    const jobs = new Map<number, {result: ReturnType<typeof deferred<LlmToolOutput>>; output: Spool; attachments: LlmSourceAttachment[]; files: Map<number, Spool>; bytes: number; limit: number}>();
    const queue: PythonHostValue[] = [];
    let waiter: ReturnType<typeof deferred<PythonHostValue>> | undefined;
    let serial = 0, controls = 0, loaded = false, exited = false, initializationFailed = false, closed = false, closing: Promise<void> | undefined;
    const encoder = new TextEncoder();
    const fail = (error: unknown) => {
      ready.reject(error);
      queue.length = 0;
      if (waiter) {waiter.resolve({cancel: true}); waiter = undefined;} else queue.push({cancel: true});
      for (const job of jobs.values()) job.result.reject(error);
      jobs.clear();
      controller.abort(error);
    };
    const aborted = () => fail(signal.reason);
    signal.addEventListener('abort', aborted, {once: true});
    const spool = async (): Promise<Spool> => {
      const value = await createLlmSpool(context.fs, context.cwd, signal);
      spools.add(value);
      if (closed || signal.aborted) {await value.close(); spools.delete(value); signal.throwIfAborted(); throw new Error('Python tool session is closed');}
      return value;
    };
    const source = (value: Spool) => ({bytes: value.replay(), async dispose() {try {await value.close();} finally {spools.delete(value);}}});
    const invoke = async (fields: Record<string, PythonHostValue>, callContext: LlmToolContext): Promise<LlmToolOutput> => {
      signal.throwIfAborted(); callContext.signal.throwIfAborted();
      if (closed) throw new Error('Python tool session is closed');
      const stop = () => fail(callContext.signal.reason);
      callContext.signal.addEventListener('abort', stop, {once: true});
      let output: Spool | undefined;
      try {
        output = await spool();
        callContext.signal.throwIfAborted();
        const result = deferred<LlmToolOutput>(), id = ++serial;
        jobs.set(id, {result, output, attachments: [], files: new Map(), bytes: 0, limit: Math.min(callContext.maxBytes, maxOutputBytes)});
        const request = {id, ...fields};
        if (waiter) {waiter.resolve(request); waiter = undefined;} else queue.push(request);
        return await result.promise;
      } catch (error) {
        if (output) {await output.close(); spools.delete(output);}
        throw error;
      } finally {callContext.signal.removeEventListener('abort', stop);}
    };
    const prepare: NonNullable<LlmRegisteredTool['prepare']> = async (callContext, mode) => {
      const result = await invoke({prepare: true, asynchronous: mode.async}, callContext);
      await result.source?.dispose();
    };
    const dispatch = async (value: PythonHostValue): Promise<PythonHostValue> => {
      const message = record(value);
      if (message.op !== 'next' && message.op !== 'failed') signal.throwIfAborted();
      if (message.op === 'definitions') return [...definitions];
      if (message.op === 'selection') return {names: [...toolNames], discovery, ...(pluginNames.length ? {plugins:[...pluginNames]} : {}), ...(pluginQuery ? {pluginQuery: {all: pluginQuery.all, hooks: [...pluginQuery.hooks]}} : {})};
      if (message.op === 'admit') {
        if (typeof message.size !== 'number' || !Number.isSafeInteger(message.size) || message.size < 0) throw new TypeError('Invalid Python definition byte count');
        controls += message.size;
        if (controls > maxInputBytes) {const error = new RangeError('Python tool definition byte limit exceeded'); fail(error); throw error;}
        return null;
      }
      if (message.op === 'exit') {exited = true; return null;}
      if (message.op === 'failed') {initializationFailed = true; fail(new Error(String(message.message))); return null;}
      if (message.op === 'register' || message.op === 'toolbox' || message.op === 'plugins') {
        controls += encoder.encode(JSON.stringify(message)).length;
        if (controls > maxInputBytes) throw new RangeError('Python tool definition byte limit exceeded');
      }
      if (message.op === 'plugins') {
        if (loaded || plugins || !pluginQuery || !Array.isArray(message.plugins)) throw new TypeError('Invalid Python plugin discovery');
        plugins = Object.freeze(message.plugins.map(value => {
          const plugin = record(value);
          if (typeof plugin.name !== 'string' || !Array.isArray(plugin.hooks) || plugin.hooks.some(hook => typeof hook !== 'string') ||
            (plugin.version !== undefined && typeof plugin.version !== 'string')) throw new TypeError('Invalid Python plugin metadata');
          return Object.freeze({name: plugin.name, hooks: Object.freeze(plugin.hooks as string[]), ...(typeof plugin.version === 'string' ? {version: plugin.version} : {})});
        }));
        return null;
      }
      if (message.op === 'toolbox') {
        if (loaded || typeof message.name !== 'string' || !Array.isArray(message.tools)) throw new TypeError('Invalid Python toolbox registration');
        const methods = message.tools.map(value => {const method = record(value);
          const tool: LlmRegisteredTool = {name: String(method.name), inputSchema: record(method.inputSchema!),
            ...(typeof method.description === 'string' ? {description: method.description} : {}),
            ...(typeof method.signature === 'string' ? {signature: method.signature} : {})};
          if (typeof method.name !== 'string') throw new TypeError('Invalid Python toolbox method');
          createLlmToolRegistry([tool]); return tool;
        });
        toolboxes.push({name: message.name, tools: methods}); return null;
      }
      if (message.op === 'register') {
        if (loaded || message.index !== tools.length || typeof message.name !== 'string' || typeof message.signature !== 'string' || typeof message.asynchronous !== 'boolean') throw new TypeError('Invalid Python tool registration');
        const index = tools.length;
        const tool: LlmRegisteredTool = {name: message.name, inputSchema: record(message.inputSchema!), signature: message.signature,
          ...(typeof message.description === 'string' ? {description: message.description} : {}),
          ...(typeof message.plugin === 'string' ? {plugin: message.plugin} : {}),
          ...(typeof message.registryKey === 'string' ? {registryKey: message.registryKey} : {}),
          ...(typeof message.selectionIndex === 'number' ? {selectionIndex: message.selectionIndex} : {}), async: message.asynchronous,
          async implementation(args, callContext) {
            return invoke({tool: index, arguments: args as PythonHostValue}, callContext);
          }};
        createLlmToolRegistry([tool]); tools.push(tool); return null;
      }
      if (message.op === 'ready') {if (loaded) throw new Error('Python tools already loaded');
        if (message.prepare === true) for (let index = 0; index < tools.length; index++) tools[index] = {...tools[index]!, prepare};
        loaded = true; ready.resolve(); return null;}
      if (message.op === 'next') {
        if (signal.aborted) return {cancel: true};
        if (!loaded || waiter) throw new Error('Invalid Python tool request queue');
        if (queue.length) return queue.shift()!;
        waiter = deferred<PythonHostValue>(); return waiter.promise;
      }
      if (typeof message.id !== 'number') throw new TypeError('Invalid Python tool call identity');
      const job = jobs.get(message.id);
      if (!job) throw new Error('Unknown Python tool call');
      if (message.op === 'text' || message.op === 'bytes') {
        let bytes: Uint8Array, target = job.output;
        if (message.op === 'text') {
          if (typeof message.text !== 'string' || message.text.length > 8192) throw new TypeError('Invalid Python tool output window');
          bytes = encoder.encode(message.text);
          if (bytes.length > 16384) throw new TypeError('Invalid Python tool output window');
        } else {
          if (!Array.isArray(message.bytes) || message.bytes.length > 4096 || message.bytes.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255)) throw new TypeError('Invalid Python attachment window');
          if (typeof message.attachment !== 'number' || !job.files.has(message.attachment)) throw new Error('Unknown Python attachment');
          target = job.files.get(message.attachment)!; bytes = Uint8Array.from(message.bytes as number[]);
        }
        if (bytes.length > job.limit - job.bytes) throw new RangeError('Python tool output byte limit exceeded');
        job.bytes += bytes.length; await target.write(bytes); return null;
      }
      if (message.op === 'attachment') {
        const metadata = record(message.descriptor!);
        if (typeof metadata.mimeType !== 'string' || typeof metadata.id !== 'string' || metadata.url !== undefined && typeof metadata.url !== 'string') throw new TypeError('Invalid Python tool attachment');
        const size = encoder.encode(JSON.stringify(metadata)).length;
        if (size > job.limit - job.bytes) throw new RangeError('Python tool attachment metadata limit exceeded');
        job.bytes += size;
        const index = job.attachments.length;
        if (metadata.url !== undefined) job.attachments.push({mimeType: metadata.mimeType, id: metadata.id, url: metadata.url});
        else {const file = await spool(); job.files.set(index, file); job.attachments.push({mimeType: metadata.mimeType, id: metadata.id, source: source(file)});}
        return index;
      }
      if (message.op === 'error') {
        jobs.delete(message.id);
        await Promise.all([job.output, ...job.files.values()].map(async value => {await value.close(); spools.delete(value);}));
        job.result.reject(new Error(String(message.message))); return null;
      }
      if (message.op === 'done') {jobs.delete(message.id); job.result.resolve({source: source(job.output), attachments: job.attachments}); return null;}
      throw new TypeError('Invalid Python tool operation');
    };
    const capability: PythonHostCapability = {async call(value) {
      try {return await dispatch(value);}
      catch (error) {fail(error); throw error;}
    }};
    const {registerCleanup: ignoredParentCleanup, ...isolatedContext} = context;
    const invocation = {...isolatedContext, signal: runtimeController.signal, command: 'python', args: ['-c', pythonLlmFunctionsProgram], stdin: toByteSource('')};
    capabilitiesByArguments.set(invocation.args, capability);
    const running = Promise.resolve().then(() => command.execute(invocation)).then(
      result => {if (!closed) fail(exited ? new LlmPluginExit(result.exitCode) : new Error(`Python tool interpreter exited with status ${result.exitCode}`));},
      error => {if (!closed) fail(error);}
    );
    const close = (): Promise<void> => closing ??= (async () => {
      closed = true;
      if (loaded && !signal.aborted && !jobs.size) {
        if (waiter) {waiter.resolve(null); waiter = undefined;} else queue.push(null);
      } else {
        controller.abort(new Error('Python tool session closed'));
        if (!loaded && !initializationFailed) runtimeController.abort(signal.reason);
      }
      await running;
      capabilitiesByArguments.delete(invocation.args);
      controller.abort(new Error('Python tool session closed'));
      signal.removeEventListener('abort', aborted);
      await Promise.all([...spools].map(value => value.close())); spools.clear();
    })();
    context.registerCleanup?.(close);
    try {signal.throwIfAborted(); await ready.promise; return {tools: Object.freeze(tools), toolboxes: Object.freeze(toolboxes), ...(plugins ? {plugins} : {}), close};}
    catch (error) {await close(); throw error;}
  };
}
