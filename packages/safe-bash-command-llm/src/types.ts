import type { ByteSource } from "safe-bash-contracts";
import type { LlmService } from "./service.js";
export type LlmOption = string | number | boolean | null;
export type LlmCapability = "messages" | "schema" | "embed";
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
}
export interface LlmModelOption {
  readonly description?: string;
  readonly type: "number" | "integer" | "boolean" | "string";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly nullable?: boolean;
}
export interface LlmModel {
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
}
export interface LlmEmbeddingResponse extends LlmResponseMetadata {
  readonly model: string;
  readonly vectors: readonly (readonly number[])[];
}
export interface LlmRequest {
  model: string;
  prompt: string;
  system?: string;
  messages?: readonly { readonly role: "system" | "user" | "assistant"; readonly content: string }[];
  schema?: Readonly<Record<string, unknown>>;
  attachments: readonly { mimeType: string; bytes: Uint8Array }[];
  options: Readonly<Record<string, LlmOption>>;
  signal: AbortSignal;
}
export interface LlmLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}
export interface LlmCommandsOptions {
  readonly limits?: Partial<LlmLimits>;
  readonly service?: LlmService;
  readonly providers?: readonly LlmProvider[];
  readonly service?: LlmService;
  readonly defaultModel?: string;
  readonly replace?: boolean;
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
  readonly messages?: readonly { readonly role: "system" | "user" | "assistant"; readonly content: LlmInputSource }[];
  readonly attachments: readonly { readonly mimeType: string; readonly source: LlmInputSource }[];
}
