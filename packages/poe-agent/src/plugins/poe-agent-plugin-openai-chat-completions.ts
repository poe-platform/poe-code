import OpenAI from "openai";
import type { AcpModel, AcpModelRequestMessage } from "../runtime/acp-core.js";
import type { AgentPlugin, ProviderContext, ProviderStreamEvent } from "../runtime/plugin-types.js";
import { toolResultPartToText } from "../runtime/tool-results.js";
import type { ToolResultPart } from "../runtime/types.js";
import {
  readOptionalNonNegativeInteger,
  readOptionalString,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import { resolveOpenaiApiKey } from "./openai-auth.js";
import type { PluginSpec } from "./registry.js";

const DEFAULT_BASE_URL = "https://api.poe.com/v1";

type ToolCallBuffer = {
  id: string;
  name?: string;
  rawArguments: string;
};

type OpenaiChatCompletionsProviderContext = Omit<ProviderContext, "options"> & {
  options: OpenaiChatCompletionsPluginOptions;
};

type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
};

export type OpenaiChatCompletionsPluginOptions = {
  baseUrl?: string;
  apiKey?: string;
  organization?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
};

export const spec: PluginSpec<OpenaiChatCompletionsPluginOptions> = {
  name: "openai-chat-completions",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, [
      "baseUrl",
      "apiKey",
      "organization",
      "defaultHeaders",
      "timeout",
      "maxRetries"
    ]);

    const baseUrl = readOptionalString(obj, "baseUrl");
    const apiKey = readOptionalString(obj, "apiKey");
    const organization = readOptionalString(obj, "organization");
    const defaultHeaders = readOptionalStringRecord(obj, "defaultHeaders");
    const timeout = readOptionalNonNegativeInteger(obj, "timeout");
    const maxRetries = readOptionalNonNegativeInteger(obj, "maxRetries");

    return {
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(organization === undefined ? {} : { organization }),
      ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
      ...(timeout === undefined ? {} : { timeout }),
      ...(maxRetries === undefined ? {} : { maxRetries })
    };
  },
  factory(options) {
    return openaiChatCompletionsPlugin(options);
  }
};

export function openaiChatCompletionsPlugin(
  opts: OpenaiChatCompletionsPluginOptions = {}
): AgentPlugin {
  return {
    name: "openai-chat-completions-plugin",
    providers: [
      {
        name: "openai-chat-completions",
        supports: () => true,
        createModel(modelId, ctx) {
          return createOpenaiChatCompletionsModel(modelId, {
            ...ctx,
            options: mergePluginOptions(opts, ctx.options)
          });
        }
      }
    ]
  };
}

async function createOpenaiChatCompletionsModel(
  modelId: string,
  ctx: OpenaiChatCompletionsProviderContext
): Promise<AcpModel> {
  const options = ctx.options;
  const apiKey = await resolveClientApiKey(options.apiKey);
  const baseURL = resolveClientBaseUrl(options.baseUrl);
  const organization = toNonEmptyString(options.organization);
  const defaultHeaders = cloneStringRecord(options.defaultHeaders);

  const openai = new OpenAI({
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(organization === undefined ? {} : { organization }),
    ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    fetch: ctx.fetch
  });

  return {
    async complete(request) {
      const stream = (await openai.chat.completions.create(
        {
          model: modelId,
          messages: request.messages.map((message) => serializeProviderMessage(message)),
          ...(request.tools.length === 0
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description ?? "",
                    parameters: normalizeToolInputSchema(tool.inputSchema)
                  }
                }))
              }),
          stream: true,
          stream_options: {
            include_usage: true
          }
        } as never,
        {
          signal: request.signal
        }
      )) as unknown as AsyncIterable<ChatCompletionStreamChunk>;

      return {
        events: streamChatCompletionChunks(stream)
      };
    }
  };
}

