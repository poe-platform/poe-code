import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
export type OpenaiChatCompletionsPluginOptions = {
  baseUrl?: string;
  apiKey?: string;
  organization?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
};
export declare const spec: PluginSpec<OpenaiChatCompletionsPluginOptions>;
export declare function openaiChatCompletionsPlugin(
  options?: OpenaiChatCompletionsPluginOptions
): AgentPlugin;
