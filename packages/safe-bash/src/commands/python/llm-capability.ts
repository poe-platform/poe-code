import type { CommandContext } from '../../contracts/index.js';
import type { LlmService, LlmServiceRequest, LlmServiceSourceRequest } from '../llm/service.js';
import type { LlmOption, LlmInputSource } from '../llm/types.js';
import { getLlmModelAliases, createLlmConfiguration, createLlmTemplateStore, evaluateLlmTemplate, llmTemplateUsesInput, validateLlmTemplateParameters } from 'safe-bash-command-llm';
import { sniffMimeType } from '../llm/mime.js';
import { pathOf } from '../internal.js';
import type { PythonHostCapability, PythonHostValue } from './host-capabilities.js';

function record(value: PythonHostValue): {readonly [key:string]:PythonHostValue} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a structured Python LLM request');
  return value as {readonly [key:string]:PythonHostValue};
}

/** Count the wire representation before retaining/serializing host metadata. */
function jsonBytes(value: PythonHostValue, limit: number): number {
  if (limit === Infinity) return 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const add = (size: number): void => {
    if (size > limit - bytes) throw new RangeError('Python LLM serialized response limit exceeded');
    bytes += size;
  };
  const string = (text: string): void => {
    add(2);
    if (text.length > limit - bytes) throw new RangeError('Python LLM serialized response limit exceeded');
    for (let i = 0; i < text.length; i++) {
      const point = text.codePointAt(i)!;
      if (point > 65535) { add(4); i++; }
      else if (point === 34 || point === 92) add(2);
      else if (point < 32) add([8, 9, 10, 12, 13].includes(point) ? 2 : 6);
      else if (point >= 0xd800 && point <= 0xdfff) add(6);
      else add(point < 128 ? 1 : point < 2048 ? 2 : 3);
    }
  };
  const visit = (item: PythonHostValue): void => {
    if (typeof item === 'string') { string(item); return; }
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) {
      add(JSON.stringify(item).length); return;
    }
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw new TypeError('Python LLM response must contain acyclic data');
    ancestors.add(item);
    add(2);
    let entries = 0;
    if (Array.isArray(item)) {
      if (item.length > limit - bytes) throw new RangeError('Python LLM serialized response limit exceeded');
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor || !('value' in descriptor)) throw new TypeError('Python LLM response must contain data');
        if (entries++) add(1);
        visit(descriptor.value);
      }
    } else {
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) throw new TypeError('Python LLM response must contain data');
        if (entries++) add(1);
        string(key); add(1); visit(descriptor.value);
      }
    }
    ancestors.delete(item);
  };
  visit(value);
  return bytes;
}

function* textFragments(text: string, limit: number): Generator<string> {
  let start = 0, bytes = 0;
  for (let i = 0; i < text.length;) {
    const point = text.codePointAt(i)!;
    const width = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (width > limit) throw new RangeError('Python LLM stream chunk limit cannot fit a Unicode scalar');
    if (width > limit - bytes) { yield text.slice(start, i); start = i; bytes = 0; }
    bytes += width;
    i += point > 65535 ? 2 : 1;
  }
  if (start < text.length || !text.length) yield text.slice(start);
}

export interface PythonLlmCapabilityOptions {
  readonly maxStreamChunkBytes?: number;
  readonly maxBufferedResponseBytes?: number;
  readonly maxBufferedEvents?: number;
  readonly maxMetadataBytes?: number;
}

