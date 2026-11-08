import {validateJsonData} from "./json-data.js";
import { jsonValue } from "./json-value.js";
import { validateAttachmentUrl } from "./url-attachment.js";
import { requestAttachments } from "./request-attachments.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { validateModelOptions } from "./model-options.js";
import { acceptsMimeType } from "./mime.js";
import type { LlmModel, LlmProvider, LlmRequest, LlmEmbeddingRequest, LlmEmbeddingSourceRequest, LlmEmbeddingResponse, LlmOption, LlmResponseMetadata, LlmSourceRequest, LlmInputSource, LlmMessage } from "./types.js";

export interface LlmServiceOptions {
  readonly providers: readonly LlmProvider[];
  readonly defaultModel?: string;
}

export interface LlmServiceModel {
  readonly provider: LlmProvider;
  readonly model: LlmModel;
}

export interface LlmServiceRequest extends Omit<LlmRequest, "model"> {
  readonly model?: string;
  readonly maxOutputBytes?: number;
}

export interface LlmServiceSourceRequest extends Omit<LlmSourceRequest, "model"> {
  readonly model?: string;
  readonly maxOutputBytes?: number;
}

export type LlmStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "bytes"; readonly data: Uint8Array }
  | { readonly type: "response"; readonly response: LlmResponseMetadata & { readonly model: string } };

function abortable<Value>(start: () => PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }).then(
      value => { signal.removeEventListener("abort", abort); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(signal.aborted ? signal.reason : error); },
    );
    if (signal.aborted) abort();
  });
}

async function textByteLength(text: string, signal: AbortSignal, maxBytes: number): Promise<number> {
  let size = 0, checkpoint = 0;
  signal.throwIfAborted();
  for (let index = 0; index < text.length; index++) {
    if (index - checkpoint >= 65536) {
      await yieldTurn(signal);
      checkpoint = index;
    }
    const code = text.charCodeAt(index);
    if (code < 128) size++;
    else if (code < 2048) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      size += 4;
      index++;
    } else size += 3;
    if (size > maxBytes) throw new RangeError("LLM output byte limit exceeded");
  }
  signal.throwIfAborted();
  return size;
}

function validateMetadata(value: LlmResponseMetadata): void {
  if (value.toolCalls !== undefined) {
    if (!Array.isArray(value.toolCalls)) throw new TypeError('Invalid LLM tool calls');
    for (const call of value.toolCalls) {
      if (!call || typeof call.name !== 'string' || !call.name || call.id !== undefined && typeof call.id !== 'string') throw new TypeError('Invalid LLM tool call');
      validateOptions({arguments:call.arguments});
    }
  }
  for (const field of [value.usage, value.metadata]) {
    if (field !== undefined && (!field || typeof field !== "object" || Array.isArray(field))) throw new TypeError("Invalid LLM response metadata");
  }
}

function validateOptions(options: Readonly<Record<string, LlmOption>>): void {
  for (const [key, value] of Object.entries(options)) {
    if (!key) throw new TypeError("Invalid model option: empty name");
    validateJsonData(value, `Invalid model option ${key}: expected finite JSON data`);
  }
}

function validateMessages(messages: readonly LlmMessage<unknown, unknown>[] | undefined, model: LlmModel): void {
  for (const message of messages ?? []) {
    if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new TypeError('Invalid LLM message');
    if (message.role === 'tool' || message.toolCalls?.length) {
      if (!model.capabilities?.includes('tools')) throw new Error(`Model ${model.id} does not support tools`);
    }
    if (message.role === 'tool') {
      if (typeof message.toolCallId !== 'string' || !message.toolCallId || message.attachments?.length) throw new TypeError('Invalid LLM tool result message');
    } else if (message.toolCallId !== undefined) throw new TypeError('toolCallId requires a tool message');
    if (message.toolCalls !== undefined) {
      if (message.role !== 'assistant') throw new TypeError('toolCalls requires an assistant message');
      validateMetadata({toolCalls:message.toolCalls});
    }
  }
}

