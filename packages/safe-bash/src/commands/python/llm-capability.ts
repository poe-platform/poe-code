import type { CommandContext } from '../../contracts/index.js';
import type { LlmService, LlmServiceRequest, LlmServiceSourceRequest } from '../llm/service.js';
import type { LlmOption, LlmInputSource } from '../llm/types.js';
import { loadLlmStoredSchema, selectLlmModelByQuery, getLlmModelAliases, createLlmConfiguration, createLlmTemplateStore, evaluateLlmTemplate, findExtractedRange, llmTemplateUsesInput, validateLlmTemplateParameters, type LlmTemplateLoader } from 'safe-bash-command-llm';
import { sniffMimeType } from '../llm/mime.js';
import { pathOf } from '../internal.js';
import type { PythonHostCapability, PythonHostValue } from './host-capabilities.js';

function record(value: PythonHostValue): {readonly [key:string]:PythonHostValue} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a structured Python LLM request');
  return value as {readonly [key:string]:PythonHostValue};
}

type PythonLlmContext = Pick<CommandContext, 'fs' | 'cwd' | 'inputBudget'> & Partial<Pick<CommandContext, 'env' | 'capabilities'>> & { readonly fetch?: typeof globalThis.fetch | undefined };

function configurationContext(context: PythonLlmContext, payload: {readonly [key:string]:PythonHostValue}, signal: AbortSignal): Parameters<typeof createLlmTemplateStore>[0] {
  const cwd = payload.cwd === undefined ? context.cwd : payload.cwd;
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0')) throw new TypeError('LLM configuration cwd must be an absolute canonical path');
  const env = {...context.env};
  if (payload.configuration_env !== undefined) {
    for (const [key,value] of Object.entries(record(payload.configuration_env))) {
      if (!['HOME','XDG_CONFIG_HOME','LLM_USER_PATH'].includes(key) || value !== null && typeof value !== 'string') throw new TypeError('Unsupported LLM configuration environment');
      if (value === null) delete env[key];
      else env[key] = value as string;
    }
  }
  return {fs:context.fs,cwd,env,signal,...(context.capabilities ? {capabilities:context.capabilities} : {}),...(context.fetch ? {fetch:context.fetch} : {})};
}

