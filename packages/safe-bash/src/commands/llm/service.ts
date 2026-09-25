import { acceptsMimeType } from "./mime.js";
import type { LlmModel, LlmProvider, LlmRequest, LlmEmbeddingRequest, LlmEmbeddingResponse } from "./types.js";

export interface LlmServiceOptions {
  readonly providers: readonly LlmProvider[];
  readonly defaultModel?: string;
  readonly templates?: Readonly<Record<string, string>>;
}

export interface LlmServiceModel {
  readonly provider: LlmProvider;
  readonly model: LlmModel;
}

export interface LlmServiceRequest extends Omit<LlmRequest, "model"> {
  readonly model?: string;
  readonly template?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly maxInputBytes?: number;
}

/** Structured host API shared by shell and other language front ends. */
export interface LlmService {
  readonly models: readonly LlmServiceModel[];
  resolve(model?: string): LlmServiceModel;
  complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array>;
  embed(request: Omit<LlmEmbeddingRequest, "model"> & {readonly model?: string}): Promise<LlmEmbeddingResponse>;
}

export class LlmInputLimitError extends RangeError {
  readonly code = "limit";
  constructor() { super("LLM input limit exceeded"); }
}

function renderTemplate(template: string, parameters: Readonly<Record<string, unknown>>, maxBytes: number): string {
  const pieces: string[] = [];
  let size = 0;
  const append = (value: string): void => {
    size += new TextEncoder().encode(value).length;
    if (size > maxBytes) throw new LlmInputLimitError();
    pieces.push(value);
  };
  let offset = 0;
  while (offset < template.length) {
    const start = template.indexOf("{",offset);
    if (start < 0) { append(template.slice(offset)); break; }
    append(template.slice(offset,start));
    const end = template.indexOf("}",start+1);
    if (end < 0) throw new TypeError("Unclosed template parameter");
    const name = template.slice(start+1,end);
    if (!Object.hasOwn(parameters,name)) throw new TypeError(`Missing template parameter: ${name}`);
    const value = parameters[name];
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text === undefined) throw new TypeError(`Invalid template parameter: ${name}`);
    append(text);
    offset = end+1;
  }
  return pieces.join("");
}

export function createLlmService(options: LlmServiceOptions): LlmService {
  const models: LlmServiceModel[] = [];
  const lookup = new Map<string, LlmServiceModel>();
  const defaultModel = options.defaultModel;
  const templates = new Map(Object.entries(options.templates ?? {}));
  for (const [name,body] of templates) if (!name || typeof body !== "string") throw new TypeError("Templates require names and string bodies");
  for (const provider of options.providers) {
    if (!provider.name || typeof provider.complete !== "function") throw new TypeError("Providers require a name and complete function");
    for (const declared of provider.models) {
      if (!declared.id) throw new TypeError("Models require a nonempty id");
      const model: LlmModel = Object.freeze({ ...declared,
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
    models: Object.freeze(models),
    resolve(model?: string): LlmServiceModel {
      const selected = model ?? defaultModel;
      if (selected === undefined) throw new Error("No model selected; use --model or configure defaultModel");
      const entry = lookup.get(selected);
      if (!entry) throw new Error(`Unknown model: ${selected}`);
      return entry;
    },
    async embed(request: Omit<LlmEmbeddingRequest, "model"> & {readonly model?: string}): Promise<LlmEmbeddingResponse> {
      request.signal.throwIfAborted();
      if (!Array.isArray(request.inputs) || request.inputs.some(value => typeof value !== 'string')) throw new TypeError('Embedding inputs must be strings');
      for (const [key,value] of Object.entries(request.options)) {
        if (!key || value !== null && !['string','number','boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Invalid embedding option');
      }
      const entry = this.resolve(request.model);
      if (!entry.provider.embed) throw new Error(`Model ${entry.model.id} does not support embeddings`);
      const result = await entry.provider.embed({...request,model:entry.model.id});
      request.signal.throwIfAborted();
      if (result.model !== entry.model.id || !Array.isArray(result.vectors) || result.vectors.length !== request.inputs.length || result.vectors.some(vector => !Array.isArray(vector) || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)))) throw new TypeError('Invalid embedding response');
      return result;
    },
    complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array> {
      request.signal.throwIfAborted();
      for (const [key, value] of Object.entries(request.options)) {
        if (!key || value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new TypeError('LLM options require nonempty names and scalar values');
        if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('LLM numeric options must be finite');
      }
      if (request.messages?.some(message => !['system','user','assistant'].includes(message.role) || typeof message.content !== 'string')) throw new TypeError('Invalid LLM message');
      if (request.schema !== undefined && (request.schema === null || typeof request.schema !== 'object' || Array.isArray(request.schema))) throw new TypeError('Invalid LLM schema');
      if (typeof request.prompt !== "string" || request.system !== undefined && typeof request.system !== "string") throw new TypeError("Invalid LLM prompt");
      const maxInputBytes = request.maxInputBytes ?? Infinity;
      if (request.maxInputBytes !== undefined && (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 0)) throw new RangeError("Invalid LLM input limit");
      const encoder = new TextEncoder();
      let inputBytes = encoder.encode(request.prompt).length + encoder.encode(request.system ?? "").length;
      for (const message of request.messages ?? []) inputBytes += encoder.encode(message.content).length;
      for (const attachment of request.attachments) inputBytes += attachment.bytes.length;
      if (inputBytes > maxInputBytes) throw new LlmInputLimitError();
      let prompt = request.prompt;
      if (request.template !== undefined) {
        const template = templates.get(request.template);
        if (template === undefined) throw new TypeError(`Unknown template: ${request.template}`);
        const parameters = request.parameters ?? {};
        if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new TypeError("Invalid template parameters");
        const separator = prompt ? "\n\n" : "";
        prompt = renderTemplate(template,parameters,maxInputBytes-inputBytes-encoder.encode(separator).length) + separator + prompt;
      } else if (request.parameters && Object.keys(request.parameters).length) throw new TypeError("Template parameters require a template");
      const entry = this.resolve(request.model);
      for (const attachment of request.attachments) {
        if (!acceptsMimeType(entry.model.attachmentTypes ?? [], attachment.mimeType)) {
          throw new Error(`Model ${entry.model.id} does not accept ${attachment.mimeType}`);
        }
      }
      const {template: _template, parameters: _parameters, maxInputBytes: _maxInputBytes, ...input} = request;
      return entry.provider.complete({ ...input, prompt, model: entry.model.id });
    },
  });
}