async function* streamChatCompletionChunks(
  stream: AsyncIterable<ChatCompletionStreamChunk>
): AsyncIterable<ProviderStreamEvent> {
  const toolCallsById = new Map<string, ToolCallBuffer>();
  const toolCallIdsByIndex = new Map<number, string>();
  let usage: Extract<ProviderStreamEvent, { type: "usage" }> | undefined;
  let stopReason: Extract<ProviderStreamEvent, { type: "stop" }>['reason'] | undefined;

  for await (const chunk of stream) {
    const nextUsage = extractUsage(chunk.usage);
    if (nextUsage !== undefined) {
      usage = {
        type: "usage",
        ...nextUsage
      };
    }

    const choice = chunk.choices?.[0];
    if (!choice) {
      continue;
    }

    const content = choice.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      yield {
        type: "text",
        text: content
      };
    }

    for (const toolCall of choice.delta?.tool_calls ?? []) {
      const id = resolveToolCallId(toolCall, toolCallIdsByIndex);
      if (id === undefined) {
        continue;
      }

      const buffer = getOrCreateToolCallBuffer(toolCallsById, id);
      const name = toolCall.function?.name;
      if (typeof name === "string" && name.length > 0 && buffer.name === undefined) {
        buffer.name = name;
      }

      const argsDelta = toolCall.function?.arguments;
      if (typeof argsDelta !== "string" || argsDelta.length === 0) {
        continue;
      }

      buffer.rawArguments += argsDelta;
      yield {
        type: "tool_use_delta",
        id,
        ...(typeof name === "string" && name.length > 0 ? { name } : {}),
        argsDelta
      };
    }

    const nextStopReason = mapFinishReason(choice.finish_reason);
    if (nextStopReason !== undefined) {
      stopReason = nextStopReason;
    }
  }

  for (const [id, toolCall] of toolCallsById.entries()) {
    const parsedArguments = parseToolArguments(toolCall.rawArguments);
    if (!parsedArguments.ok) {
      yield {
        type: "tool_use_json_parse_error",
        id,
        raw: toolCall.rawArguments,
        error: parsedArguments.error
      };
      continue;
    }

    if (toolCall.name === undefined) {
      continue;
    }

    yield {
      type: "tool_use_complete",
      id,
      name: toolCall.name,
      args: parsedArguments.value
    };
  }

  if (usage !== undefined) {
    yield usage;
  }

  yield {
    type: "stop",
    reason: stopReason ?? "end_turn"
  };
}

function mergePluginOptions(
  baseOptions: OpenaiChatCompletionsPluginOptions,
  input: unknown
): OpenaiChatCompletionsPluginOptions {
  if (input === undefined || input === null) {
    return {
      ...baseOptions,
      ...(baseOptions.defaultHeaders === undefined
        ? {}
        : { defaultHeaders: { ...baseOptions.defaultHeaders } })
    };
  }

  const inputOptions = spec.parseOptions(input);
  return {
    ...baseOptions,
    ...inputOptions,
    ...(baseOptions.defaultHeaders === undefined && inputOptions.defaultHeaders === undefined
      ? {}
      : {
          defaultHeaders: {
            ...(baseOptions.defaultHeaders ?? {}),
            ...(inputOptions.defaultHeaders ?? {})
          }
        })
  };
}

function serializeProviderMessage(message: AcpModelRequestMessage): Record<string, unknown> {
  return {
    role: message.role,
    ...(message.role === "tool" && typeof message.name === "string" ? { name: message.name } : {}),
    ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
    ...serializeReasoningRequestFields(message),
    ...(message.tool_calls === undefined
      ? {}
      : {
          tool_calls: message.tool_calls.map((toolCall) => ({
            ...toolCall,
            function: {
              ...toolCall.function,
              name: toolCall.function.name
            }
          }))
        }),
    content: serializeProviderMessageContent(message.content)
  };
}

function serializeReasoningRequestFields(
  message: AcpModelRequestMessage
): Pick<AcpModelRequestMessage, "reasoning" | "reasoning_content"> {
  const thinkingText = message.thinking?.map((entry) => entry.text).join("");
  const reasoningContent = toNonEmptyString(message.reasoning_content) ?? thinkingText;
  const reasoning = toNonEmptyString(message.reasoning) ?? reasoningContent;

  return {
    ...(reasoningContent === undefined ? {} : { reasoning_content: reasoningContent }),
    ...(reasoning === undefined ? {} : { reasoning })
  };
}

