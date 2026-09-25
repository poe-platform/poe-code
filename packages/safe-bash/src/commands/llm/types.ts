export type LlmOption = string | number | boolean | null;

export interface LlmProvider {
  readonly name: string;
  readonly models: readonly LlmModel[];
  complete(request: LlmRequest): AsyncIterable<string | Uint8Array>;
  embed?(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResponse>;
}

export interface LlmModel {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly attachmentTypes?: readonly string[];
  readonly outputType?: string;
}

export interface LlmEmbeddingRequest {
  model: string;
  inputs: readonly string[];
  options: Readonly<Record<string, LlmOption>>;
  signal: AbortSignal;
}

export interface LlmEmbeddingResponse {
  model: string;
  vectors: readonly (readonly number[])[];
  usage?: Readonly<Record<string, unknown>>;
}

export interface LlmRequest {
  model: string;
  prompt: string;
  system?: string;
  messages?: readonly {role: string;content: string}[];
  schema?: Readonly<Record<string, unknown>>;
  attachments: readonly { mimeType: string; bytes: Uint8Array }[];
  options: Readonly<Record<string, LlmOption>>;
  signal: AbortSignal;
}

export interface LlmCommandsOptions {
  readonly providers: readonly LlmProvider[];
  readonly defaultModel?: string;
  readonly replace?: boolean;
}
