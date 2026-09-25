import { acceptsMimeType } from "./mime.js";
import type { LlmModel, LlmProvider, LlmRequest } from "./types.js";

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
}

/** Structured host API shared by shell and other language front ends. */
export interface LlmService {
  readonly models: readonly LlmServiceModel[];
  resolve(model?: string): LlmServiceModel;
  complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array>;
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
    complete(request: LlmServiceRequest): AsyncIterable<string | Uint8Array> {
      request.signal.throwIfAborted();
      const entry = this.resolve(request.model);
      for (const attachment of request.attachments) {
        if (!acceptsMimeType(entry.model.attachmentTypes ?? [], attachment.mimeType)) {
          throw new Error(`Model ${entry.model.id} does not accept ${attachment.mimeType}`);
        }
      }
      return entry.provider.complete({ ...request, model: entry.model.id });
    },
  });
}
