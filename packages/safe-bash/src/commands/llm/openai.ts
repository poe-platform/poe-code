import type { HttpRequest, HttpTransport } from "../network/types.js";
import type { LlmModel, LlmProvider, LlmRequest } from "./types.js";
import { openAiBytes, openAiError, openAiJson, openAiRecord, openAiResponse } from "./openai-http.js";
import { openAiChat } from "./openai-sse.js";
import { acceptsMimeType } from "./mime.js";
import { credential, providerLimits, jsonBody, multipart, type LlmProviderLimits } from "./providers/shared.js";

export interface OpenAiModel extends LlmModel {
  readonly endpoint: "chat" | "images" | "videos";
}

export interface OpenAiProviderOptions {
  readonly transport: HttpTransport;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly models: readonly OpenAiModel[];
  readonly limits?: Partial<LlmProviderLimits>;
}

const numericOptions = {
  chat: new Map([
    ["temperature", "number"], ["top_p", "number"],
    ["frequency_penalty", "number"], ["presence_penalty", "number"],
    ["max_tokens", "integer"], ["max_completion_tokens", "integer"],
    ["n", "integer"], ["seed", "integer"], ["top_logprobs", "integer"],
  ]),
  images: new Map([
    ["n", "integer"], ["output_compression", "integer"], ["partial_images", "integer"],
  ]),
};

function jsonOptions(options: LlmRequest["options"], endpoint: "chat" | "images"): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => {
    if ((endpoint === "chat" ? ["store", "parallel_tool_calls", "logprobs"] : ["stream"]).includes(key)) {
      if (value !== "true" && value !== "false") throw new Error(`Invalid OpenAI option ${key}: expected boolean`);
      return [key, value === "true"];
    }
    const type = numericOptions[endpoint].get(key);
    if (!type) return [key, value];
    const number = value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(number) || type === "integer" && !Number.isSafeInteger(number)) {
      throw new Error(`Invalid OpenAI option ${key}: expected a finite ${type === "integer" ? "safe integer" : "number"}`);
    }
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

function imageBytes(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length === 0) throw new Error("OpenAI image response has no b64_json");
  let decoded: string;
  try { decoded = atob(value); }
  catch { throw new Error("OpenAI image response contains invalid base64"); }
  if (btoa(decoded) !== value) throw new Error("OpenAI image response contains non-canonical base64");
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
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
    ...(model.aliases === undefined ? {} : { aliases: Object.freeze([...model.aliases]) }),
    ...(model.attachmentTypes === undefined ? {} : { attachmentTypes: Object.freeze([...model.attachmentTypes]) }),
  }));
  const byId = new Map<string, OpenAiModel>();
  for (const model of configured) {
    if (!model.id || byId.has(model.id)) throw new TypeError(`OpenAI duplicate or empty model id: ${model.id}`);
    if (!["chat", "images", "videos"].includes(model.endpoint)) throw new TypeError(`OpenAI invalid endpoint for model: ${model.id}`);
    if (model.endpoint === "images" && !acceptsMimeType(["image/png", "image/jpeg", "image/webp"], model.outputType ?? "")) throw new TypeError("Image models require outputType image/png, image/jpeg or image/webp");
    if (model.endpoint === "videos" && !acceptsMimeType(["video/mp4"], model.outputType ?? "")) throw new TypeError("Video models require outputType video/mp4");
    if (model.endpoint === "chat" && model.outputType !== undefined && !acceptsMimeType(["text/*"], model.outputType)) throw new TypeError("Chat models require a text outputType");
    byId.set(model.id, model);
  }
  return {
    name: "openai", models: Object.freeze(configured),
    async *complete(request) {
      request.signal.throwIfAborted();
      const model = byId.get(request.model);
      if (!model) throw new Error(`Unknown model: ${request.model}`);
      if (request.attachments.some(attachment => !acceptsMimeType(["image/*"], attachment.mimeType))) {
        throw new Error(`OpenAI ${model.endpoint} endpoint only supports image attachments`);
      }
      if (model.endpoint === "videos" && request.attachments.length > 1) throw new Error("OpenAI videos accepts only one input_reference image");
      if (request.attachments.reduce((size, file) => size + file.bytes.byteLength, 0) > limits.maxRequestBytes) throw new RangeError("Provider request byte limit exceeded");
      if (model.endpoint !== "chat" && request.system !== undefined) throw new TypeError("System prompts are supported only by chat models");
      const reserved = model.endpoint === "chat" ? ["model", "messages", "stream"]
        : model.endpoint === "images" ? ["model", "prompt", "image", "image[]"] : ["model", "prompt", "input_reference"];
      for (const key of Object.keys(request.options)) {
        if (reserved.includes(key)) throw new Error(`OpenAI option ${key} is controlled by the provider`);
      }
      const send = (path: string, method: string, body?: Pick<HttpRequest, "body" | "headers">) => openAiResponse(transport, {
        url: `${baseUrl}${path}`, method, signal: request.signal,
        ...body, headers: [["authorization", `Bearer ${apiKey}`], ...(body?.headers ?? [])],
      }, limits.maxResponseBytes);
      if (model.endpoint === "chat") {
        const messages: unknown[] = [];
        if (request.system !== undefined) messages.push({ role: "system", content: request.system });
        messages.push({ role: "user", content: request.attachments.length === 0 ? request.prompt : [
          { type: "text", text: request.prompt },
          ...request.attachments.map(attachment => ({ type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${base64(attachment.bytes)}` } })),
        ] });
        for await (const response of send("/chat/completions", "POST", jsonBody({ ...jsonOptions(request.options, "chat"), model: request.model, messages, stream: true }, limits.maxRequestBytes))) {
          yield* openAiChat(response.body, request.signal, limits.maxEventBytes, limits.maxResponseBytes);
        }
      } else if (model.endpoint === "images") {
        const editing = request.attachments.length > 0;
        const outputFormat = model.outputType!.split(";", 1)[0]!.trim().toLowerCase().slice("image/".length);
        if (request.options.output_format !== undefined && request.options.output_format !== outputFormat) throw new TypeError("output_format conflicts with model outputType");
        const values: Record<string, string | number | boolean> = { ...jsonOptions(request.options, "images"), output_format: outputFormat, model: request.model, prompt: request.prompt };
        if (values.stream === true) throw new TypeError("Image event streaming is not supported by this reference provider");
        const body = editing ? multipart({ ...values, ...request.options }, request.attachments.map(file => ({ ...file, field: "image[]" })), limits.maxRequestBytes) : jsonBody(values, limits.maxRequestBytes);
        for await (const response of send(editing ? "/images/edits" : "/images/generations", "POST", body)) {
          const value = await openAiJson(response, request.signal, limits.maxResponseBytes);
          if (value.error != null) throw new Error(`OpenAI: ${openAiError(value.error) ?? "image generation failed"}`);
          if (!Array.isArray(value.data) || value.data.length === 0) throw new Error("OpenAI image response has no images");
          for (const item of value.data) {
            request.signal.throwIfAborted();
            if (!openAiRecord(item)) throw new Error("OpenAI image response contains a malformed image");
            yield imageBytes(item.b64_json);
          }
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
