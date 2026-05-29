import OpenAI from "openai";
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseReasoningItem,
  ResponseStreamEvent
} from "openai/resources/responses/responses";
import type { AcpModel, AcpModelRequestMessage } from "../runtime/acp-core.js";
import { setResolvedPluginOptions } from "../runtime/provider-metadata.js";
import type { AgentPlugin, ProviderContext, ProviderStreamEvent } from "../runtime/plugin-types.js";
import { toolResultPartToText } from "../runtime/tool-results.js";
import type { ToolResultPart } from "../runtime/types.js";
import {
  readOptionalNonNegativeInteger,
  readOptionalString,
  readOptionalStringArray,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import { resolveOpenaiApiKey } from "./openai-auth.js";
import type { PluginSpec } from "./registry.js";

const DEFAULT_BASE_URL = "https://api.poe.com/v1";
const DEFAULT_INCLUDE = ["reasoning.encrypted_content"];
const REASONING_EFFORT_VALUES = ["minimal", "low", "medium", "high"] as const;
const REASONING_SUMMARY_VALUES = ["auto", "concise", "detailed"] as const;

type OpenaiResponsesProviderContext = Omit<ProviderContext, "options"> & {
  options: OpenaiResponsesPluginOptions;
};

type ToolCallBuffer = {
  id: string;
  itemId?: string;
  name?: string;
  rawArguments: string;
};

type ResponseLike = Pick<Response, "error" | "incomplete_details" | "output" | "status" | "usage">;

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

export const spec: PluginSpec<OpenaiResponsesPluginOptions> = {
  name: "openai-responses",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, [
      "baseUrl",
      "apiKey",
      "organization",
      "project",
      "defaultHeaders",
      "timeout",
      "maxRetries",
      "reasoningEffort",
      "reasoningSummary",
      "include"
    ]);

    const baseUrl = readOptionalString(obj, "baseUrl");
    const apiKey = readOptionalString(obj, "apiKey");
    const organization = readOptionalString(obj, "organization");
    const project = readOptionalString(obj, "project");
    const defaultHeaders = readOptionalStringRecord(obj, "defaultHeaders");
    const timeout = readOptionalNonNegativeInteger(obj, "timeout");
    const maxRetries = readOptionalNonNegativeInteger(obj, "maxRetries");
    const reasoningEffort = readOptionalEnum(obj, "reasoningEffort", REASONING_EFFORT_VALUES);
    const reasoningSummary = readOptionalEnum(obj, "reasoningSummary", REASONING_SUMMARY_VALUES);
    const include = readOptionalStringArray(obj, "include");

    return {
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(organization === undefined ? {} : { organization }),
      ...(project === undefined ? {} : { project }),
      ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
      ...(timeout === undefined ? {} : { timeout }),
      ...(maxRetries === undefined ? {} : { maxRetries }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(reasoningSummary === undefined ? {} : { reasoningSummary }),
      ...(include === undefined ? {} : { include: [...include] })
    };
  },
  factory(options) {
    return openaiResponsesPlugin(options);
  }
};

export function openaiResponsesPlugin(opts: OpenaiResponsesPluginOptions = {}): AgentPlugin {
  const options = spec.parseOptions(opts);
  const supports = (id: string) => id.startsWith("gpt-") || isOpenaiOSeriesModel(id);

  return setResolvedPluginOptions(
    {
      name: "openai-responses-plugin",
      providers: [
        {
          name: "openai-responses",
          supports,
          createModel(modelId, ctx) {
            return createOpenaiResponsesModel(modelId, {
              ...ctx,
              options: mergePluginOptions(options, ctx.options)
            });
          }
        }
      ]
    },
    options
  );
}

