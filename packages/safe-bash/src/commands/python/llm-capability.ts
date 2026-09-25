import type { CommandContext } from '../../contracts/index.js';
import { combineManagedSignals } from '../../fs/creation-mask.js';
import type { LlmService, LlmServiceRequest } from '../llm/service.js';
import { sniffMimeType } from '../llm/mime.js';
import type { LlmOption } from '../llm/types.js';
import type { PythonInvocationCapabilities } from './index.js';

class LlmCapabilityError extends Error {
  constructor(readonly code:string, message:string) { super(message); }
}

/** Credentials and transport stay in the shared host service. */
export function createPythonLlmCapability(context: CommandContext, service: LlmService): PythonInvocationCapabilities {
  const controller = new AbortController();
  const signal = combineManagedSignals(context.signal, controller.signal);
  const streams = new Map<string, {iterator:AsyncGenerator<Record<string,unknown>>;controller:AbortController}>();
  const pending = new Set<Promise<unknown>>();
  const limit = 128 * 1024;
  let sequence = 0;
  let closed = false;

  async function request(payload: Readonly<Record<string,unknown>>, childSignal:AbortSignal):Promise<LlmServiceRequest> {
    if (typeof payload.prompt !== 'string') throw new TypeError('Prompt must be a string');
    if (payload.model !== undefined && typeof payload.model !== 'string') throw new TypeError('Invalid model');
    if (payload.system !== undefined && typeof payload.system !== 'string') throw new TypeError('Invalid system prompt');
    for (const key of ['template','conversation','parameters']) {
      if (payload[key] !== undefined) throw new TypeError(`Shared LLM service does not yet support ${key}`);
    }
    if (payload.messages !== undefined && !Array.isArray(payload.messages)) throw new TypeError('Invalid messages');
    if (payload.options !== undefined && (payload.options === null || typeof payload.options !== 'object' || Array.isArray(payload.options))) throw new TypeError('Invalid options');
    const attachments: {mimeType:string;bytes:Uint8Array}[] = [];
    let size = new TextEncoder().encode(payload.prompt).length;
    if (payload.attachments !== undefined && !Array.isArray(payload.attachments)) throw new TypeError('Invalid attachments');
    for (const value of (payload.attachments ?? []) as unknown[]) {
      if (!value || typeof value !== 'object') throw new TypeError('Invalid attachment');
      const attachment = value as Record<string,unknown>;
      if (typeof attachment.path !== 'string' || attachment.mimeType !== undefined && typeof attachment.mimeType !== 'string') throw new TypeError('Attachment requires path and mimeType');
      const bytes = await context.fs.readFile(attachment.path,{signal:childSignal,maxBytes:Math.max(0,limit-size)});
      size += bytes.length;
      if (size > limit) throw new Error('LLM input limit exceeded');
      attachments.push({mimeType:typeof attachment.mimeType === 'string' ? attachment.mimeType : sniffMimeType(attachment.path,bytes),bytes});
    }
    if (size > limit) throw new Error('LLM input limit exceeded');
    return {prompt:payload.prompt, ...(typeof payload.model === 'string' ? {model:payload.model}:{}), ...(typeof payload.system === 'string' ? {system:payload.system}:{}), ...(payload.messages !== undefined ? {messages:payload.messages as NonNullable<LlmServiceRequest['messages']>}:{}), ...(payload.schema !== undefined ? {schema:payload.schema as NonNullable<LlmServiceRequest['schema']>}:{}), attachments,options:(payload.options ?? {}) as Record<string,LlmOption>,signal:childSignal};
  }

  async function* events(payload:Readonly<Record<string,unknown>>, childSignal:AbortSignal):AsyncGenerator<Record<string,unknown>> {
    const timeout = payload.timeout;
    if (timeout !== undefined && timeout !== null && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0)) throw new TypeError('Invalid LLM timeout');
    const deadline = new AbortController();
    const operationSignal = combineManagedSignals(childSignal,deadline.signal);
    let expired = false;
    const timer = typeof timeout === 'number' ? setTimeout(() => {expired = true;deadline.abort(new LlmCapabilityError('timeout','LLM request exceeded timeout'));},timeout*1000):undefined;
    try {
    const input = await request(payload,operationSignal);
    const model = service.resolve(input.model).model.id;
    let text = '';
    const data:number[] = [];
    let size = 0;
    for await (const chunk of service.complete(input)) {
      operationSignal.throwIfAborted();
      size += typeof chunk === 'string' ? new TextEncoder().encode(chunk).length : chunk.length;
      if (size > limit) throw new Error('LLM response limit exceeded');
      if (typeof chunk === 'string') { text += chunk; yield {type:'text',text:chunk}; }
      else { for (const byte of chunk) data.push(byte); yield {type:'bytes',data:Array.from(chunk)}; }
    }
    yield {type:'response',response:{model,text,data}};
    } catch (error) {
      if (expired) throw new LlmCapabilityError('timeout','LLM request exceeded timeout');
      throw error;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  async function dispatch(operation:string,payload:Readonly<Record<string,unknown>>):Promise<unknown> {
    if (closed) throw new Error('Python LLM capability retired');
    signal.throwIfAborted();
    if (operation === 'llm.models') return service.models.map(({model,provider}) => ({id:model.id,provider:provider.name,aliases:[...model.aliases ?? []]}));
    if (operation === 'llm.embed') {
      if (!Array.isArray(payload.inputs) || payload.inputs.some(value => typeof value !== 'string')) throw new TypeError('Invalid embedding inputs');
      if (payload.model !== undefined && payload.model !== null && typeof payload.model !== 'string') throw new TypeError('Invalid embedding model');
      if (payload.options !== undefined && (!payload.options || typeof payload.options !== 'object' || Array.isArray(payload.options))) throw new TypeError('Invalid embedding options');
      return service.embed({inputs:payload.inputs as string[],...(typeof payload.model === 'string' ? {model:payload.model}:{}), options:(payload.options ?? {}) as Record<string,LlmOption>,signal});
    }
    if (operation === 'llm.complete') {
      let response:unknown;
      for await (const event of events(payload,signal)) if (event.type === 'response') response = event.response;
      return response;
    }
    if (operation === 'llm.stream.open') {
      const child = new AbortController();
      const handle = 'llm-' + ++sequence;
      streams.set(handle,{controller:child,iterator:events(payload,combineManagedSignals(signal,child.signal))});
      return {handle};
    }
    if (operation === 'llm.stream.next' || operation === 'llm.stream.close') {
      const stream = typeof payload.handle === 'string' ? streams.get(payload.handle):undefined;
      if (!stream) throw new TypeError('Unknown invocation-owned LLM stream');
      if (operation === 'llm.stream.next') return stream.iterator.next();
      stream.controller.abort(new Error('Python LLM stream closed'));
      await stream.iterator.return(undefined);
      streams.delete(payload.handle as string);
      return {closed:true};
    }
    throw new TypeError('Unsupported Python LLM operation');
  }
  return {
    async request(operation,payload) {
      const task = dispatch(operation,payload);
      pending.add(task);
      try { return await task; }
      catch (error) { if (error instanceof LlmCapabilityError) return {error:{code:error.code,message:error.message}}; throw error; }
      finally { pending.delete(task); }
    },
    async close() {
      if (closed) return;
      closed = true;
      controller.abort(new Error('Python LLM capability retired'));
      for (const stream of streams.values()) stream.controller.abort(controller.signal.reason);
      await Promise.allSettled([...pending]);
      await Promise.allSettled([...streams.values()].map(stream => stream.iterator.return(undefined)));
      streams.clear();
    },
  };
}