function validateTools(request: Pick<LlmRequest, 'tools'>, model: LlmModel): void {
  if (request.tools === undefined) return;
  if (!Array.isArray(request.tools)) throw new TypeError('Invalid LLM tools');
  if (request.tools.length && !model.capabilities?.includes('tools')) throw new Error(`Model ${model.id} does not support tools`);
  for (const tool of request.tools) {
    if (!tool || typeof tool.name !== 'string' || !tool.name || tool.description != null && typeof tool.description !== 'string' || !tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) throw new TypeError('Invalid LLM tool definition');
    validateOptions(tool.inputSchema);
  }
}

async function* streamResult(completion: () => AsyncIterable<string | Uint8Array, LlmResponseMetadata | void>, model: LlmModel, request: { readonly signal: AbortSignal; readonly maxOutputBytes?: number }): AsyncGenerator<LlmStreamEvent> {
      const limit = request.maxOutputBytes ?? Infinity;
      if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError("Invalid LLM output limit");
      const iterator = completion()[Symbol.asyncIterator]();
      let ended = false;
      let size = 0;
      try {
        while (true) {
          request.signal.throwIfAborted();
          const result = await abortable(() => iterator.next(), request.signal);
          request.signal.throwIfAborted();
          if (result.done) {
            ended = true;
            const metadata: unknown = result.value;
            if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) throw new TypeError("Invalid LLM response metadata");
            const details = metadata as LlmResponseMetadata | undefined;
            if (details) validateMetadata(details);
            if (details?.toolCalls) for await (const bytes of jsonValue(details.toolCalls, request.signal)) {
              size += bytes.byteLength;
              if (size > limit) throw new RangeError('LLM output byte limit exceeded');
            }
            yield { type: "response", response: { model: model.id, ...(details?.toolCalls ? {toolCalls:details.toolCalls} : {}), ...(details?.usage ? { usage: details.usage } : {}), ...(details?.metadata ? { metadata: details.metadata } : {}) } };
            return;
          }
          const chunk = result.value;
          const text = (model.outputType ?? "text/plain").toLowerCase().startsWith("text/");
          if (text ? typeof chunk !== "string" : !(chunk instanceof Uint8Array)) throw new TypeError("Provider returned an incompatible LLM output chunk");
          size += typeof chunk === "string" ? await textByteLength(chunk, request.signal, limit - size) : chunk.byteLength;
          request.signal.throwIfAborted();
          if (size > limit) throw new RangeError("LLM output byte limit exceeded");
          yield typeof chunk === "string" ? { type: "text", text: chunk } : { type: "bytes", data: new Uint8Array(chunk) };
        }
      } finally {
        if (!ended) {
          const closing = Promise.resolve().then(() => iterator.return?.());
          if (request.signal.aborted) void closing.catch(() => undefined);
          else await abortable(() => closing, request.signal);
        }
      }
}

function validateEmbeddingResponse(result: LlmEmbeddingResponse, model: string, count: number): void {
  if (!result || result.model !== model || !Array.isArray(result.vectors) || result.vectors.length !== count || Array.from(result.vectors).some(vector => !Array.isArray(vector) || !vector.length || Array.from(vector).some(value => typeof value !== "number" || !Number.isFinite(value)) || vector.length !== result.vectors[0]?.length)) throw new TypeError("Invalid embedding response");
  validateMetadata(result);
}

/** Structured host API shared by shell and other language front ends. */
export interface LlmService {
  readonly version: 1;
  readonly models: readonly LlmServiceModel[];
  resolve(model?: string, options?: {readonly async?: boolean}): LlmServiceModel;
  complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array, LlmResponseMetadata | void>;
  stream(request: LlmServiceRequest): AsyncIterable<LlmStreamEvent>;
  streamSources?(request: LlmServiceSourceRequest): AsyncIterable<LlmStreamEvent>;
  embedSources?(request: Omit<LlmEmbeddingSourceRequest, "model"> & { readonly model?: string }): Promise<LlmEmbeddingResponse>;
  embed(request: Omit<LlmEmbeddingRequest, "model"> & { readonly model?: string }): Promise<LlmEmbeddingResponse>;
}

