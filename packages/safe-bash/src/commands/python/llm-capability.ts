import type { CommandContext } from '../../contracts/index.js';
import type { LlmService, LlmServiceRequest } from '../llm/service.js';
import type { LlmOption } from '../llm/types.js';
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
export function createPythonLlmCapability(context: Pick<CommandContext, 'fs' | 'cwd' | 'inputBudget'>, service: LlmService, options: PythonLlmCapabilityOptions = {}): PythonHostCapability {
  const chunkBytes = options.maxStreamChunkBytes ?? 16384;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError('Invalid Python LLM stream chunk limit');
  const bufferedLimit = options.maxBufferedResponseBytes ?? Infinity;
  const eventLimit = options.maxBufferedEvents ?? bufferedLimit;
  const metadataLimit = options.maxMetadataBytes ?? bufferedLimit;
  for (const limit of [bufferedLimit, eventLimit, metadataLimit]) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError('Invalid Python LLM host limit');
  }
  const prepare = async (value: PythonHostValue, signal: AbortSignal): Promise<LlmServiceRequest> => {
    const payload = record(value);
    for (const key of ['template', 'conversation']) {
      if (payload[key] !== undefined && payload[key] !== null) throw new TypeError(`The shared LLM service does not yet support persisted ${key}`);
    }
    if (payload.parameters !== undefined && Object.keys(record(payload.parameters)).length) throw new TypeError('Template parameters require shared-service template support');
    const timeout = payload.timeout;
    if (timeout !== undefined && timeout !== null) {
      if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2147483647) throw new RangeError('Invalid LLM timeout');
      signal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(timeout * 1000)))]);
    }
    signal.throwIfAborted();
    const limit = payload.max_response_bytes;
    if (limit !== undefined && limit !== null && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Invalid LLM response limit');
    const attachments: {mimeType:string;bytes:Uint8Array}[] = [];
    const inputLimit = context.inputBudget?.maxBytes ?? Infinity;
    let inputBytes = 0;
    const checkInput = (size:number):void => {
      if (size > inputLimit - inputBytes) throw new RangeError('LLM input byte limit exceeded');
      context.inputBudget?.check(inputBytes + size);
    };
    const inputs = payload.attachments ?? [];
    if (!Array.isArray(inputs)) throw new TypeError('Expected canonical LLM attachments');
    for (const value of inputs) {
      const attachment = record(value);
      if (typeof attachment.path !== 'string' || !attachment.path || attachment.path.includes('\0') || attachment.path.includes('://')) throw new TypeError('Attachment requires a canonical filesystem path');
      if (attachment.mimeType !== undefined && typeof attachment.mimeType !== 'string') throw new TypeError('Invalid attachment MIME type');
      const path = pathOf(context, attachment.path);
      const stat = await context.fs.stat(path, {signal});
      checkInput(stat.size);
      const bytes = await context.fs.readFile(path, {signal, ...(inputLimit === Infinity ? {} : {maxBytes:inputLimit - inputBytes})});
      signal.throwIfAborted();
      checkInput(bytes.byteLength);
      inputBytes += bytes.byteLength;
      attachments.push({mimeType:attachment.mimeType as string | undefined ?? sniffMimeType(path,bytes), bytes:new Uint8Array(bytes)});
    }
    return {
      prompt:payload.prompt === undefined ? '' : payload.prompt as string,
      ...(payload.model == null ? {} : {model:payload.model as string}),
      ...(payload.system === undefined ? {} : {system:payload.system as string}),
      ...(payload.messages === undefined ? {} : {messages:payload.messages as unknown as NonNullable<LlmServiceRequest['messages']>}),
      ...(payload.schema === undefined ? {} : {schema:record(payload.schema)}),
      options:record(payload.options ?? {}) as Readonly<Record<string,LlmOption>>,
      attachments, signal, ...(limit == null ? {} : {maxOutputBytes:limit as number}),
    };
  };
  const events = async function* (value:PythonHostValue, {signal}:{readonly signal:AbortSignal}):AsyncGenerator<PythonHostValue> {
    const request = await prepare(value,signal);
    for await (const event of service.stream(request)) {
      if (event.type === 'bytes') {
        for (let offset = 0; offset < event.data.length; offset += chunkBytes) {
          request.signal.throwIfAborted();
          yield {type:'bytes',data:Array.from(event.data.subarray(offset,offset + chunkBytes))};
        }
      }
      else if (event.type === 'text') {
        for (const text of textFragments(event.text, chunkBytes)) {
          request.signal.throwIfAborted();
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
      if (operation.operation === 'models') return service.models.map(({provider,model}) => ({
        id:model.id, aliases:[...model.aliases ?? []], capabilities:[...model.capabilities ?? []],
        metadata:{provider:provider.name, attachmentTypes:[...model.attachmentTypes ?? []], outputType:model.outputType ?? 'text/plain'},
      }));
      if (operation.operation === 'embed') {
        return await service.embed({...(payload.model == null ? {} : {model:payload.model as string}),
          inputs:payload.inputs as readonly string[], options:record(payload.options ?? {}) as Readonly<Record<string,LlmOption>>, signal}) as unknown as PythonHostValue;
      }
      if (operation.operation !== 'complete') throw new TypeError('Unsupported Python LLM operation');
      const request = await prepare(payload, signal);
      const bounded = {...request, maxOutputBytes:Math.min(request.maxOutputBytes ?? Infinity, bufferedLimit)};
      let text = '', textBytes = 0, dataBytes = 0, received = 0;
      const data:number[] = [];
      let response: Record<string,PythonHostValue> = {};
      let envelopeBytes = jsonBytes({text:'', data:[]}, bufferedLimit);
      const admit = (size: number): void => {
        if (size > bufferedLimit - envelopeBytes - textBytes - dataBytes) throw new RangeError('Python LLM buffered response limit exceeded');
      };
      for await (const event of service.stream(bounded)) {
        bounded.signal.throwIfAborted();
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