/** Reuses the invocation's authorized service; Python receives only model data. */
export function createPythonLlmCapability(context: Pick<CommandContext, 'fs' | 'cwd' | 'inputBudget'> & Partial<Pick<CommandContext, 'env'>>, service: LlmService, options: PythonLlmCapabilityOptions = {}): PythonHostCapability {
  const chunkBytes = options.maxStreamChunkBytes ?? 16384;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError('Invalid Python LLM stream chunk limit');
  const bufferedLimit = options.maxBufferedResponseBytes ?? Infinity;
  const eventLimit = options.maxBufferedEvents ?? bufferedLimit;
  const metadataLimit = options.maxMetadataBytes ?? bufferedLimit;
  for (const limit of [bufferedLimit, eventLimit, metadataLimit]) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError('Invalid Python LLM host limit');
  }
  const prepare = async (value: PythonHostValue, signal: AbortSignal): Promise<LlmServiceRequest | LlmServiceSourceRequest> => {
    let payload = record(value);
    const timeout = payload.timeout;
    if (timeout !== undefined && timeout !== null) {
      if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2147483647) throw new RangeError('Invalid LLM timeout');
      signal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(timeout * 1000)))]);
    }
    signal.throwIfAborted();
    const configuration = createLlmConfiguration({...context,env:context.env ?? {},signal});
    if (payload.conversation !== undefined && payload.conversation !== null) throw new TypeError('The shared LLM service does not yet support persisted conversation');
    const parameters: Record<string,string> = {};
    for (const [key,item] of Object.entries(record(payload.parameters ?? {}))) {
      if (typeof item !== 'string') throw new TypeError('Template parameters must be strings');
      parameters[key] = item;
    }
    if (payload.template !== undefined && payload.template !== null) {
      if (typeof payload.template !== 'string') throw new TypeError('Template name must be a string');
      const stored = await createLlmTemplateStore({...context,env:context.env ?? {},signal}).load(payload.template);
      validateLlmTemplateParameters(stored,parameters);
      const input = payload.prompt ?? '';
      if (typeof input !== 'string') throw new TypeError('Invalid LLM text input');
      const usesInput = llmTemplateUsesInput(stored);
      const evaluated = evaluateLlmTemplate(stored,usesInput ? input : '',parameters);
      const inputs = payload.attachments ?? [];
      if (!Array.isArray(inputs)) throw new TypeError('Expected canonical LLM attachments');
      payload = {...payload,
        prompt:evaluated.prompt ? !usesInput && input ? `${evaluated.prompt}\n${input}` : evaluated.prompt : input,
        ...(payload.system === undefined && evaluated.system !== undefined ? {system:evaluated.system} : {}),
        ...(payload.model == null && stored.model !== undefined ? {model:stored.model} : {}),
        options:{...stored.options,...record(payload.options ?? {})},
        attachments:[...(stored.attachments ?? []).map(path => ({path})),
          ...inputs.filter(input => record(input).mimeType === undefined),
          ...(stored.attachment_types ?? []).map(item => ({path:item.value,mimeType:item.type})),
          ...inputs.filter(input => record(input).mimeType !== undefined)],
      };
    } else if (Object.keys(parameters).length) throw new TypeError('Template parameters require a named template');
    const selected = payload.model ?? await configuration.defaultModel();
    if (selected !== undefined && typeof selected !== 'string') throw new TypeError('Model must be a string');
    const identity = selected === undefined ? undefined : await configuration.resolveAlias(selected);
    const {model} = service.resolve(identity);
    payload = {...payload,model:model.id,options:{...await configuration.modelOptions(model.id),...record(payload.options ?? {})}};
    signal.throwIfAborted();
    const limit = payload.max_response_bytes;
    if (limit !== undefined && limit !== null && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Invalid LLM response limit');
    const attachments: {mimeType:string;source:LlmInputSource}[] = [];
    const sources: LlmInputSource[] = [];
    const inputLimit = context.inputBudget?.maxBytes ?? Infinity;
    let admitted = 0, consumed = 0;
    const textSource = (text: string): LlmInputSource => {
      if (typeof text !== 'string') throw new TypeError('Invalid LLM text input');
      const controller = new AbortController();
      const bytes = (async function* () {
        for (const fragment of textFragments(text, 16384)) { signal.throwIfAborted(); controller.signal.throwIfAborted(); yield new TextEncoder().encode(fragment); }
      })();
      return {bytes, async dispose() { controller.abort(); await bytes.return(); }};
    };
    const inputs = payload.attachments ?? [];
    if (!Array.isArray(inputs)) throw new TypeError('Expected canonical LLM attachments');
    try {
      if (inputs.length) {
        if (!service.streamSources) throw new TypeError('Shared LLM service does not support streamed attachments');
        const {model,provider} = service.resolve(payload.model == null ? undefined : payload.model as string);
        if (!provider.completeSources || model.inputSources === false) throw new Error(`Model ${model.id} does not support streamed inputs`);
      }
      for (const value of inputs) {
        const attachment = record(value);
        if (typeof attachment.path !== 'string' || !attachment.path || attachment.path.includes('\0') || attachment.path.includes('://')) throw new TypeError('Attachment requires a canonical filesystem path');
        if (attachment.mimeType !== undefined && typeof attachment.mimeType !== 'string') throw new TypeError('Invalid attachment MIME type');
        const path = pathOf(context, attachment.path);
        const capabilities = await context.fs.capabilitiesFor?.(path, {signal}) ?? context.fs.capabilities;
        signal.throwIfAborted();
        if (capabilities.retainedRead !== true || !context.fs.openReadFile) throw new TypeError('Canonical attachment filesystem requires retained reads');
        const handle = await context.fs.openReadFile(path, {signal});
        const controller = new AbortController();
        const readSignal = AbortSignal.any([signal, controller.signal]);
        let closing: Promise<void> | undefined;
        const source: LlmInputSource = {bytes:(async function* () {
          for (let offset = 0;;) {
            readSignal.throwIfAborted();
            const chunk = await handle.read(offset, Math.min(16384, inputLimit - consumed + 1), {signal:readSignal});
            readSignal.throwIfAborted();
            if (!chunk.byteLength) break;
            if (chunk.byteLength > inputLimit - consumed) throw new RangeError('LLM input byte limit exceeded');
            consumed += chunk.byteLength;
            context.inputBudget?.check(consumed);
            offset += chunk.byteLength;
            yield chunk;
          }
        })(), dispose() {
          controller.abort();
          return closing ??= handle.close();
        }};
        sources.push(source);
        const stat = await handle.stat({signal});
        if (stat.size > inputLimit - admitted) throw new RangeError('LLM input byte limit exceeded');
        admitted += stat.size;
        context.inputBudget?.check(admitted);
        let mimeType = attachment.mimeType as string | undefined;
        if (mimeType === undefined) {
          const remaining = inputLimit - (admitted - stat.size);
          const prefix = await handle.read(0, Math.min(4096, remaining + 1), {signal});
          if (prefix.byteLength > remaining) throw new RangeError('LLM input byte limit exceeded');
          mimeType = sniffMimeType(path, prefix);
        }
        signal.throwIfAborted();
        attachments.push({mimeType,source});
      }
      if (attachments.length) return {
        prompt:textSource(payload.prompt === undefined ? '' : payload.prompt as string),
        ...(payload.model == null ? {} : {model:payload.model as string}),
        ...(payload.system === undefined ? {} : {system:textSource(payload.system as string)}),
        ...(payload.messages === undefined ? {} : {messages:(payload.messages as unknown as {role:'system'|'user'|'assistant';content:string}[]).map(message => ({role:message.role,content:textSource(message.content)}))}),
        ...(payload.schema === undefined ? {} : {schema:record(payload.schema)}),
        options:record(payload.options ?? {}) as Readonly<Record<string,LlmOption>>,
        attachments, signal, ...(limit == null ? {} : {maxOutputBytes:limit as number}),
      };
    } catch (error) {
      await Promise.allSettled(sources.map(source => source.dispose()));
      throw error;
    }
    return {
      prompt:payload.prompt === undefined ? '' : payload.prompt as string,
      ...(payload.model == null ? {} : {model:payload.model as string}),
      ...(payload.system === undefined ? {} : {system:payload.system as string}),
      ...(payload.messages === undefined ? {} : {messages:payload.messages as unknown as NonNullable<LlmServiceRequest['messages']>}),
      ...(payload.schema === undefined ? {} : {schema:record(payload.schema)}),
      options:record(payload.options ?? {}) as Readonly<Record<string,LlmOption>>,
      attachments:[], signal, ...(limit == null ? {} : {maxOutputBytes:limit as number}),
    };
  };
  const responses = async function* (value:PythonHostValue, signal:AbortSignal, ceiling = Infinity) {
    const prepared = await prepare(value, signal);
    const request = {...prepared, maxOutputBytes:Math.min(prepared.maxOutputBytes ?? Infinity, ceiling)};
    if (typeof request.prompt === 'string') {
      for await (const event of service.stream(request as LlmServiceRequest)) yield {event,signal:request.signal};
      return;
    }
    const streamed = request as LlmServiceSourceRequest;
    try { for await (const event of service.streamSources!(streamed)) yield {event,signal:request.signal}; }
    finally {
      await Promise.allSettled([streamed.prompt, ...streamed.system ? [streamed.system] : [], ...streamed.messages?.map(message => message.content) ?? [], ...streamed.attachments.map(attachment => attachment.source)].map(source => source.dispose()));
    }
  };
  const events = async function* (value:PythonHostValue, {signal}:{readonly signal:AbortSignal}):AsyncGenerator<PythonHostValue> {
    for await (const {event,signal:operationSignal} of responses(value,signal)) {
      if (event.type === 'bytes') {
        for (let offset = 0; offset < event.data.length; offset += chunkBytes) {
          operationSignal.throwIfAborted();
          yield {type:'bytes',data:Array.from(event.data.subarray(offset,offset + chunkBytes))};
        }
      }
      else if (event.type === 'text') {
        for (const text of textFragments(event.text, chunkBytes)) {
          operationSignal.throwIfAborted();
          yield {type:'text', text};
        }
      } else {
        jsonBytes(event.response as unknown as PythonHostValue, metadataLimit);
        yield event as unknown as PythonHostValue;
      }
    }
  };
  return {
    async call(value, {signal}) {
      signal.throwIfAborted();
      const operation = record(value);
      const payload = record(operation.payload ?? {});
      if (operation.operation === 'models') {
        const configuration = createLlmConfiguration({...context,env:context.env ?? {},signal});
        const aliases = await configuration.aliases();
        const models = service.models.map(entry => ({
          id:entry.model.id,aliases:getLlmModelAliases(entry,aliases),capabilities:[...entry.model.capabilities ?? []],
          metadata:{provider:entry.provider.name,attachmentTypes:[...entry.model.attachmentTypes ?? []],outputType:entry.model.outputType ?? 'text/plain'},
        }));
        jsonBytes(models,bufferedLimit);
        return models;
      }
      if (operation.operation === 'configuration') {
        const configuration = createLlmConfiguration({...context,env:context.env ?? {},signal});
        const result = {default_model:await configuration.defaultModel() ?? null,aliases:await configuration.aliases(),model_options:await configuration.allModelOptions()};
        jsonBytes(result,bufferedLimit);
        return result;
      }
      if (operation.operation === 'embed') {
        const prepared = await prepare(payload,signal);
        return await service.embed({model:prepared.model!,inputs:payload.inputs as readonly string[],options:prepared.options,signal:prepared.signal}) as unknown as PythonHostValue;
      }
      if (operation.operation !== 'complete') throw new TypeError('Unsupported Python LLM operation');
      let text = '', textBytes = 0, dataBytes = 0, received = 0;
      const data:number[] = [];
      let response: Record<string,PythonHostValue> = {};
      let envelopeBytes = jsonBytes({text:'', data:[]}, bufferedLimit);
      const admit = (size: number): void => {
        if (size > bufferedLimit - envelopeBytes - textBytes - dataBytes) throw new RangeError('Python LLM buffered response limit exceeded');
      };
      for await (const {event,signal:operationSignal} of responses(payload, signal, bufferedLimit)) {
        operationSignal.throwIfAborted();
        if (++received > eventLimit) throw new RangeError('Python LLM buffered event limit exceeded');
        if (event.type === 'text') {
          const size = bufferedLimit === Infinity || !event.text ? 0 : jsonBytes(event.text, bufferedLimit - envelopeBytes - textBytes - dataBytes + 2) - 2;
          admit(size);
          textBytes += size;
          if (event.text) text += event.text;
        } else if (event.type === 'bytes') {
          let size = 0;
          if (bufferedLimit !== Infinity) for (let i = 0; i < event.data.length; i++) {
            size += String(event.data[i]!).length + (data.length || i ? 1 : 0);
            admit(size);
          }
          dataBytes += size;
          for (const byte of event.data) data.push(byte);
        } else {
          jsonBytes(event.response as unknown as PythonHostValue, metadataLimit);
          const details = record(event.response as unknown as PythonHostValue);
          const size = jsonBytes({...details, text:'', data:[]}, bufferedLimit);
          if (size > bufferedLimit - textBytes - dataBytes) throw new RangeError('Python LLM buffered response limit exceeded');
          envelopeBytes = size;
          response = {...details};
        }
      }
      return {...response,text,data};
    },
    stream:events,
  };
}
