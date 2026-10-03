import { validateAttachmentUrl } from "./url-attachment.js";
import { requestAttachments } from "./request-attachments.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { validateModelOptions } from "./model-options.js";
import { acceptsMimeType } from "./mime.js";
import type { LlmModel, LlmProvider, LlmRequest, LlmEmbeddingRequest, LlmEmbeddingSourceRequest, LlmEmbeddingResponse, LlmOption, LlmResponseMetadata, LlmSourceRequest, LlmInputSource } from "./types.js";

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
  for (const field of [value.usage, value.metadata]) {
    if (field !== undefined && (!field || typeof field !== "object" || Array.isArray(field))) throw new TypeError("Invalid LLM response metadata");
  }
}

function validateOptions(options: Readonly<Record<string, LlmOption>>): void {
  const ancestors = new Set<object>();
  function visit(value: unknown, key: string): void {
    const fail = (): never => { throw new TypeError(`Invalid model option ${key}: expected finite JSON data`); };
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object" || ancestors.has(value)) return fail();
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return fail();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          const property = Object.getOwnPropertyDescriptor(value, index);
          if (!property || !("value" in property)) return fail();
          visit(property.value, key);
        }
      } else for (const name in value) if (Object.hasOwn(value, name)) {
        const property = Object.getOwnPropertyDescriptor(value, name)!;
        if (!("value" in property)) return fail();
        visit(property.value, key);
      }
    } finally { ancestors.delete(value); }
  }
  for (const [key, value] of Object.entries(options)) {
    if (!key) throw new TypeError("Invalid model option: empty name");
    visit(value, key);
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
            yield { type: "response", response: { model: model.id, ...(details?.usage ? { usage: details.usage } : {}), ...(details?.metadata ? { metadata: details.metadata } : {}) } };
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
  resolve(model?: string): LlmServiceModel;
  complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array, LlmResponseMetadata | void>;
  stream(request: LlmServiceRequest): AsyncIterable<LlmStreamEvent>;
  streamSources?(request: LlmServiceSourceRequest): AsyncIterable<LlmStreamEvent>;
  embedSources?(request: Omit<LlmEmbeddingSourceRequest, "model"> & { readonly model?: string }): Promise<LlmEmbeddingResponse>;
  embed(request: Omit<LlmEmbeddingRequest, "model"> & { readonly model?: string }): Promise<LlmEmbeddingResponse>;
}

export function createLlmService(options: LlmServiceOptions): LlmService {
  const models: LlmServiceModel[] = [];
  const lookup = new Map<string, LlmServiceModel>();
  const defaultModel = options.defaultModel;
  for (const provider of options.providers) {
    if (!provider.name || typeof provider.complete !== "function") throw new TypeError("Providers require a name and complete function");
    for (const declared of provider.models) {
      if (!declared.id) throw new TypeError("Models require a nonempty id");
      const model: LlmModel = Object.freeze({ ...declared,
        ...(declared.options ? { options: Object.freeze(Object.fromEntries(Object.entries(declared.options).map(([name, rule]) => [name, Object.freeze({ ...rule })]))) } : {}),
        ...(declared.capabilities ? { capabilities: Object.freeze([...declared.capabilities]) } : {}),
        ...(declared.aliases ? { aliases: Object.freeze([...declared.aliases]) } : {}),
        ...(declared.attachmentTypes ? { attachmentTypes: Object.freeze([...declared.attachmentTypes]) } : {}),
      });
      const entry = Object.freeze({ provider, model });
      for (const name of new Set([model.id, `${provider.name}/${model.id}`, ...model.aliases ?? []])) {
        if (!name) throw new TypeError("Model aliases must not be empty");
        if (lookup.has(name)) throw new Error(`Duplicate model id or alias: ${name}`);
        lookup.set(name, entry);
      }
      models.push(entry);
    }
  }
  return Object.freeze({
    version: 1 as const,
    models: Object.freeze(models),
    resolve(model?: string): LlmServiceModel {
      const selected = model ?? defaultModel;
      if (selected === undefined) throw new Error("No model selected; use --model or configure defaultModel");
      const entry = lookup.get(selected);
      if (!entry) throw new Error(`Unknown model: ${selected}`);
      return entry;
    },
    complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array, LlmResponseMetadata | void> {
      request.signal.throwIfAborted();
      validateOptions(request.options);
      if (typeof request.prompt !== "string" || request.system !== undefined && typeof request.system !== "string") throw new TypeError("Invalid LLM prompt");
      const entry = this.resolve(request.model);
      if (request.messages?.length && !entry.model.capabilities?.includes("messages")) throw new Error(`Model ${entry.model.id} does not support messages`);
      if (request.messages?.some(message => !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string")) throw new TypeError("Invalid LLM message");
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
      return entry.provider.complete({ ...input, model: entry.model.id, options: validateModelOptions(entry.model, request.options) });
    },
    async *stream(request: LlmServiceRequest): AsyncGenerator<LlmStreamEvent> {
      const entry = this.resolve(request.model);
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
        const entry = this.resolve(request.model);
        if (!entry.provider.completeSources || entry.model.inputSources === false) throw new Error(`Model ${entry.model.id} does not support streamed inputs`);
        for (const source of sources) if (!source || typeof source.dispose !== "function" || typeof source.bytes?.[Symbol.asyncIterator] !== "function") throw new TypeError("Invalid LLM input source");
        if (request.messages?.length && !entry.model.capabilities?.includes("messages")) throw new Error(`Model ${entry.model.id} does not support messages`);
        if (request.messages?.some(message => !["system", "user", "assistant"].includes(message.role))) throw new TypeError("Invalid LLM message");
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
        yield* streamResult(() => entry.provider.completeSources!({ ...input, model: entry.model.id, options: validateModelOptions(entry.model, request.options) }), entry.model, request);
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
