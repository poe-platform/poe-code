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

/** Reuses the invocation's authorized service; Python receives only model data. */
export function createPythonLlmCapability(context: Pick<CommandContext, 'fs' | 'cwd' | 'inputBudget'>, service: LlmService, options: {readonly maxStreamChunkBytes?:number} = {}): PythonHostCapability {
  const chunkBytes = options.maxStreamChunkBytes ?? 16384;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError('Invalid Python LLM stream chunk limit');
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
      else yield event as unknown as PythonHostValue;
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
      const text:string[] = [], data:number[] = [];
      let response: Record<string,PythonHostValue> = {};
      for await (const value of events(payload,{signal})) {
        const event = record(value);
        if (event.type === 'text') text.push(event.text as string);
        else if (event.type === 'bytes') for (const byte of event.data as readonly number[]) data.push(byte);
        else if (event.type === 'response') response = {...record(event.response!)};
      }
      return {...response,text:text.join(''),data};
    },
    stream:events,
  };
}
