import { embeddingJson } from "./embedding-json.js";
import { openAiUsage } from "./openai-usage.js";
import { requestAttachments } from "./request-attachments.js";
export { chatJson as serializeOpenAiChatRequest, type OpenAiChatSourceRequest } from "./chat-json.js";
import { openAiChatOptions } from "./openai-chat-options.js";
import { chatJson } from "./chat-json.js";
import { parseLlmNumericOption } from "./numeric-option.js";
import type { HttpRequest, HttpTransport } from "safe-bash-contracts/http";
import type { LlmEmbeddingRequest, LlmEmbeddingSourceRequest, LlmEmbeddingResponse, LlmModel, LlmProvider, LlmRequest, LlmResponseMetadata, LlmOption } from "./types.js";
import { openAiBytes, openAiError, openAiJson, openAiRecord, openAiResponse } from "./openai-http.js";
import { openAiChat } from "./openai-sse.js";
import { acceptsMimeType } from "./mime.js";
import { credential, providerLimits, jsonBody, multipart, type LlmProviderLimits } from "./providers/shared.js";

export interface OpenAiModel extends LlmModel {
  readonly endpoint: "chat" | "images" | "videos" | "embeddings";
}

export interface OpenAiProviderOptions {
  readonly transport: HttpTransport;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly models: readonly OpenAiModel[];
  readonly limits?: Partial<LlmProviderLimits>;
}

const numericOptions = {
  chat: new Map<string, readonly ["number" | "integer", number, number]>([
    ["temperature", ["number", 0, 2]], ["top_p", ["number", 0, 1]],
    ["frequency_penalty", ["number", -2, 2]], ["presence_penalty", ["number", -2, 2]],
    ["max_tokens", ["integer", 1, Number.MAX_SAFE_INTEGER]], ["max_completion_tokens", ["integer", 1, Number.MAX_SAFE_INTEGER]],
    ["n", ["integer", 1, Number.MAX_SAFE_INTEGER]], ["seed", ["integer", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]], ["top_logprobs", ["integer", 0, 20]],
  ]),
  images: new Map<string, readonly ["number" | "integer", number, number]>([
    ["n", ["integer", 1, 10]], ["output_compression", ["integer", 0, 100]], ["partial_images", ["integer", 0, 3]],
  ]),
} as const;

function jsonOptions(options: LlmRequest["options"], endpoint: "chat" | "images"): Record<string, LlmOption> {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => {
    if ((endpoint === "chat" ? ["store", "parallel_tool_calls", "logprobs"] : ["stream"]).includes(key)) {
      if (value !== "true" && value !== "false" && typeof value !== "boolean") throw new Error(`Invalid OpenAI option ${key}: expected boolean`);
      return [key, value === true || value === "true"];
    }
    const numeric = numericOptions[endpoint].get(key);
    if (!numeric) return [key, value];
    const [type, minimum, maximum] = numeric;
    const number = parseLlmNumericOption(value, type);
    if (number === undefined || !Number.isFinite(number) || type === "integer" && !Number.isSafeInteger(number)) {
      throw new Error(`Invalid OpenAI option ${key}: expected a finite ${type === "integer" ? "safe integer" : "number"}`);
    }
    if (number < minimum || number > maximum) throw new RangeError(`Invalid OpenAI option ${key}: expected ${minimum}..${maximum}`);
    return [key, number];
  }));
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

// Keep image JSON and decoded output within a Worker-sized budget even when
// the general provider response allowance is larger (e.g. video downloads).

function imageSize(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) throw new Error("OpenAI image response has no b64_json");
  if (value.length % 4 !== 0) throw new Error("OpenAI image response contains non-canonical base64");
  return value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
}

function imageSlab(value: string): string {
  let decoded: string;
  try { decoded = atob(value); }
  catch { throw new Error("OpenAI image response contains invalid base64"); }
  if (btoa(decoded) !== value) throw new Error("OpenAI image response contains non-canonical base64");
  return decoded;
}

function* imageBytes(value: string, signal: AbortSignal): Iterable<Uint8Array> {
  for (let offset = 0; offset < value.length; offset += 8192) {
    signal.throwIfAborted();
    const decoded = imageSlab(value.slice(offset, offset + 8192));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    yield bytes;
  }
}

function waitForPoll(signal: AbortSignal, interval: number): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, interval);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function job(value: Record<string, unknown>, expectedId?: string): { id: string; status: string } {
  if (value.error != null) throw new Error(`OpenAI video failed: ${openAiError(value.error) ?? "unknown error"}`);
  if (typeof value.id !== "string" || value.id.length === 0 || value.id === "." || value.id === ".." || (expectedId !== undefined && value.id !== expectedId)) {
    throw new Error("OpenAI video response has an invalid job id");
  }
  if (value.status !== "queued" && value.status !== "in_progress" && value.status !== "completed") {
    throw new Error(`OpenAI video failed: ${typeof value.status === "string" ? value.status : "invalid status"}`);
  }
  return { id: value.id, status: value.status };
}

