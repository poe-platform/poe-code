export interface LlmProvider {
  readonly name: string;
  readonly models: readonly LlmModel[];
  complete(request: LlmRequest): AsyncIterable<string | Uint8Array>;
}

export interface LlmModel {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly attachmentTypes?: readonly string[];
  readonly outputType?: string;
}

export interface LlmRequest {
  model: string;
  prompt: string;
  system?: string;
  attachments: readonly { mimeType: string; bytes: Uint8Array }[];
  options: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface LlmCommandsOptions {
  providers: readonly LlmProvider[];
  defaultModel?: string;
  replace?: boolean;
}
