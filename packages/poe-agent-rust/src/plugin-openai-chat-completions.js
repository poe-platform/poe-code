import OpenAI from "./openai-transport.js";
import { native } from "./native.js";
import { setResolvedPluginOptions } from "./provider-metadata.js";
import { toolResultPartToText } from "./tool-results.js";
import {
  readOptionalNonNegativeInteger,
  readOptionalString,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import { resolveOpenaiApiKey } from "./openai-auth.js";

export const spec = {
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
    const result = {};
    for (const key of ["baseUrl", "apiKey", "organization"]) {
      const value = readOptionalString(obj, key);
      if (value !== undefined) result[key] = value;
    }
    const headers = obj.defaultHeaders;
    if (headers !== undefined) {
      if (
        typeof headers !== "object" ||
        headers === null ||
        Array.isArray(headers) ||
        Object.values(headers).some((value) => typeof value !== "string")
      )
        throw new Error("defaultHeaders: expected an object of string values");
      result.defaultHeaders = Object.fromEntries(Object.entries(headers));
    }
    for (const key of ["timeout", "maxRetries"]) {
      const value = readOptionalNonNegativeInteger(obj, key);
      if (value !== undefined) result[key] = value;
    }
    return result;
  },
  factory: (options) => openaiChatCompletionsPlugin(options)
};

export function openaiChatCompletionsPlugin(opts = {}) {
  const options = spec.parseOptions(opts);
  return setResolvedPluginOptions(
    {
      name: "openai-chat-completions-plugin",
      providers: [
        {
          name: "openai-chat-completions",
          supports: () => true,
          async createModel(modelId, ctx) {
            const override = ctx.options == null ? {} : spec.parseOptions(ctx.options);
            const merged = { ...options, ...override };
            if (options.defaultHeaders !== undefined || override.defaultHeaders !== undefined)
              merged.defaultHeaders = { ...options.defaultHeaders, ...override.defaultHeaders };
            let apiKey;
            try {
              apiKey = await resolveOpenaiApiKey(nonempty(merged.apiKey));
            } catch (error) {
              if (nonempty(merged.apiKey)) throw error;
            }
            const baseURL =
              nonempty(merged.baseUrl) ??
              nonempty(process.env.POE_BASE_URL) ??
              "https://api.poe.com/v1";
            const organization = nonempty(merged.organization);
            const openai = new OpenAI({
              baseURL,
              ...(apiKey === undefined ? {} : { apiKey }),
              ...(organization === undefined ? {} : { organization }),
              ...(merged.defaultHeaders === undefined
                ? {}
                : { defaultHeaders: { ...merged.defaultHeaders } }),
              ...(merged.timeout === undefined ? {} : { timeout: merged.timeout }),
              ...(merged.maxRetries === undefined ? {} : { maxRetries: merged.maxRetries }),
              fetch: ctx.fetch
            });
            return {
              async complete(request) {
                const stream = await openai.chat.completions.create(
                  {
                    model: modelId,
                    messages: request.messages.map(serializeMessage),
                    ...(request.tools.length
                      ? {
                          tools: request.tools.map((tool) => ({
                            type: "function",
                            function: {
                              name: tool.name,
                              description: tool.description ?? "",
                              parameters: normalizeSchema(tool.inputSchema)
                            }
                          }))
                        }
                      : {}),
                    stream: true,
                    stream_options: { include_usage: true }
                  },
                  { signal: request.signal }
                );
                return { events: streamEvents(stream) };
              }
            };
          }
        }
      ]
    },
    options
  );
}

async function* streamEvents(stream) {
  const state = new native.NativeAgentChatStream();
  if (stream.mapFrames) yield* stream.mapFrames((chunks) => state.pushBatch(chunks));
  else for await (const chunk of stream) yield* state.push(chunk);
  for (const event of state.finish()) {
    if (event.type !== "pending_tool") {
      yield event;
      continue;
    }
    let args;
    try {
      args = event.raw.length ? JSON.parse(event.raw) : {};
    } catch (error) {
      yield {
        type: "tool_use_json_parse_error",
        id: event.id,
        raw: event.raw,
        error: error instanceof Error ? error.message : String(error)
      };
      continue;
    }
    if (event.name !== undefined)
      yield { type: "tool_use_complete", id: event.id, name: event.name, args };
  }
}

function serializeMessage(message) {
  const thinking = message.thinking?.map((entry) => entry.text).join("");
  const content = nonempty(message.reasoning_content) ?? thinking;
  const reasoning = nonempty(message.reasoning) ?? content;
  return {
    role: message.role,
    ...(message.role === "tool" && typeof message.name === "string" ? { name: message.name } : {}),
    ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
    ...(content === undefined ? {} : { reasoning_content: content }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(message.tool_calls === undefined
      ? {}
      : {
          tool_calls: message.tool_calls.map((call) => ({
            ...call,
            function: { ...call.function, name: call.function.name }
          }))
        }),
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) =>
            part.type === "image"
              ? {
                  type: "image_url",
                  image_url: { url: `data:${part.mimeType};base64,${part.data}` }
                }
              : { type: "text", text: toolResultPartToText(part) }
          )
  };
}
function normalizeSchema(schema) {
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema))
    return {
      type: "object",
      properties: schema.properties ?? {},
      ...(schema.required === undefined ? {} : { required: [...schema.required] })
    };
  return { type: "object", properties: {} };
}
function nonempty(value) {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result.length ? result : undefined;
}
