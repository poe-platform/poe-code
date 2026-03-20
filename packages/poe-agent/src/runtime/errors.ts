export class DuplicateToolError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool name collision: "${toolName}" is already registered.`);
    this.name = "DuplicateToolError";
    this.toolName = toolName;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class PluginSetupError extends Error {
  readonly pluginName: string;

  constructor(pluginName: string, cause: unknown) {
    super(`Plugin setup failed for "${pluginName}".`, { cause });
    this.name = "PluginSetupError";
    this.pluginName = pluginName;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class PromptTransformError extends Error {
  readonly pluginName: string;

  constructor(pluginName: string, cause: unknown) {
    super(`Prompt transform failed for "${pluginName}".`, { cause });
    this.name = "PromptTransformError";
    this.pluginName = pluginName;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