async function createOpenaiResponsesModel(
  modelId: string,
  ctx: OpenaiResponsesProviderContext
): Promise<AcpModel> {
  const options = ctx.options;
  const apiKey = await resolveClientApiKey(options.apiKey);
  const baseURL = resolveClientBaseUrl(options.baseUrl);
  const organization = toNonEmptyString(options.organization);
  const project = toNonEmptyString(options.project);
  const defaultHeaders = cloneStringRecord(options.defaultHeaders);
  const reasoning = buildReasoningRequestParam(options);

  const openai = new OpenAI({
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(organization === undefined ? {} : { organization }),
    ...(project === undefined ? {} : { project }),
    ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    fetch: ctx.fetch
  });

  return {
    async complete(request) {
      const stream = openai.responses.stream(
        {
          model: modelId,
          input: serializeProviderInput(request.messages),
          ...(request.tools.length === 0
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  name: tool.name,
                  description: tool.description ?? null,
                  parameters: normalizeToolInputSchema(tool.inputSchema),
                  strict: null
                }))
              }),
          include: [...(options.include ?? DEFAULT_INCLUDE)],
          ...(reasoning === undefined ? {} : { reasoning })
        } as never,
        {
          signal: request.signal
        }
      ) as AsyncIterable<ResponseStreamEvent>;

      return {
        events: streamResponseEvents(stream)
      };
    }
  };
}

async function* streamResponseEvents(
  stream: AsyncIterable<ResponseStreamEvent>
): AsyncIterable<ProviderStreamEvent> {
  const toolCallsById = new Map<string, ToolCallBuffer>();
  const toolCallIdsByItemId = new Map<string, string>();
  let sawToolUse = false;

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      if (event.delta.length > 0) {
        yield {
          type: "text",
          text: event.delta
        };
      }
      continue;
    }

    if (event.type === "response.reasoning_summary_text.delta") {
      if (event.delta.length > 0) {
        yield {
          type: "thinking",
          text: event.delta
        };
      }
      continue;
    }

    if (event.type === "response.output_item.added") {
      if (!isResponseFunctionToolCall(event.item)) {
        continue;
      }

      const id = resolveToolUseId(event.item);
      if (id === undefined) {
        continue;
      }

      const buffer = getOrCreateToolCallBuffer(toolCallsById, id);
      buffer.itemId = toNonEmptyString(event.item.id) ?? buffer.itemId;
      buffer.name = toNonEmptyString(event.item.name) ?? buffer.name;

      if (buffer.itemId !== undefined) {
        toolCallIdsByItemId.set(buffer.itemId, id);
      }

      sawToolUse = true;
      yield {
        type: "tool_use_delta",
        id,
        ...(buffer.name === undefined ? {} : { name: buffer.name })
      };
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const id = resolveToolUseIdFromItemId(event.item_id, toolCallIdsByItemId);
      if (id === undefined || event.delta.length === 0) {
        continue;
      }

      getOrCreateToolCallBuffer(toolCallsById, id).rawArguments += event.delta;
      sawToolUse = true;
      yield {
        type: "tool_use_delta",
        id,
        argsDelta: event.delta
      };
      continue;
    }

    if (event.type === "response.output_item.done") {
      if (isResponseReasoningItem(event.item)) {
        yield {
          type: "reasoning_details",
          payload: event.item
        };
        continue;
      }

      if (!isResponseFunctionToolCall(event.item)) {
        continue;
      }

      const id = resolveToolUseId(event.item);
      if (id === undefined) {
        continue;
      }

      const buffer = getOrCreateToolCallBuffer(toolCallsById, id);
      buffer.name = toNonEmptyString(event.item.name) ?? buffer.name;
      buffer.itemId = toNonEmptyString(event.item.id) ?? buffer.itemId;
      if (buffer.itemId !== undefined) {
        toolCallIdsByItemId.set(buffer.itemId, id);
      }

      const rawArguments =
        buffer.rawArguments.length > 0 ? buffer.rawArguments : (event.item.arguments ?? "");
      const parsedArguments = parseToolArguments(rawArguments);
      if (!parsedArguments.ok) {
        yield {
          type: "tool_use_json_parse_error",
          id,
          raw: rawArguments,
          error: parsedArguments.error
        };
        toolCallsById.delete(id);
        continue;
      }

      if (buffer.name === undefined) {
        toolCallsById.delete(id);
        continue;
      }

      sawToolUse = true;
      yield {
        type: "tool_use_complete",
        id,
        name: buffer.name,
        args: parsedArguments.value
      };
      toolCallsById.delete(id);
      continue;
    }

    if (event.type === "response.completed" || event.type === "response.incomplete") {
      const usage = extractUsage(event.response);
      if (usage !== undefined) {
        yield usage;
      }

      yield {
        type: "stop",
        reason: resolveStopReason(event.response, sawToolUse)
      };
      return;
    }

    if (event.type === "response.failed") {
      const usage = extractUsage(event.response);
      if (usage !== undefined) {
        yield usage;
      }

      yield {
        type: "stop",
        reason: "error"
      };
      return;
    }

    if (event.type === "error") {
      throw toResponseStreamError(event);
    }
  }

  yield {
    type: "stop",
    reason: sawToolUse ? "tool_use" : "end_turn"
  };
}

