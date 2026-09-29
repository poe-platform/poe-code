import { validateModelOptions } from "./model-options.js";
import { acceptsMimeType } from "./mime.js";
import type { LlmModel, LlmProvider, LlmRequest, LlmEmbeddingRequest, LlmEmbeddingResponse, LlmOption, LlmResponseMetadata, LlmSourceRequest, LlmInputSource } from "./types.js";

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

function validateMetadata(value: LlmResponseMetadata): void {
  for (const field of [value.usage, value.metadata]) {
    if (field !== undefined && (!field || typeof field !== "object" || Array.isArray(field))) throw new TypeError("Invalid LLM response metadata");
  }
}

function validateOptions(options: Readonly<Record<string, LlmOption>>): void {
  for (const [key, value] of Object.entries(options)) {
    if (!key || value !== null && !["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`Invalid model option ${key}: expected a finite scalar`);
    }
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
          size += typeof chunk === "string" ? new TextEncoder().encode(chunk).length : chunk.byteLength;
          if (size > limit) throw new RangeError("LLM output byte limit exceeded");
          yield typeof chunk === "string" ? { type: "text", text: chunk } : { type: "bytes", data: new Uint8Array(chunk) };
        }
      } finally {
        if (!ended) {
          const closing = Promise.resolve().then(() => iterator.return?.());
          if (request.signal.aborted) void closing.catch(() => undefined);
          else await closing;
        }
      }
}

/** Structured host API shared by shell and other language front ends. */
export interface LlmService {
  readonly version: 1;
  readonly models: readonly LlmServiceModel[];
  resolve(model?: string): LlmServiceModel;
  complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array, LlmResponseMetadata | void>;
  stream(request: LlmServiceRequest): AsyncIterable<LlmStreamEvent>;
  streamSources?(request: LlmServiceSourceRequest): AsyncIterable<LlmStreamEvent>;
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
      for (const attachment of request.attachments) {
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
      const sources = new Set<LlmInputSource>([request.prompt, ...request.system === undefined ? [] : [request.system], ...request.messages?.map(message => message.content) ?? [], ...request.attachments.map(attachment => attachment.source)]);
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
        if (!entry.provider.completeSources) throw new Error(`Model ${entry.model.id} does not support streamed inputs`);
        for (const source of sources) if (!source || typeof source.dispose !== "function" || typeof source.bytes?.[Symbol.asyncIterator] !== "function") throw new TypeError("Invalid LLM input source");
        if (request.messages?.length && !entry.model.capabilities?.includes("messages")) throw new Error(`Model ${entry.model.id} does not support messages`);
        if (request.messages?.some(message => !["system", "user", "assistant"].includes(message.role))) throw new TypeError("Invalid LLM message");
        if (request.schema !== undefined) {
          if (!entry.model.capabilities?.includes("schema")) throw new Error(`Model ${entry.model.id} does not support schema`);
          if (!request.schema || typeof request.schema !== "object" || Array.isArray(request.schema)) throw new TypeError("Invalid LLM schema");
        }
        for (const attachment of request.attachments) if (!acceptsMimeType(entry.model.attachmentTypes ?? [], attachment.mimeType)) throw new Error(`Model ${entry.model.id} does not accept ${attachment.mimeType}`);
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
    async embed(request: Omit<LlmEmbeddingRequest, "model"> & { readonly model?: string }): Promise<LlmEmbeddingResponse> {
      request.signal.throwIfAborted();
      validateOptions(request.options);
      if (!Array.isArray(request.inputs) || Array.from(request.inputs).some(input => typeof input !== "string")) throw new TypeError("Embedding inputs must be strings");
      const entry = this.resolve(request.model);
      if (!entry.model.capabilities?.includes("embed") || !entry.provider.embed) throw new Error(`Model ${entry.model.id} does not support embeddings`);
      const embed = entry.provider.embed.bind(entry.provider);
      const result = await abortable(() => embed({ ...request, model: entry.model.id, options: validateModelOptions(entry.model, request.options) }), request.signal);
      request.signal.throwIfAborted();
      if (result.model !== entry.model.id || !Array.isArray(result.vectors) || result.vectors.length !== request.inputs.length || Array.from(result.vectors).some(vector => !Array.isArray(vector) || !vector.length || Array.from(vector).some(value => typeof value !== "number" || !Number.isFinite(value)) || vector.length !== result.vectors[0]?.length)) throw new TypeError("Invalid embedding response");
      validateMetadata(result);
      return result;
    },
  });
}