function serializeProviderMessageContent(
  content: AcpModelRequestMessage["content"]
):
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    > {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => serializeProviderContentPart(part));
}

function serializeProviderContentPart(
  part: ToolResultPart
):
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    } {
  if (part.type === "image") {
    return {
      type: "image_url",
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`
      }
    };
  }

  return {
    type: "text",
    text: toolResultPartToText(part)
  };
}

function normalizeToolInputSchema(schema: unknown): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
} {
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema)) {
    const objectSchema = schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    return {
      type: "object",
      properties: objectSchema.properties ?? {},
      ...(objectSchema.required === undefined ? {} : { required: [...objectSchema.required] })
    };
  }

  return {
    type: "object",
    properties: {}
  };
}

function resolveToolCallId(
  toolCall: {
    index: number;
    id?: string;
  },
  toolCallIdsByIndex: Map<number, string>
): string | undefined {
  const id = toNonEmptyString(toolCall.id);
  if (id !== undefined) {
    toolCallIdsByIndex.set(toolCall.index, id);
    return id;
  }

  return toolCallIdsByIndex.get(toolCall.index);
}

function getOrCreateToolCallBuffer(
  toolCallsById: Map<string, ToolCallBuffer>,
  id: string
): ToolCallBuffer {
  const existing = toolCallsById.get(id);
  if (existing !== undefined) {
    return existing;
  }

  const created: ToolCallBuffer = {
    id,
    rawArguments: ""
  };
  toolCallsById.set(id, created);
  return created;
}

function parseToolArguments(
  value: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value.length === 0) {
    return {
      ok: true,
      value: {}
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(value) as unknown
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function extractUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: {
          cached_tokens?: number;
        };
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | null
    | undefined
):
  | {
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cacheCreationTokens: number;
    }
  | undefined {
  if (usage === undefined || usage === null) {
    return undefined;
  }

  const inputTokens = toNonNegativeInteger(usage.prompt_tokens) ?? 0;
  const outputTokens = toNonNegativeInteger(usage.completion_tokens) ?? 0;
  const cachedTokens =
    toNonNegativeInteger(usage.prompt_tokens_details?.cached_tokens) ??
    toNonNegativeInteger(usage.cache_read_input_tokens) ??
    0;
  const cacheCreationTokens = toNonNegativeInteger(usage.cache_creation_input_tokens) ?? 0;

  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0 && cacheCreationTokens === 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheCreationTokens
  };
}

function mapFinishReason(
  reason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null | undefined
): Extract<ProviderStreamEvent, { type: "stop" }>['reason'] | undefined {
  if (reason === undefined || reason === null) {
    return undefined;
  }

  if (reason === "stop") {
    return "end_turn";
  }

  if (reason === "tool_calls" || reason === "function_call") {
    return "tool_use";
  }

  if (reason === "length") {
    return "max_tokens";
  }

  return "error";
}

async function resolveClientApiKey(explicitApiKey: string | undefined): Promise<string | undefined> {
  const explicit = toNonEmptyString(explicitApiKey);
  if (explicit !== undefined) {
    return await resolveOpenaiApiKey(explicit);
  }

  try {
    return await resolveOpenaiApiKey(undefined);
  } catch {
    return undefined;
  }
}

function resolveClientBaseUrl(baseUrl: string | undefined): string | undefined {
  const explicit = toNonEmptyString(baseUrl);
  if (explicit !== undefined) {
    return explicit;
  }

  if (toNonEmptyString(process.env.OPENAI_BASE_URL) !== undefined) {
    return undefined;
  }

  return DEFAULT_BASE_URL;
}

function readOptionalStringRecord(
  input: Record<string, unknown>,
  key: string
): Record<string, string> | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${key}: expected an object of string values`);
  }

  const entries = Object.entries(value);
  const record: Record<string, string> = {};

  for (const [entryKey, entryValue] of entries) {
    if (typeof entryValue !== "string") {
      throw new Error(`${key}: expected an object of string values`);
    }

    record[entryKey] = entryValue;
  }

  return record;
}

function cloneStringRecord(value: Record<string, string> | undefined): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return { ...value };
}

function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function toNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