function mergePluginOptions(
  baseOptions: OpenaiResponsesPluginOptions,
  input: unknown
): OpenaiResponsesPluginOptions {
  if (input === undefined || input === null) {
    return clonePluginOptions(baseOptions);
  }

  const inputOptions = spec.parseOptions(input);
  return {
    ...clonePluginOptions(baseOptions),
    ...inputOptions,
    ...(baseOptions.defaultHeaders === undefined && inputOptions.defaultHeaders === undefined
      ? {}
      : {
          defaultHeaders: {
            ...(baseOptions.defaultHeaders ?? {}),
            ...(inputOptions.defaultHeaders ?? {})
          }
        }),
    ...(inputOptions.include === undefined ? {} : { include: [...inputOptions.include] })
  };
}

function clonePluginOptions(options: OpenaiResponsesPluginOptions): OpenaiResponsesPluginOptions {
  return {
    ...options,
    ...(options.defaultHeaders === undefined
      ? {}
      : { defaultHeaders: { ...options.defaultHeaders } }),
    ...(options.include === undefined ? {} : { include: [...options.include] })
  };
}

function serializeProviderInput(messages: AcpModelRequestMessage[]): unknown[] {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      input.push(serializeToolOutputMessage(message));
      continue;
    }

    if (message.role === "assistant") {
      for (const reasoningDetail of message.reasoning_details ?? []) {
        if (typeof reasoningDetail === "object" && reasoningDetail !== null) {
          input.push(reasoningDetail);
        }
      }

      for (const toolCall of message.tool_calls ?? []) {
        input.push({
          call_id: toolCall.id,
          type: "function_call",
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          status: "completed"
        });
      }

      const assistantContent = serializeAssistantMessageContent(message.content);
      if (assistantContent.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          status: "completed",
          content: assistantContent
        });
      }
      continue;
    }

    input.push({
      type: "message",
      role: message.role === "system" ? "system" : "user",
      content: serializeInputMessageContent(message.content)
    });
  }

  return input;
}

function serializeToolOutputMessage(message: AcpModelRequestMessage): {
  type: "function_call_output";
  call_id: string;
  output: string | Array<ReturnType<typeof serializeInputContentPart>>;
} {
  const toolCallId = toNonEmptyString(message.tool_call_id);
  if (toolCallId === undefined) {
    throw new Error("Tool message is missing tool_call_id.");
  }

  return {
    type: "function_call_output",
    call_id: toolCallId,
    output:
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => serializeInputContentPart(part))
  };
}

function serializeInputMessageContent(
  content: AcpModelRequestMessage["content"]
): Array<ReturnType<typeof serializeInputContentPart>> {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }];
  }

  return content.map((part) => serializeInputContentPart(part));
}

function serializeAssistantMessageContent(
  content: AcpModelRequestMessage["content"]
): Array<{ type: "output_text"; text: string; annotations: [] }> {
  if (typeof content === "string") {
    return content.length === 0
      ? []
      : [
          {
            type: "output_text",
            text: content,
            annotations: []
          }
        ];
  }

  return content.map((part) => ({
    type: "output_text",
    text: toolResultPartToText(part),
    annotations: []
  }));
}

function serializeInputContentPart(
  part: ToolResultPart
):
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" } {
  if (part.type === "image") {
    return {
      type: "input_image",
      image_url: `data:${part.mimeType};base64,${part.data}`,
      detail: "auto"
    };
  }

  return {
    type: "input_text",
    text: toolResultPartToText(part)
  };
}

