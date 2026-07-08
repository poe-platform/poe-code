export type ApiShapeId =
  | "openai-chat-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generations";

export interface OtelCaptureDefinition {
  env?: Record<string, string>;
  args?: (endpoint: string, content: boolean) => string[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  label: string;
  summary: string;
  aliases?: string[];
  /** Binary name for CLI agents. Optional for GUI-only apps like Claude Desktop. */
  binaryName?: string;
  readonly apiShapes?: readonly ApiShapeId[];
  readonly otelCapture?: OtelCaptureDefinition;
  configPath?: string;
  readonly configPaths?: {
    readonly darwin: string;
    readonly linux: string;
    readonly win32: string;
  };
  branding: {
    colors: {
      dark: string;
      light: string;
    };
  };
}
