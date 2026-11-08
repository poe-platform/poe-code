import type { AcpModelResponse } from "./acp-model.js";
import type { AcpEvent, ChatMessage, UsageInfo } from "./types.js";
import type { ProviderStreamEvent } from "./plugin-types.js";
export type NormalizedModelToolCall = {
  intentId: string;
  tool: string;
  args: unknown;
  rawArguments?: string;
  intentEmitted: boolean;
};
export type ModelToolError = { intentId: string; tool: string; args: unknown; error: string };
export type StreamToolOutcome =
  | { type: "complete"; toolCall: NormalizedModelToolCall }
  | { type: "error"; error: ModelToolError };
export type CollectedModelResponse = {
  content: string;
  reasoningContent?: string;
  reasoning?: string;
  thinking?: ChatMessage["thinking"];
  redactedThinking?: ChatMessage["redacted_thinking"];
  reasoningDetails?: unknown[];
  toolOutcomes: StreamToolOutcome[];
  usage?: UsageInfo;
  stopReason?: Extract<ProviderStreamEvent, { type: "stop" }>["reason"];
};
export declare function collectModelResponseEvents(options: {
  response: AcpModelResponse;
  emit?(event: AcpEvent): void;
}): Promise<CollectedModelResponse>;