/** Count the wire representation before retaining/serializing host metadata. */
function jsonBytes(value: PythonHostValue, limit: number, subject: 'input' | 'response' = 'response'): number {
  if (limit === Infinity) return 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const add = (size: number): void => {
    if (size > limit - bytes) throw new RangeError(`Python LLM serialized ${subject} limit exceeded`);
    bytes += size;
  };
  const string = (text: string): void => {
    add(2);
    if (text.length > limit - bytes) throw new RangeError(`Python LLM serialized ${subject} limit exceeded`);
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
      if (item.length > limit - bytes) throw new RangeError(`Python LLM serialized ${subject} limit exceeded`);
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
  readonly maxBufferedInputBytes?: number;
  readonly maxBufferedEvents?: number;
  readonly maxMetadataBytes?: number;
  readonly templateLoaders?: ReadonlyMap<string, LlmTemplateLoader>;
  readonly maxRemoteTemplateBytes?: number;
}

/** Reuses the invocation's authorized service; Python receives only model data. */
export function createPythonLlmCapability(context: PythonLlmContext, service: LlmService, options: PythonLlmCapabilityOptions = {}): PythonHostCapability {
  const chunkBytes = options.maxStreamChunkBytes ?? 16384;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError('Invalid Python LLM stream chunk limit');
  const bufferedLimit = options.maxBufferedResponseBytes ?? Infinity;
  const bufferedInputLimit = options.maxBufferedInputBytes ?? Infinity;
  const eventLimit = options.maxBufferedEvents ?? bufferedLimit;
  const metadataLimit = options.maxMetadataBytes ?? bufferedLimit;
  const maxRemoteBytes = options.maxRemoteTemplateBytes ?? (context.inputBudget?.maxBytes === Infinity ? undefined : context.inputBudget?.maxBytes) ?? 1_048_576;
  if (!Number.isSafeInteger(maxRemoteBytes) || maxRemoteBytes < 1) throw new RangeError('Invalid Python LLM remote template limit');
  const templateLoaderOptions = {maxRemoteBytes:Math.min(maxRemoteBytes,bufferedInputLimit),...(options.templateLoaders ? {loaders:options.templateLoaders} : {})};
  for (const limit of [bufferedInputLimit, bufferedLimit, eventLimit, metadataLimit]) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError('Invalid Python LLM host limit');
  }
  const prepare = async (value: PythonHostValue, signal: AbortSignal): Promise<(LlmServiceRequest | LlmServiceSourceRequest) & {readonly extract?: 'first' | 'last'}> => {
    let payload = record(value);
    jsonBytes(payload,bufferedInputLimit,'input');
    const timeout = payload.timeout;
    if (timeout !== undefined && timeout !== null) {
      if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2147483647) throw new RangeError('Invalid LLM timeout');
      signal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(timeout * 1000)))]);
    }
    signal.throwIfAborted();
    const requestContext = configurationContext(context,payload,signal);
    const configuration = createLlmConfiguration(requestContext);
    if (payload.key !== undefined && payload.key !== null && (typeof payload.key !== 'string' || !payload.key || payload.key.includes('\0'))) throw new TypeError('Invalid LLM key');
    const key = typeof payload.key === 'string' ? await configuration.resolveKey(payload.key) : undefined;
    if (payload.conversation !== undefined && payload.conversation !== null) throw new TypeError('The shared LLM service does not yet support persisted conversation');
    const parameters: Record<string,string> = {};
    for (const [key,item] of Object.entries(record(payload.parameters ?? {}))) {
      if (typeof item !== 'string') throw new TypeError('Template parameters must be strings');
      parameters[key] = item;
    }
    if (payload.template !== undefined && payload.template !== null) {
      if (typeof payload.template !== 'string') throw new TypeError('Template name must be a string');
      const stored = await createLlmTemplateStore(requestContext,templateLoaderOptions).load(payload.template);
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
        ...(payload.schema === undefined && stored.schema_object !== undefined ? {schema:stored.schema_object as PythonHostValue} : {}),
        attachments:[...(stored.attachments ?? []).map(path => ({path})),
          ...inputs.filter(input => record(input).mimeType === undefined),
          ...(stored.attachment_types ?? []).map(item => ({path:item.value,mimeType:item.type})),
          ...inputs.filter(input => record(input).mimeType !== undefined)],
        ...(payload.extract === undefined && payload.extract_last === undefined && (stored.extract_last || stored.extract) ? (stored.extract_last ? {extract_last:true} : {extract:true}) : {}),
      };
    } else if (Object.keys(parameters).length) throw new TypeError('Template parameters require a named template');
    const selected = payload.model ?? await configuration.defaultModel();
    if (selected !== undefined && typeof selected !== 'string') throw new TypeError('Model must be a string');
    const identity = selected === undefined ? undefined : await configuration.resolveAlias(selected);
    const {model} = service.resolve(identity);
    payload = {...payload,model:model.id,options:{...await configuration.modelOptions(model.id),...record(payload.options ?? {})}};
    jsonBytes(payload,bufferedInputLimit,'input');
    signal.throwIfAborted();
    if (payload.extract !== undefined && typeof payload.extract !== 'boolean' || payload.extract_last !== undefined && typeof payload.extract_last !== 'boolean') throw new TypeError('Invalid LLM extract option');
    if (payload.stream !== undefined && typeof payload.stream !== 'boolean') throw new TypeError('Invalid LLM stream option');
    const extract:'first'|'last'|undefined = payload.extract_last ? 'last' : payload.extract ? 'first' : undefined;
    const stream = extract ? false : typeof payload.stream === 'boolean' ? payload.stream : true;
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
        const path = pathOf(requestContext, attachment.path);
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
        attachments, signal, stream, ...(key === undefined ? {} : {key}), ...(extract ? {extract} : {}), ...(limit == null ? {} : {maxOutputBytes:limit as number}),
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
      attachments:[], signal, stream, ...(key === undefined ? {} : {key}), ...(extract ? {extract} : {}), ...(limit == null ? {} : {maxOutputBytes:limit as number}),
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
      jsonBytes(payload,bufferedInputLimit,'input');
      if (operation.operation === 'attachment_type') {
        const prefix = payload.prefix;
        if (typeof payload.path !== 'string' || !Array.isArray(prefix) || prefix.length > 4096
          || prefix.some(byte => typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255)) {
          throw new TypeError('Invalid bounded attachment prefix');
        }
        const result = sniffMimeType(payload.path, Uint8Array.from(prefix as number[]));
        jsonBytes(result,bufferedLimit);
        return result;
      }
      if (operation.operation === 'load_schema') {
        const id = payload.schema_id;
        if (typeof id !== 'string' || !id || id.includes('\0')) throw new TypeError('Stored schema ID must be a nonempty string');
        const database = payload.database;
        if (database !== undefined && (typeof database !== 'string' || !database || database.includes('\0'))) throw new TypeError('Schema database must be a nonempty canonical path');
        let admitted = 0;
        const result = await loadLlmStoredSchema(configurationContext(context,payload,signal),id,{
          ...(database === undefined ? {} : {database:database as string}),
          maxBytes:Math.min(bufferedInputLimit,bufferedLimit,context.inputBudget?.maxBytes ?? Infinity),
          admitBytes(size) { admitted += size; context.inputBudget?.check(admitted); },
        }) ?? null;
        jsonBytes(result as PythonHostValue,bufferedLimit);
        return result as PythonHostValue;
      }
      if (operation.operation === 'resolve_model') {
        const configuration = createLlmConfiguration(configurationContext(context,payload,signal));
        const selected = payload.model ?? await configuration.defaultModel();
        if (selected !== undefined && typeof selected !== 'string') throw new TypeError('Model must be a string');
        const identity = selected === undefined ? undefined : await configuration.resolveAlias(selected);
        const resolved = service.resolve(identity).model.id;
        jsonBytes(resolved,bufferedLimit);
        return resolved;
      }
      if (operation.operation === 'select_model') {
        const queries = payload.queries;
        if (!Array.isArray(queries) || !queries.length || queries.some(query => typeof query !== 'string')) throw new TypeError('Model queries must be a nonempty array of strings');
        const configuration = createLlmConfiguration(configurationContext(context,payload,signal));
        const selected = await selectLlmModelByQuery(service.models,queries as string[],await configuration.aliases(),signal);
        jsonBytes(selected.model.id,bufferedLimit);
        return selected.model.id;
      }
      if (operation.operation === 'models') {
        const configuration = createLlmConfiguration(configurationContext(context,payload,signal));
        const aliases = await configuration.aliases();
        const models = service.models.map(entry => ({
          id:entry.model.id,aliases:getLlmModelAliases(entry,aliases),capabilities:[...entry.model.capabilities ?? []],
          metadata:{provider:entry.provider.name,attachmentTypes:[...entry.model.attachmentTypes ?? []],outputType:entry.model.outputType ?? 'text/plain'},
        }));
        jsonBytes(models,bufferedLimit);
        return models;
      }
      if (operation.operation === 'configure') {
        const configuration = createLlmConfiguration(configurationContext(context,payload,signal));
        const required = (name:string):string => {
          const value = payload[name];
          if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError(`Configuration ${name} must be a nonempty string`);
          return value;
        };
        const model = async ():Promise<string> => service.resolve(await configuration.resolveAlias(required('model'))).model.id;
        switch (payload.action) {
          case 'set_default_model': await configuration.setDefaultModel(await model()); break;
          case 'set_alias': await configuration.setAlias(required('name'),await model()); break;
          case 'remove_alias': await configuration.removeAlias(required('name')); break;
          case 'set_model_option': {
            if (typeof payload.value !== 'string') throw new TypeError('Configuration value must be a string');
            await configuration.setModelOption(await model(),required('name'),payload.value); break;
          }
          case 'clear_model_option':
            await configuration.clearModelOption(await model(),payload.name === undefined ? undefined : required('name')); break;
          default: throw new TypeError('Unsupported configuration action');
        }
        return null;
      }
      if (operation.operation === 'configuration') {
        const configuration = createLlmConfiguration(configurationContext(context,payload,signal));
        const result = {default_model:await configuration.defaultModel() ?? null,aliases:await configuration.aliases(),model_options:await configuration.allModelOptions()};
        jsonBytes(result,bufferedLimit);
        return result;
      }
      if (operation.operation === 'embed') {
        const prepared = await prepare(payload,signal);
        const result = await service.embed({model:prepared.model!,inputs:payload.inputs as readonly string[],options:prepared.options,signal:prepared.signal,...(prepared.key === undefined ? {} : {key:prepared.key})});
        prepared.signal.throwIfAborted();
        const {vectors: ignoredVectors, ...metadata} = result;
        jsonBytes(metadata as unknown as PythonHostValue,metadataLimit);
        jsonBytes(result as unknown as PythonHostValue,Math.min(bufferedLimit,prepared.maxOutputBytes ?? Infinity));
        return result as unknown as PythonHostValue;
      }
      if (operation.operation !== 'complete') throw new TypeError('Unsupported Python LLM operation');
      let text = '', textBytes = 0, dataBytes = 0, received = 0;
      const data:number[] = [];
      let response: Record<string,PythonHostValue> = {};
      let envelopeBytes = jsonBytes({text:'', data:[]}, bufferedLimit);
      const admit = (size: number): void => {
        if (size > bufferedLimit - envelopeBytes - textBytes - dataBytes) throw new RangeError('Python LLM buffered response limit exceeded');
      };
      let extract:'first'|'last'|undefined = payload.extract_last ? 'last' : payload.extract ? 'first' : undefined;
      for await (const {event,signal:operationSignal} of (async function* () { const prepared = await prepare(payload, signal); extract = prepared.extract; const request = {...prepared, maxOutputBytes:Math.min(prepared.maxOutputBytes ?? Infinity, bufferedLimit)}; if (typeof request.prompt === 'string') { for await (const event of service.stream(request as LlmServiceRequest)) yield {event,signal:request.signal,extract}; return; } const streamed = request as LlmServiceSourceRequest; try { for await (const event of service.streamSources!(streamed)) yield {event,signal:request.signal,extract}; } finally { await Promise.allSettled([streamed.prompt, ...streamed.system ? [streamed.system] : [], ...streamed.messages?.map(message => message.content) ?? [], ...streamed.attachments.map(attachment => attachment.source)].map(source => source.dispose())); } })()) {
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
      if (extract && text) { const bytes = new TextEncoder().encode(text); const range = await findExtractedRange({size:bytes.byteLength,async read(position,maxBytes) { return bytes.subarray(position,position + maxBytes); }}, extract === 'last', signal); if (range && range.end > range.start) text = new TextDecoder().decode(bytes.subarray(range.start,range.end)); }
      return {...response,text,data};
    },
    stream:events,
  };
}
