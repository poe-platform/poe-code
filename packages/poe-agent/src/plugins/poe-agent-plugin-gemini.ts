import { hostProcess } from "#agent-platform";
import type { AcpModelRequestMessage } from "../runtime/acp-core.js";
import type { AgentPlugin, ProviderStreamEvent } from "../runtime/plugin-types.js";
import type { ToolResultPart } from "../runtime/types.js";
import { setResolvedPluginOptions } from "../runtime/provider-metadata.js";
import { toolResultPartToText } from "../runtime/tool-results.js";
import {
  readOptionalString,
  readRequiredEnum,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import type { PluginSpec } from "./registry.js";

export type GeminiPluginOptions = {
  baseUrl?: string;
  apiKey?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
};

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: { output: string } };
};
type Frame = {
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

export const spec: PluginSpec<GeminiPluginOptions> = {
  name: "gemini",
  parseOptions(input) {
    const object = toOptionsObject(input);
    rejectUnknownKeys(object, ["baseUrl", "apiKey", "reasoningEffort"]);
    const options: GeminiPluginOptions = {};
    for (const key of ["baseUrl", "apiKey"] as const) {
      const value = readOptionalString(object, key);
      if (value !== undefined) options[key] = value;
    }
    if (object.reasoningEffort !== undefined)
      options.reasoningEffort = readRequiredEnum<
        NonNullable<GeminiPluginOptions["reasoningEffort"]>
      >(object, "reasoningEffort", ["minimal", "low", "medium", "high"]);
    return options;
  },
  factory: geminiPlugin
};

export function geminiPlugin(input: GeminiPluginOptions = {}): AgentPlugin {
  const options = spec.parseOptions(input);
  return setResolvedPluginOptions(
    {
      name: "gemini-plugin",
      providers: [
        {
          name: "gemini",
          supports: (model) =>
            model.startsWith("gemini-") ||
            model.startsWith("google/gemini-") ||
            model.startsWith("gemini/gemini-"),
          createModel(modelId, ctx) {
            const merged = { ...options, ...spec.parseOptions(ctx.options) };
            if (ctx.runtime?.customFs && !merged.apiKey?.trim())
              throw new Error(
                "Custom filesystems require an explicit apiKey; host credentials are not inherited."
              );
            const apiKey =
              merged.apiKey?.trim() ||
              hostProcess.env.GEMINI_API_KEY ||
              hostProcess.env.GOOGLE_API_KEY;
            if (!apiKey) throw new Error("Gemini requires an apiKey or GEMINI_API_KEY.");
            const baseUrl = merged.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
            const model = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;
            const url = `${baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
            return {
              async complete(request) {
                const body = {
                  ...serializeMessages(request.messages),
                  ...(request.tools.length
                    ? {
                        tools: [
                          {
                            functionDeclarations: request.tools.map((tool) => ({
                              name: tool.name,
                              description: tool.description ?? "",
                              parametersJsonSchema: tool.inputSchema ?? {
                                type: "object",
                                properties: {}
                              }
                            }))
                          }
                        ]
                      }
                    : {}),
                  ...(merged.reasoningEffort
                    ? {
                        generationConfig: {
                          thinkingConfig: { thinkingLevel: merged.reasoningEffort.toUpperCase() }
                        }
                      }
                    : {})
                };
                const response = await ctx.fetch(url, {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
                  body: JSON.stringify(body),
                  signal: request.signal
                });
                if (!response.ok)
                  throw new Error(`Gemini HTTP ${response.status}: ${await response.text()}`);
                return { events: streamEvents(response) };
              }
            };
          }
        }
      ]
    },
    options
  );
}

function contentParts(content: string | ToolResultPart[]): Part[] {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  return content.map((part) =>
    part.type === "image"
      ? { inlineData: { mimeType: part.mimeType, data: part.data } }
      : { text: toolResultPartToText(part) }
  );
}

function serializeMessages(messages: AcpModelRequestMessage[]) {
  const system: Part[] = [],
    contents: Array<{ role: "user" | "model"; parts: Part[] }> = [];
  const calls = new Map<string, { name: string; id?: string }>();
  for (const message of messages) {
    if (message.role === "system") {
      system.push(...contentParts(message.content));
      continue;
    }
    const parts = contentParts(message.content);
    let next: Part[] = parts;
    if (message.role === "assistant") {
      const saved = message.reasoning_details?.find(
        (detail): detail is { provider: "gemini"; parts: Part[] } =>
          typeof detail === "object" &&
          detail !== null &&
          "provider" in detail &&
          detail.provider === "gemini" &&
          "parts" in detail &&
          Array.isArray(detail.parts)
      );
      next = saved?.parts ?? [
        ...parts,
        ...(message.tool_calls ?? []).map((call) => ({
          functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments) }
        }))
      ];
      const nativeCalls = next
        .filter((part) => part.functionCall)
        .map((part) => part.functionCall!);
      for (const [index, call] of (message.tool_calls ?? []).entries())
        calls.set(call.id, { name: call.function.name, id: nativeCalls[index]?.id });
    } else if (message.role === "tool") {
      const call = calls.get(message.tool_call_id ?? "");
      const name = call?.name ?? message.name;
      if (!name) throw new Error("Gemini tool result has no matching function call.");
      next = [
        {
          functionResponse: {
            ...(call?.id ? { id: call.id } : {}),
            name,
            response: {
              output: parts
                .filter((part) => part.text !== undefined)
                .map((part) => part.text)
                .join("\n")
            }
          }
        },
        ...parts.filter((part) => part.inlineData)
      ];
    }
    if (!next.length) continue;
    const role = message.role === "assistant" ? "model" : "user";
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts.push(...next);
    else contents.push({ role, parts: [...next] });
  }
  return { contents, ...(system.length ? { systemInstruction: { parts: system } } : {}) };
}

async function* frames(response: Response): AsyncIterable<Frame> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    yield (await response.json()) as Frame;
    return;
  }
  if (!response.body) throw new Error("Gemini response has no body.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done) buffer += "\n\n";
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        else if (line === "" && data.length) {
          const text = data.join("\n");
          data = [];
          if (text !== "[DONE]") yield JSON.parse(text) as Frame;
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function* streamEvents(response: Response): AsyncIterable<ProviderStreamEvent> {
  const parts: Part[] = [];
  let usage: Frame["usageMetadata"],
    finish: string | undefined,
    hasTools = false;
  for await (const frame of frames(response)) {
    if (frame.error) throw new Error(frame.error.message ?? "Gemini stream failed.");
    if (frame.promptFeedback?.blockReason)
      throw new Error(`Gemini blocked the prompt: ${frame.promptFeedback.blockReason}`);
    if (frame.usageMetadata) usage = frame.usageMetadata;
    const candidate = frame.candidates?.[0];
    if (candidate?.finishReason) finish = candidate.finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      parts.push(part);
      if (part.text)
        yield part.thought
          ? { type: "thinking", text: part.text }
          : { type: "text", text: part.text };
      if (part.functionCall) {
        hasTools = true;
        yield {
          type: "tool_use_complete",
          id: part.functionCall.id ?? crypto.randomUUID(),
          name: part.functionCall.name,
          args: part.functionCall.args ?? {}
        };
      }
    }
  }
  if (!finish) throw new Error("Gemini response ended without a terminal finish reason.");
  if (finish !== "STOP" && finish !== "MAX_TOKENS")
    throw new Error(`Gemini generation stopped: ${finish}`);
  if (parts.length) yield { type: "reasoning_details", payload: { provider: "gemini", parts } };
  if (usage)
    yield {
      type: "usage",
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens:
        usage.totalTokenCount === undefined
          ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
          : usage.totalTokenCount - (usage.promptTokenCount ?? 0),
      cachedTokens: usage.cachedContentTokenCount ?? 0,
      cacheCreationTokens: 0
    };
  yield {
    type: "stop",
    reason: finish === "MAX_TOKENS" ? "max_tokens" : hasTools ? "tool_use" : "end_turn"
  };
}