function openAiChatJsonResult(value: Record<string, unknown>, signal: AbortSignal): { content?: string; details?: LlmResponseMetadata } {
  signal.throwIfAborted();
  if (value.error != null) throw new Error(`OpenAI: ${openAiError(value.error) ?? "chat completion failed"}`);
  if (!Array.isArray(value.choices) || value.choices.length === 0) throw new Error("OpenAI chat response has no choices");
  const first = value.choices[0];
  if (!openAiRecord(first) || !openAiRecord(first.message)) throw new Error("OpenAI chat response has a malformed choice");
  const content = first.message.content;
  if (content !== undefined && content !== null && typeof content !== "string") throw new Error("OpenAI chat response content must be a string");
  const metadata: Record<string, unknown> = {};
  if (typeof value.id === "string") metadata.id = value.id;
  if (typeof value.model === "string") metadata.model = value.model;
  if (typeof first.finish_reason === "string") metadata.finish_reason = first.finish_reason;
  const details: LlmResponseMetadata = {
    ...(openAiRecord(value.usage) ? { usage: openAiUsage(value.usage) } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
  return { ...(typeof content === "string" && content.length > 0 ? { content } : {}), details };
}

export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const { transport, apiKey } = options;
  const limits = providerLimits(options.limits);
  if (typeof transport !== "function") throw new TypeError("OpenAI requires an injected HTTP transport");
  if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.includes("\r") || apiKey.includes("\n")) throw new TypeError("OpenAI requires a valid API key");
  credential(apiKey);
  const base = new URL(options.baseUrl ?? "https://api.openai.com/v1");
  if ((base.protocol !== "https:" && base.protocol !== "http:") || base.username || base.password || base.search || base.hash) {
    throw new TypeError("OpenAI baseUrl must be an HTTP(S) URL without credentials, query or fragment");
  }
  const baseUrl = base.href.endsWith("/") ? base.href.slice(0, -1) : base.href;
  const configured = options.models.map(model => Object.freeze({
    ...model,
    inputSources: model.endpoint === "chat",
    capabilities: Object.freeze(model.capabilities ?? (model.endpoint === "chat" ? ["messages"] as const : model.endpoint === "embeddings" ? ["embed"] as const : [])),
    ...(model.aliases === undefined ? {} : { aliases: Object.freeze([...model.aliases]) }),
    ...(model.attachmentTypes === undefined ? {} : { attachmentTypes: Object.freeze([...model.attachmentTypes]) }),
  }));
  const byId = new Map<string, OpenAiModel>();
  for (const model of configured) {
    if (!model.id || byId.has(model.id)) throw new TypeError(`OpenAI duplicate or empty model id: ${model.id}`);
    if (!["chat", "images", "videos", "embeddings"].includes(model.endpoint)) throw new TypeError(`OpenAI invalid endpoint for model: ${model.id}`);
    if (model.endpoint === "images" && !acceptsMimeType(["image/png", "image/jpeg", "image/webp"], model.outputType ?? "")) throw new TypeError("Image models require outputType image/png, image/jpeg or image/webp");
    if (model.endpoint === "videos" && !acceptsMimeType(["video/mp4"], model.outputType ?? "")) throw new TypeError("Video models require outputType video/mp4");
    if (model.endpoint === "chat" && model.outputType !== undefined && !acceptsMimeType(["text/*"], model.outputType)) throw new TypeError("Chat models require a text outputType");
    byId.set(model.id, model);
  }
  async function embed(request: LlmEmbeddingRequest | LlmEmbeddingSourceRequest): Promise<LlmEmbeddingResponse> {
    request.signal.throwIfAborted();
    const model = byId.get(request.model);
    if (!model || model.endpoint !== "embeddings") throw new Error(`Model ${request.model} does not support embeddings`);
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(request.options)) {
      if (key === "dimensions") {
        const number = parseLlmNumericOption(value, "integer");
        if (number === undefined || !Number.isSafeInteger(number) || number < 1) throw new TypeError("Invalid OpenAI dimensions: expected a positive integer");
        values[key] = number;
      } else if (key === "user" && typeof value === "string") values[key] = value;
      else throw new TypeError(`Unsupported OpenAI embedding option: ${key}`);
    }
    for await (const response of openAiResponse(transport, {
      url: `${baseUrl}/embeddings`, method: "POST", signal: request.signal,
      body: embeddingJson(request, values, limits.maxRequestBytes),
      headers: [["authorization", `Bearer ${request.key ? credential(request.key) : apiKey}`], ["content-type", "application/json"]],
    }, limits.maxResponseBytes)) {
      const body = await openAiJson(response, request.signal, limits.maxResponseBytes);
      if (!Array.isArray(body.data) || body.data.length !== request.inputs.length) throw new TypeError("Invalid OpenAI embedding response");
      const vectors: number[][] = new Array(request.inputs.length);
      for (const item of body.data) {
        if (!openAiRecord(item) || !Number.isSafeInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= vectors.length || vectors[item.index as number] !== undefined || !Array.isArray(item.embedding) || !item.embedding.length || item.embedding.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError("Invalid OpenAI embedding response");
        vectors[item.index as number] = item.embedding as number[];
      }
      if (vectors.some(vector => vector.length !== vectors[0]?.length)) throw new TypeError("Invalid OpenAI embedding dimensions");
      return { model: request.model, vectors, ...(openAiRecord(body.usage) ? { usage: openAiUsage(body.usage) } : {}) };
    }
    throw new Error("OpenAI returned no embedding response");
  }
  return {
    name: "openai", models: Object.freeze(configured),
    embed, embedSources: embed,
    async *completeSources(request) {
      request.signal.throwIfAborted();
      const model = byId.get(request.model);
      if (!model || model.endpoint !== "chat") throw new Error(`Model ${request.model} does not support streamed inputs`);
      const body = chatJson({ ...request, options: openAiChatOptions(jsonOptions(request.options, "chat")) }, limits.maxRequestBytes);
      let details: LlmResponseMetadata | undefined;
      for await (const response of openAiResponse(transport, {
        url: `${baseUrl}/chat/completions`, method: "POST", signal: request.signal,
        headers: [["authorization", `Bearer ${request.key ? credential(request.key) : apiKey}`], ["content-type", "application/json"]], body,
      }, limits.maxResponseBytes)) {
        if (request.stream === false) {
          const parsed = openAiChatJsonResult(await openAiJson(response, request.signal, limits.maxResponseBytes), request.signal);
          if (parsed.content !== undefined) yield parsed.content;
          details = parsed.details;
        } else {
          details = yield* openAiChat(response.body, request.signal, limits.maxEventBytes, limits.maxResponseBytes);
        }
      }
      return details;
    },
    async *complete(request) {
      request.signal.throwIfAborted();
      const model = byId.get(request.model);
      if (!model) throw new Error(`Unknown model: ${request.model}`);
      if (model.endpoint === "embeddings") throw new TypeError("Embedding models require embed()");
      if (model.endpoint !== "chat" && (request.messages?.length || request.schema !== undefined)) throw new TypeError("Messages and schemas require a chat model");
      let attachmentBytes = 0;
      for (const attachment of requestAttachments(request)) {
        if (!acceptsMimeType(["image/*"], attachment.mimeType)) throw new Error(`OpenAI ${model.endpoint} endpoint only supports image attachments`);
        attachmentBytes += attachment.bytes.byteLength;
        if (attachmentBytes > limits.maxRequestBytes) throw new RangeError("Provider request byte limit exceeded");
      }
      if (model.endpoint === "videos" && request.attachments.length > 1) throw new Error("OpenAI videos accepts only one input_reference image");
      if (model.endpoint !== "chat" && request.system !== undefined) throw new TypeError("System prompts are supported only by chat models");
      if (request.schema !== undefined && request.options.response_format !== undefined) throw new TypeError("OpenAI option response_format conflicts with request schema");
      const reserved = model.endpoint === "chat" ? ["model", "messages", "stream", "stream_options"]
        : model.endpoint === "images" ? ["model", "prompt", "image", "image[]"] : ["model", "prompt", "input_reference"];
      for (const key of Object.keys(request.options)) {
        if (reserved.includes(key)) throw new Error(`OpenAI option ${key} is controlled by the provider`);
      }
      const send = (path: string, method: string, body?: Pick<HttpRequest, "body" | "headers">) => openAiResponse(transport, {
        url: `${baseUrl}${path}`, method, signal: request.signal,
        ...body, headers: [["authorization", `Bearer ${request.key ? credential(request.key) : apiKey}`], ...(body?.headers ?? [])],
      }, limits.maxResponseBytes);
      if (model.endpoint === "chat") {
        const messages: unknown[] = [];
        if (request.system !== undefined) messages.push({ role: "system", content: request.system });
        for (const message of [...request.messages ?? [], { role: "user", content: request.prompt, attachments: request.attachments }]) {
          const attachments = message.attachments ?? [];
          messages.push({ role: message.role, content: attachments.length === 0 ? message.content : [
            { type: "text", text: message.content },
            ...attachments.map(attachment => ({ type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${base64(attachment.bytes)}` } })),
          ] });
        }
        let details: LlmResponseMetadata | undefined;
        const stream = request.stream !== false;
        for await (const response of send("/chat/completions", "POST", jsonBody({ ...openAiChatOptions(jsonOptions(request.options, "chat")), ...(request.schema === undefined ? {} : { response_format: { type: "json_schema", json_schema: { name: "response", schema: request.schema } } }), model: request.model, messages, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) }, limits.maxRequestBytes))) {
          if (!stream) {
            const parsed = openAiChatJsonResult(await openAiJson(response, request.signal, limits.maxResponseBytes), request.signal);
            if (parsed.content !== undefined) yield parsed.content;
            details = parsed.details;
          } else {
            details = yield* openAiChat(response.body, request.signal, limits.maxEventBytes, limits.maxResponseBytes);
          }
        }
        return details;
      } else if (model.endpoint === "images") {
        const editing = request.attachments.length > 0;
        const outputFormat = model.outputType!.split(";", 1)[0]!.trim().toLowerCase().slice("image/".length);
        if (request.options.output_format !== undefined && request.options.output_format !== outputFormat) throw new TypeError("output_format conflicts with model outputType");
        const values: Record<string, string | number | boolean | null> = { ...jsonOptions(request.options, "images"), output_format: outputFormat, model: request.model, prompt: request.prompt };
        if (values.stream === true) throw new TypeError("Image event streaming is not supported by this reference provider");
        const body = editing ? multipart({ ...values, ...request.options }, request.attachments.map(file => ({ ...file, field: "image[]" })), limits.maxRequestBytes) : jsonBody(values, limits.maxRequestBytes);
        for await (const response of send(editing ? "/images/edits" : "/images/generations", "POST", body)) {
          const value = await openAiJson(response, request.signal, limits.maxResponseBytes);
          if (value.error != null) throw new Error(`OpenAI: ${openAiError(value.error) ?? "image generation failed"}`);
          if (!Array.isArray(value.data) || value.data.length === 0) throw new Error("OpenAI image response has no images");
          let size = 0;
          const images: string[] = [];
          for (const item of value.data) {
            request.signal.throwIfAborted();
            if (!openAiRecord(item)) throw new Error("OpenAI image response contains a malformed image");
            size += imageSize(item.b64_json);
            if (size > limits.maxResponseBytes) throw new RangeError("Provider image byte limit exceeded");
            images.push(item.b64_json as string);
          }
          // Validate every slab before publishing any output, including padding
          // in the middle of an image or a malformed later image.
          for (const image of images) {
            for (let offset = 0; offset < image.length; offset += 8192) {
              request.signal.throwIfAborted();
              const slab = image.slice(offset, offset + 8192);
              if (offset + 8192 < image.length && slab.includes("=")) throw new Error("OpenAI image response contains non-canonical base64");
              imageSlab(slab);
            }
          }
          for (const image of images) yield* imageBytes(image, request.signal);
        }
      } else {
        let current: { id: string; status: string } | undefined;
        for await (const response of send("/videos", "POST", multipart({ ...request.options, model: request.model, prompt: request.prompt }, request.attachments.map(file => ({ ...file, field: "input_reference" })), limits.maxRequestBytes))) {
          current = job(await openAiJson(response, request.signal, limits.maxResponseBytes));
        }
        if (!current) throw new Error("OpenAI video creation returned no job");
        const path = `/videos/${encodeURIComponent(current.id)}`;
        let polls = 0;
        while (current.status !== "completed") {
          if (polls++ >= limits.maxPolls) throw new RangeError("Provider video polling limit exceeded");
          await waitForPoll(request.signal, limits.pollIntervalMs);
          for await (const response of send(path, "GET")) current = job(await openAiJson(response, request.signal, limits.maxResponseBytes), current.id);
        }
        for await (const response of send(`${path}/content`, "GET")) {
          const contentType = response.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1].split(";")[0]?.trim().toLowerCase();
          if (contentType && contentType !== "application/octet-stream" && !contentType.startsWith("video/")) {
            throw new Error(`OpenAI video download has unexpected content type: ${contentType}`);
          }
          let received = false;
          for await (const chunk of openAiBytes(response.body, request.signal, limits.maxResponseBytes)) {
            if (chunk.byteLength === 0) continue;
            received = true;
            yield chunk;
          }
          if (!received) throw new Error("OpenAI video download is empty");
        }
      }
    },
  };
}
