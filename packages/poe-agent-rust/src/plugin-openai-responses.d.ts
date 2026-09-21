import type { AgentPlugin } from "./plugin-types.js";
import type { PluginSpec } from "./plugin-spec.js";
export type OpenaiResponsesPluginOptions = {
  baseUrl?: string;
  apiKey?: string;
  organization?: string;
  project?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  reasoningSummary?: "auto" | "concise" | "detailed";
  include?: string[];
};
export declare const spec: PluginSpec<OpenaiResponsesPluginOptions>;
export declare function openaiResponsesPlugin(options?: OpenaiResponsesPluginOptions): AgentPlugin;