function buildReasoningRequestParam(
  options: OpenaiResponsesPluginOptions
):
  | {
      effort?: OpenaiResponsesPluginOptions["reasoningEffort"];
      summary?: OpenaiResponsesPluginOptions["reasoningSummary"];
    }
  | undefined {
  if (options.reasoningEffort === undefined && options.reasoningSummary === undefined) {
    return undefined;
  }

  return {
    ...(options.reasoningEffort === undefined ? {} : { effort: options.reasoningEffort }),
    ...(options.reasoningSummary === undefined ? {} : { summary: options.reasoningSummary })
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

function resolveToolUseId(item: { id?: string; call_id?: string } | undefined): string | undefined {
  return toNonEmptyString(item?.call_id) ?? toNonEmptyString(item?.id);
}

function isResponseReasoningItem(item: unknown): item is ResponseReasoningItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "reasoning"
  );
}

function isResponseFunctionToolCall(item: unknown): item is ResponseFunctionToolCall {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "function_call"
  );
}

function resolveToolUseIdFromItemId(
  itemId: string | undefined,
  toolCallIdsByItemId: Map<string, string>
): string | undefined {
  const normalizedItemId = toNonEmptyString(itemId);
  if (normalizedItemId === undefined) {
    return undefined;
  }

  return toolCallIdsByItemId.get(normalizedItemId) ?? normalizedItemId;
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

function resolveStopReason(
  response: ResponseLike | undefined,
  sawToolUse: boolean
): Extract<ProviderStreamEvent, { type: "stop" }>["reason"] {
  if (
    response?.status === "failed" ||
    (response?.error !== null && response?.error !== undefined)
  ) {
    return "error";
  }

  const incompleteReason = response?.incomplete_details?.reason;
  if (incompleteReason === "max_output_tokens") {
    return "max_tokens";
  }

  if (incompleteReason === "content_filter") {
    return "error";
  }

  if (sawToolUse || response?.output?.some((item) => item.type === "function_call")) {
    return "tool_use";
  }

  return "end_turn";
}

function extractUsage(
  response: ResponseLike | undefined
): Extract<ProviderStreamEvent, { type: "usage" }> | undefined {
  const usage = response?.usage;
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = toNonNegativeInteger(usage.input_tokens) ?? 0;
  const outputTokens = toNonNegativeInteger(usage.output_tokens) ?? 0;
  const cachedTokens = toNonNegativeInteger(usage.input_tokens_details?.cached_tokens) ?? 0;

  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0) {
    return undefined;
  }

  return {
    type: "usage",
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheCreationTokens: 0
  };
}

function toResponseStreamError(
  event: Extract<ResponseStreamEvent, { type: "error" }>
): Error {
  const error = new Error(event.message ?? "OpenAI responses stream failed.");
  error.name = "OpenAIResponsesStreamError";
  Object.assign(error, {
    ...(event.code === undefined ? {} : { code: event.code }),
    ...(event.param === undefined ? {} : { param: event.param })
  });
  return error;
}

function isOpenaiOSeriesModel(id: string): boolean {
  if (!id.startsWith("o") || id.length < 2) {
    return false;
  }

  const second = id.charCodeAt(1);
  return second >= 48 && second <= 57;
}

async function resolveClientApiKey(
  explicitApiKey: string | undefined
): Promise<string | undefined> {
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

  const environmentBaseUrl = toNonEmptyString(process.env.POE_BASE_URL);
  if (environmentBaseUrl !== undefined) {
    return environmentBaseUrl;
  }

  return DEFAULT_BASE_URL;
}

function readOptionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[]
): T | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new Error(`${key}: expected one of ${allowedValues.join(", ")}`);
  }

  return value as T;
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

  const record: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      throw new Error(`${key}: expected an object of string values`);
    }

    record[entryKey] = entryValue;
  }

  return record;
}

function cloneStringRecord(
  value: Record<string, string> | undefined
): Record<string, string> | undefined {
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
