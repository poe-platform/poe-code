import type { ProviderStreamEvent } from "./plugin-types.js";
import type { ToolResultPart } from "./types.js";
export type AcpModelToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};
export type AcpModelResponse = {
  events: AsyncIterable<ProviderStreamEvent>;
};
export type AcpModelRequestMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolResultPart[];
  reasoning_content?: string;
  reasoning?: string;
  thinking?: Array<{
    text: string;
    signature?: string;
  }>;
  redacted_thinking?: Array<{
    data: string;
  }>;
  reasoning_details?: unknown[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};
export type AcpModel = {
  complete(request: {
    messages: AcpModelRequestMessage[];
    tools: AcpModelToolDefinition[];
    signal: AbortSignal;
  }): Promise<AcpModelResponse>;
};