function snapshotModel(declared: LlmModel): LlmModel {
  return Object.freeze({ ...declared,
    ...(declared.options ? { options: Object.freeze(Object.fromEntries(Object.entries(declared.options).map(([name, rule]) => [name, Object.freeze({ ...rule })]))) } : {}),
    ...(declared.capabilities ? { capabilities: Object.freeze([...declared.capabilities]) } : {}),
    ...(declared.aliases ? { aliases: Object.freeze([...declared.aliases]) } : {}),
    ...(declared.attachmentTypes ? { attachmentTypes: Object.freeze([...declared.attachmentTypes]) } : {}),
  });
}

export function createLlmService(options: LlmServiceOptions): LlmService {
  const models: LlmServiceModel[] = [];
  const lookup = new Map<string, LlmServiceModel>();
  const asyncLookup = new Map<string, LlmServiceModel>();
  const defaultModel = options.defaultModel;
  for (const provider of options.providers) {
    if (!provider.name || typeof provider.complete !== "function") throw new TypeError("Providers require a name and complete function");
    for (const declared of provider.models) {
      if (!declared.id) throw new TypeError("Models require a nonempty id");
      const {asyncModel: asyncDeclaration, ...syncDeclaration} = declared;
      if (asyncDeclaration !== undefined && (!asyncDeclaration || typeof asyncDeclaration !== "object" || Array.isArray(asyncDeclaration)
        || ["id", "aliases", "asyncModel"].some(key => key in asyncDeclaration))) throw new TypeError("Invalid paired async model definition");
      const paired = asyncDeclaration === undefined ? undefined : snapshotModel({
        ...syncDeclaration, displayName: `${provider.name} (async): ${declared.id}`, ...asyncDeclaration
      });
      const {id: ignoredId, aliases: ignoredAliases, ...pairedMetadata} = paired ?? {id: declared.id};
      const model = snapshotModel({...syncDeclaration, ...(paired ? {asyncModel: Object.freeze(pairedMetadata)} : {})});
      const entry = Object.freeze({ provider, model });
      const asyncEntry = paired ? Object.freeze({provider, model: paired}) : undefined;
      for (const name of new Set([model.id, `${provider.name}/${model.id}`, ...model.aliases ?? []])) {
        if (!name) throw new TypeError("Model aliases must not be empty");
        if (lookup.has(name)) throw new Error(`Duplicate model id or alias: ${name}`);
        lookup.set(name, entry);
        if (asyncEntry) asyncLookup.set(name, asyncEntry);
      }
      models.push(entry);
    }
  }
  return Object.freeze({
    version: 1 as const,
    models: Object.freeze(models),
    resolve(model?: string, mode?: {readonly async?: boolean}): LlmServiceModel {
      const selected = model ?? defaultModel;
      if (selected === undefined) throw new Error("No model selected; use --model or configure defaultModel");
      const entry = (mode?.async ? asyncLookup : lookup).get(selected);
      if (!entry) throw new Error(mode?.async && lookup.has(selected)
        ? `Unknown async model (sync model exists): ${selected}` : `Unknown model: ${selected}`);
      return entry;
    },
    complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array, LlmResponseMetadata | void> {
      request.signal.throwIfAborted();
      validateOptions(request.options);
      if (typeof request.prompt !== "string" || request.system !== undefined && typeof request.system !== "string") throw new TypeError("Invalid LLM prompt");
      const entry = this.resolve(request.model, request);
      validateTools(request, entry.model);
      if (request.messages?.length && !entry.model.capabilities?.includes("messages")) throw new Error(`Model ${entry.model.id} does not support messages`);
      validateMessages(request.messages, entry.model);
      if (request.messages?.some(message => typeof message.content !== "string")) throw new TypeError("Invalid LLM message");
      if (request.schema !== undefined) {
        if (!entry.model.capabilities?.includes("schema")) throw new Error(`Model ${entry.model.id} does not support schema`);
        if (!request.schema || typeof request.schema !== "object" || Array.isArray(request.schema)) throw new TypeError("Invalid LLM schema");
      }
      for (const attachment of requestAttachments(request)) {
        if (attachment.url !== undefined) {
          if (attachment.bytes !== undefined) throw new TypeError("Invalid LLM attachment: choose bytes or URL");
          validateAttachmentUrl(attachment.url);
          if (!entry.model.attachmentUrls) throw new Error(`Model ${entry.model.id} does not support URL attachments`);
        }
        if (!acceptsMimeType(entry.model.attachmentTypes ?? [], attachment.mimeType)) {
          throw new Error(`Model ${entry.model.id} does not accept ${attachment.mimeType}`);
        }
      }
      const { maxOutputBytes: ignoredMaxOutputBytes, ...input } = request;
      return entry.provider.complete({ ...input, ...(entry.model.canStream === false ? {stream: false} : {}), model: entry.model.id, options: validateModelOptions(entry.model, request.options) });
    },
    async *stream(request: LlmServiceRequest): AsyncGenerator<LlmStreamEvent> {
      const entry = this.resolve(request.model, request);
      yield* streamResult(() => this.complete(request), entry.model, request);
    },
    async *streamSources(request: LlmServiceSourceRequest): AsyncGenerator<LlmStreamEvent> {
      const sources = new Set<LlmInputSource>([request.prompt, ...request.system === undefined ? [] : [request.system], ...request.messages?.map(message => message.content) ?? [], ...Array.from(requestAttachments(request)).flatMap(attachment => attachment.source ? [attachment.source] : [])]);
      let closing: Promise<void> | undefined, failed = false;
      const close = (): Promise<void> => closing ??= Promise.allSettled([...sources].map(source => Promise.resolve().then(() => source.dispose()))).then(results => {
        const rejected = results.find(result => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
      });
      const abort = (): void => { void close().catch(() => undefined); };
      request.signal.addEventListener("abort", abort, { once: true });
      try {
        request.signal.throwIfAborted();
        validateOptions(request.options);
        const entry = this.resolve(request.model, request);
        if (!entry.provider.completeSources || entry.model.inputSources === false) throw new Error(`Model ${entry.model.id} does not support streamed inputs`);
        for (const source of sources) if (!source || typeof source.dispose !== "function" || typeof source.bytes?.[Symbol.asyncIterator] !== "function") throw new TypeError("Invalid LLM input source");
        validateTools(request, entry.model);
        if (request.messages?.length && !entry.model.capabilities?.includes("messages")) throw new Error(`Model ${entry.model.id} does not support messages`);
        validateMessages(request.messages, entry.model);
        if (request.schema !== undefined) {
          if (!entry.model.capabilities?.includes("schema")) throw new Error(`Model ${entry.model.id} does not support schema`);
          if (!request.schema || typeof request.schema !== "object" || Array.isArray(request.schema)) throw new TypeError("Invalid LLM schema");
        }
        for (const attachment of requestAttachments(request)) {
          if (attachment.url === undefined && !attachment.source) throw new TypeError("Invalid LLM attachment source");
          if (attachment.url !== undefined) {
            if (attachment.source !== undefined) throw new TypeError("Invalid LLM attachment: choose source or URL");
            validateAttachmentUrl(attachment.url);
            if (!entry.model.attachmentUrls) throw new Error(`Model ${entry.model.id} does not support URL attachments`);
          }
          if (!acceptsMimeType(entry.model.attachmentTypes ?? [], attachment.mimeType)) throw new Error(`Model ${entry.model.id} does not accept ${attachment.mimeType}`);
        }
        const { maxOutputBytes: ignoredMaxOutputBytes, ...input } = request;
        yield* streamResult(() => entry.provider.completeSources!({ ...input, ...(entry.model.canStream === false ? {stream: false} : {}), model: entry.model.id, options: validateModelOptions(entry.model, request.options) }), entry.model, request);
      } catch (error) {
        failed = true;
        throw request.signal.aborted ? request.signal.reason : error;
      } finally {
        request.signal.removeEventListener("abort", abort);
        await close().catch(error => { if (!failed) throw error; });
      }
    },
    async embedSources(request: Omit<LlmEmbeddingSourceRequest, "model"> & { readonly model?: string }): Promise<LlmEmbeddingResponse> {
      const sources = new Set(request.inputs);
      let closing: Promise<void> | undefined, failed = false;
      const close = (): Promise<void> => closing ??= Promise.allSettled([...sources].map(source => Promise.resolve().then(() => source.dispose()))).then(results => {
        const rejected = results.find(result => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
      });
      const abort = (): void => { void close().catch(() => undefined); };
      request.signal.addEventListener("abort", abort, { once: true });
      try {
        request.signal.throwIfAborted();
        validateOptions(request.options);
        const entry = this.resolve(request.model);
        if (!entry.model.capabilities?.includes("embed") || !entry.provider.embedSources) throw new Error(`Model ${entry.model.id} does not support streamed embeddings`);
        if (request.binary !== undefined && typeof request.binary !== "boolean") throw new TypeError("Invalid embedding binary flag");
        if (request.inputTypes !== undefined) {
          if (request.binary !== undefined || !Array.isArray(request.inputTypes) || request.inputTypes.length !== request.inputs.length || Array.from(request.inputTypes).some(kind => kind !== "text" && kind !== "binary")) throw new TypeError("Invalid embedding input types");
          if (!entry.model.capabilities?.includes("embed-mixed")) throw new Error(`Model ${entry.model.id} does not support mixed embedding inputs`);
        }
        if ((request.binary || request.inputTypes?.includes("binary")) && !entry.model.capabilities?.includes("embed-binary")) throw new Error(`Model ${entry.model.id} does not support binary embeddings`);
        if (!Array.isArray(request.inputs) || [...sources].some(source => !source || typeof source.dispose !== "function" || typeof source.bytes?.[Symbol.asyncIterator] !== "function")) throw new TypeError("Invalid embedding input source");
        const result = await abortable(() => entry.provider.embedSources!({ ...request, model: entry.model.id, options: validateModelOptions(entry.model, request.options) }), request.signal);
        request.signal.throwIfAborted();
        validateEmbeddingResponse(result, entry.model.id, request.inputs.length);
        return result;
      } catch (error) {
        failed = true;
        throw request.signal.aborted ? request.signal.reason : error;
      } finally {
        request.signal.removeEventListener("abort", abort);
        await close().catch(error => { if (!failed) throw error; });
      }
    },
    async embed(request: Omit<LlmEmbeddingRequest, "model"> & { readonly model?: string }): Promise<LlmEmbeddingResponse> {
      request.signal.throwIfAborted();
      validateOptions(request.options);
      if (!Array.isArray(request.inputs) || Array.from(request.inputs).some(input => typeof input !== "string")) throw new TypeError("Embedding inputs must be strings");
      const entry = this.resolve(request.model);
      if (!entry.model.capabilities?.includes("embed") || !entry.provider.embed) throw new Error(`Model ${entry.model.id} does not support embeddings`);
      const embed = entry.provider.embed.bind(entry.provider);
      const result = await abortable(() => embed({ ...request, model: entry.model.id, options: validateModelOptions(entry.model, request.options) }), request.signal);
      request.signal.throwIfAborted();
      validateEmbeddingResponse(result, entry.model.id, request.inputs.length);
      return result;
    },
  });
}
