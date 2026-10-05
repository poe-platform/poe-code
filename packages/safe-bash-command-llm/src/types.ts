import type { LlmFragmentLoader } from "./fragment-loaders.js";
import type { ByteSource } from "safe-bash-contracts";
import type { LlmService } from "./service.js";
import type { LlmTemplateLoader } from "./templates.js";
import type {LlmCollectionCommands} from './collections-command-types.js';
export type LlmOption = string | number | boolean | null | readonly LlmOption[] | { readonly [key: string]: LlmOption };
export type LlmCapability = "messages" | "schema" | "embed" | "embed-binary" | "embed-mixed";
export interface LlmResponseMetadata {
  readonly usage?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface LlmProvider {
  readonly name: string;
  readonly models: readonly LlmModel[];
  complete(request: LlmRequest): AsyncIterable<string | Uint8Array, LlmResponseMetadata | void>;
  completeSources?(request: LlmSourceRequest): AsyncIterable<string | Uint8Array, LlmResponseMetadata | void>;
  embed?(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResponse>;
  embedSources?(request: LlmEmbeddingSourceRequest): Promise<LlmEmbeddingResponse>;
}
export interface LlmModelOption {
  readonly description?: string;
  readonly type: "number" | "integer" | "boolean" | "string" | "object" | "array";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly nullable?: boolean;
}
export interface LlmModel {
  /** Maximum inputs accepted in one embedding request for this model. */
  readonly embeddingBatchSize?: number;
  /** Source input support for this model; otherwise inferred from the provider hook. */
  readonly inputSources?: boolean;
  /** Provider accepts HTTP(S) attachment references without materializing their payloads. */
  readonly attachmentUrls?: boolean;
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly attachmentTypes?: readonly string[];
  readonly outputType?: string;
  readonly options?: Readonly<Record<string, LlmModelOption>>;
  readonly capabilities?: readonly LlmCapability[];
}
export interface LlmEmbeddingRequest {
  readonly model: string;
  readonly inputs: readonly string[];
  readonly options: Readonly<Record<string, LlmOption>>;
  readonly signal: AbortSignal;
  readonly key?: string | undefined;
}
/** UTF-8 text (or explicitly binary) inputs borrowed until the request settles. */
export interface LlmEmbeddingSourceRequest extends Omit<LlmEmbeddingRequest, "inputs"> {
  readonly binary?: boolean;
  /** Per-input kinds, mutually exclusive with binary; requires embed-mixed admission. */
  readonly inputTypes?: readonly ("text" | "binary")[];
  readonly inputs: readonly LlmInputSource[];
}
export interface LlmEmbeddingResponse extends LlmResponseMetadata {
  readonly model: string;
  readonly vectors: readonly (readonly number[])[];
}
export type LlmAttachment = { readonly mimeType: string; readonly id?: string } & (
  { readonly bytes: Uint8Array; readonly url?: never } | { readonly url: string; readonly bytes?: never }
);
export type LlmSourceAttachment = { readonly mimeType: string; readonly id?: string } & (
  { readonly source: LlmInputSource; readonly url?: never } | { readonly url: string; readonly source?: never }
);
export interface LlmRequest {
  model: string;
  prompt: string;
  system?: string;
  messages?: readonly { readonly role: "system" | "user" | "assistant"; readonly content: string; readonly attachments?: LlmRequest["attachments"] }[];
  schema?: Readonly<Record<string, unknown>>;
  attachments: readonly LlmAttachment[];
  options: Readonly<Record<string, LlmOption>>;
  signal: AbortSignal;
  stream?: boolean | undefined;
  key?: string | undefined;
}
export interface LlmLimits {
  readonly maxConfigurationBytes?: number;
  readonly maxInputBytes: number;
  /** Maximum aggregate materialized input bytes; streamed sources use maxInputBytes. */
  readonly maxBufferedInputBytes?: number;
  readonly maxOutputBytes: number;
}
export interface LlmCommandsOptions {
  readonly collections?:LlmCollectionCommands;
  readonly limits?: Partial<LlmLimits>;
  readonly service?: LlmService;
  readonly providers?: readonly LlmProvider[];
  readonly defaultModel?: string;
  readonly replace?: boolean;
  readonly fragmentLoaders?: ReadonlyMap<string, LlmFragmentLoader>;
  readonly templateLoaders?: ReadonlyMap<string, LlmTemplateLoader>;
  readonly maxRemoteTemplateBytes?: number;
}

/** A caller-owned input lease. Disposal must release resources independently of pending reads. */
export interface LlmInputSource {
  readonly bytes: ByteSource;
  dispose(): Promise<void>;
}
/** Control data is borrowed; callers keep options/schema stable until sources are disposed. */
export interface LlmSourceRequest extends Omit<LlmRequest, "prompt" | "system" | "messages" | "attachments"> {
  readonly prompt: LlmInputSource;
  readonly system?: LlmInputSource;
  readonly messages?: readonly { readonly role: "system" | "user" | "assistant"; readonly content: LlmInputSource; readonly attachments?: LlmSourceRequest["attachments"] }[];
  readonly attachments: readonly LlmSourceAttachment[];
}
