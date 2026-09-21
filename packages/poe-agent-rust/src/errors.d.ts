export declare class DuplicateToolError extends Error {
  readonly toolName: string;
  constructor(toolName: string);
}
export declare class PluginSetupError extends Error {
  readonly pluginName: string;
  constructor(pluginName: string, cause: unknown);
}
export declare class PromptTransformError extends Error {
  readonly pluginName: string;
  constructor(pluginName: string, cause: unknown);
}
