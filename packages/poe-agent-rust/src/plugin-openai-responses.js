import OpenAI from "./openai-transport.js";
import { native } from "./native.js";
import { setResolvedPluginOptions } from "./provider-metadata.js";
import { toolResultPartToText } from "./tool-results.js";
import {
  readOptionalNonNegativeInteger,
  readOptionalString,
  readOptionalStringArray,
  readRequiredEnum,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import { resolveOpenaiApiKey } from "./openai-auth.js";

export const spec = {
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
    const result = {};
    for (const key of ["baseUrl", "apiKey", "organization", "project"]) {
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
    for (const [key, values] of [
      ["reasoningEffort", ["minimal", "low", "medium", "high"]],
      ["reasoningSummary", ["auto", "concise", "detailed"]]
    ])
      if (obj[key] !== undefined) result[key] = readRequiredEnum(obj, key, values);
    const include = readOptionalStringArray(obj, "include");
    if (include !== undefined) result.include = [...include];
    return result;
  },
  factory: (options) => openaiResponsesPlugin(options)
};

export function openaiResponsesPlugin(opts = {}) {
  const options = spec.parseOptions(opts);
  return setResolvedPluginOptions(
    {
      name: "openai-responses-plugin",
      providers: [
        {
          name: "openai-responses",
          supports: (model) => native.agentResponsesSupports(model),
          async createModel(modelId, ctx) {
            const override = ctx.options == null ? {} : spec.parseOptions(ctx.options);
            const merged = { ...options, ...override };
            if (options.defaultHeaders !== undefined || override.defaultHeaders !== undefined)
              merged.defaultHeaders = { ...options.defaultHeaders, ...override.defaultHeaders };
            if (merged.include !== undefined) merged.include = [...merged.include];
            let apiKey;
            try {
              apiKey = await resolveOpenaiApiKey(nonempty(merged.apiKey));
            } catch (error) {
              if (nonempty(merged.apiKey)) throw error;
            }
            const organization = nonempty(merged.organization),
              project = nonempty(merged.project);
            const openai = new OpenAI({
              baseURL:
                nonempty(merged.baseUrl) ??
                nonempty(process.env.POE_BASE_URL) ??
                "https://api.poe.com/v1",
              ...(apiKey === undefined ? {} : { apiKey }),
              ...(organization === undefined ? {} : { organization }),
              ...(project === undefined ? {} : { project }),
              ...(merged.defaultHeaders === undefined
                ? {}
                : { defaultHeaders: { ...merged.defaultHeaders } }),
              ...(merged.timeout === undefined ? {} : { timeout: merged.timeout }),
              ...(merged.maxRetries === undefined ? {} : { maxRetries: merged.maxRetries }),
              fetch: ctx.fetch
            });
            const reasoning =
              merged.reasoningEffort === undefined && merged.reasoningSummary === undefined
                ? undefined
                : {
                    ...(merged.reasoningEffort === undefined
                      ? {}
                      : { effort: merged.reasoningEffort }),
                    ...(merged.reasoningSummary === undefined
                      ? {}
                      : { summary: merged.reasoningSummary })
                  };
            return {
              async complete(request) {
                const stream = openai.responses.stream(
                  {
                    model: modelId,
                    input: serializeInput(request.messages),
                    ...(request.tools.length
                      ? {
                          tools: request.tools.map((tool) => ({
                            type: "function",
                            name: tool.name,
                            description: tool.description ?? null,
                            parameters: normalizeSchema(tool.inputSchema),
                            strict: null
                          }))
                        }
                      : {}),
                    include: [...(merged.include ?? ["reasoning.encrypted_content"])],
                    ...(reasoning === undefined ? {} : { reasoning })
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
  const state = new native.NativeAgentResponsesStream();
  const project = (frames) => {
    const events = state.pushBatch(frames);
    return events.map((event) => {
      if (event.type === "reasoning_details")
        return { type: event.type, payload: frames[event.sourceIndex].item };
      if (event.type === "pending_error")
        return { type: event.type, source: frames[event.sourceIndex] };
      return event;
    });
  };
  // Both the SDK-shaped development streams and the owned fetch transport expose
  // the same event contract. The latter maps every read in one native batch.
  const projected = stream.mapFrames
    ? stream.mapFrames(project)
    : (async function* () {
        for await (const frame of stream) yield* project([frame]);
      })();
  for await (const event of projected) {
    if (event.type === "pending_error") {
      const source = event.source,
        error = new Error(source.message ?? "OpenAI responses stream failed.");
      error.name = "OpenAIResponsesStreamError";
      Object.assign(error, {
        ...(source.code === undefined ? {} : { code: source.code }),
        ...(source.param === undefined ? {} : { param: source.param })
      });
      throw error;
    }
    if (event.type === "pending_stop") {
      yield { type: "stop", reason: state.resolveStop(event.reason) };
      return;
    }
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
    if (event.name !== undefined) {
      state.recordToolSuccess();
      yield { type: "tool_use_complete", id: event.id, name: event.name, args };
    }
  }
  yield* state.finish();
}

function serializeInput(messages) {
  const input = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const id = nonempty(message.tool_call_id);
      if (id === undefined) throw new Error("Tool message is missing tool_call_id.");
      input.push({
        type: "function_call_output",
        call_id: id,
        output:
          typeof message.content === "string" ? message.content : message.content.map(inputPart)
      });
      continue;
    }
    if (message.role === "assistant") {
      for (const detail of message.reasoning_details ?? [])
        if (typeof detail === "object" && detail !== null) input.push(detail);
      for (const call of message.tool_calls ?? [])
        input.push({
          call_id: call.id,
          type: "function_call",
          name: call.function.name,
          arguments: call.function.arguments,
          status: "completed"
        });
      const content =
        typeof message.content === "string"
          ? message.content.length
            ? [{ type: "output_text", text: message.content, annotations: [] }]
            : []
          : message.content.map((part) => ({
              type: "output_text",
              text: toolResultPartToText(part),
              annotations: []
            }));
      if (content.length)
        input.push({ type: "message", role: "assistant", status: "completed", content });
      continue;
    }
    input.push({
      type: "message",
      role: message.role === "system" ? "system" : "user",
      content:
        typeof message.content === "string"
          ? [{ type: "input_text", text: message.content }]
          : message.content.map(inputPart)
    });
  }
  return input;
}
function inputPart(part) {
  return part.type === "image"
    ? {
        type: "input_image",
        image_url: `data:${part.mimeType};base64,${part.data}`,
        detail: "auto"
      }
    : { type: "input_text", text: toolResultPartToText(part) };
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
