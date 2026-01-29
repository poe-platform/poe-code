/**
 * Options for spawning a provider CLI.
 */
export interface SpawnOptions {
  /** The prompt to send to the provider */
  prompt: string;
  /** Working directory for the service CLI */
  cwd?: string;
  /** Model identifier override */
  model?: string;
  /** Additional arguments forwarded to the CLI */
  args?: string[];
}

/**
 * Result from spawning a provider CLI.
 */
export interface SpawnResult {
  /** Standard output from the CLI */
  stdout: string;
  /** Standard error from the CLI */
  stderr: string;
  /** Exit code from the CLI process */
  exitCode: number;
}

export interface GenerateOptions {
  /** Model identifier override */
  model?: string;
  /** Additional parameters passed to the API */
  params?: Record<string, string>;
}

export type MediaGenerateOptions = GenerateOptions;

export interface GenerateResult {
  content: string;
}

export interface MediaGenerateResult {
  url: string;
  mimeType?: string;
}
