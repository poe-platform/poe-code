import { native } from "./native.js";
export class DuplicateToolError extends Error {
  constructor(toolName) {
    super(native.agentRuntimeError("tool", toolName));
    this.name = "DuplicateToolError";
    this.toolName = toolName;
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}
export class PluginSetupError extends Error {
  constructor(pluginName, cause) {
    super(native.agentRuntimeError("setup", pluginName), { cause });
    this.name = "PluginSetupError";
    this.pluginName = pluginName;
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}
export class PromptTransformError extends Error {
  constructor(pluginName, cause) {
    super(native.agentRuntimeError("prompt", pluginName), { cause });
    this.name = "PromptTransformError";
    this.pluginName = pluginName;
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}
