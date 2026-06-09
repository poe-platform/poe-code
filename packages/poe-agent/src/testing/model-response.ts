import type { AcpModelResponse } from "../runtime/acp-core.js";
import type { ProviderStreamEvent } from "../runtime/plugin-types.js";

export type LegacyAcpModelToolCall = {
  id?: string;
  intentId?: string;
  tool?: string;
  name?: string;
  args?: unknown;
  arguments?: unknown;
};

export type LegacyAcpModelMessage = {
  content?: string | null;
  reasoning_content?: string;
  reasoning?: string;
  toolCalls?: LegacyAcpModelToolCall[];
  tool_calls?: Array<{
    id: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

export type LegacyAcpModelResponse = {
  message?: LegacyAcpModelMessage;
  content?: string;
  toolCalls?: LegacyAcpModelToolCall[];
  deltas?: AsyncIterable<string> | Iterable<string>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheCreationTokens: number;
  };
};

export function toAcpModelResponse(
  response: LegacyAcpModelResponse | AcpModelResponse
): AcpModelResponse {
  if (Object.prototype.hasOwnProperty.call(response, "events")) {
    return response;
  }

  return {
    events: legacyResponseToEvents(response)
  };
}

export async function collectProviderEvents(
  response: AcpModelResponse
): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of response.events) {
    events.push(event);
  }
  return events;
}

async function* legacyResponseToEvents(
  response: LegacyAcpModelResponse
): AsyncIterable<ProviderStreamEvent> {
  const message = response.message;
  const content =
    typeof message?.content === "string"
      ? message.content
      : typeof response.content === "string"
        ? response.content
        : undefined;
  const reasoning =
    normalizeNonEmptyString(message?.reasoning_content) ??
    normalizeNonEmptyString(message?.reasoning);
  const toolCalls = [
    ...(message?.toolCalls ?? response.toolCalls ?? []),
    ...fromOpenAiToolCalls(message?.tool_calls)
  ];

  if (response.deltas) {
    for await (const chunk of response.deltas) {
      if (typeof chunk !== "string" || chunk.length === 0) {
        continue;
      }

      yield {
        type: "text",
        text: chunk
      };
    }
  } else if (typeof content === "string" && content.length > 0) {
    yield {
      type: "text",
      text: content
    };
  }

  if (reasoning) {
    yield {
      type: "thinking",
      text: reasoning
    };
  }

  for (const [index, toolCall] of toolCalls.entries()) {
    const id =
      normalizeNonEmptyString(toolCall.intentId) ??
      normalizeNonEmptyString(toolCall.id) ??
      `intent-${index + 1}`;
    const name = normalizeNonEmptyString(toolCall.tool) ?? normalizeNonEmptyString(toolCall.name);
    if (!name) {
      continue;
    }

    const normalizedArguments = normalizeToolArguments(toolCall.args ?? toolCall.arguments);
    if (normalizedArguments.raw !== undefined) {
      yield {
        type: "tool_use_delta",
        id,
        name,
        argsDelta: normalizedArguments.raw
      };
    }

    yield {
      type: "tool_use_complete",
      id,
      name,
      args: normalizedArguments.value
    };
  }

  if (response.usage) {
    yield {
      type: "usage",
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cachedTokens: response.usage.cachedTokens,
      cacheCreationTokens: response.usage.cacheCreationTokens
    };
  }

  yield {
    type: "stop",
    reason: toolCalls.length > 0 ? "tool_use" : "end_turn"
  };
}

function fromOpenAiToolCalls(
  toolCalls:
    | Array<{
        id: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>
    | undefined
): LegacyAcpModelToolCall[] {
  if (!toolCalls) {
    return [];
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.function?.name,
    arguments: toolCall.function?.arguments
  }));
}

function normalizeToolArguments(value: unknown): { value: unknown; raw?: string } {
  if (typeof value !== "string") {
    return { value };
  }

  try {
    return {
      value: JSON.parse(value) as unknown,
      raw: value
    };
  } catch {
    return {
      value,
      raw: value
    };
  }
}

function normalizeNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
