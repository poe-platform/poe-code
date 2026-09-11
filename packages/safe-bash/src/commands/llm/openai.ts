import type { HttpRequest, HttpTransport } from "../network/types.js";
import type { LlmModel, LlmProvider, LlmRequest } from "./types.js";
import { openAiBytes, openAiError, openAiJson, openAiRecord, openAiResponse } from "./openai-http.js";
import { openAiChat } from "./openai-sse.js";
import { acceptsMimeType } from "./mime.js";

export interface OpenAiModel extends LlmModel {
  readonly endpoint: "chat" | "images" | "videos";
}

export interface OpenAiProviderOptions {
  readonly transport: HttpTransport;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly models: readonly OpenAiModel[];
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

function jsonOptions(options: LlmRequest["options"], endpoint: "chat" | "images"): Record<string, string | number> {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => {
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

function jsonBody(value: unknown): Pick<HttpRequest, "body" | "headers"> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return { headers: [["content-type", "application/json"]], body: (async function* () { yield bytes; })() };
}

function multipart(request: LlmRequest, field: string): Pick<HttpRequest, "body" | "headers"> {
  const form = new FormData();
  for (const [key, value] of Object.entries(request.options)) form.append(key, value);
  form.set("model", request.model);
  form.set("prompt", request.system === undefined ? request.prompt : `${request.system}\n\n${request.prompt}`);
  for (const [index, attachment] of request.attachments.entries()) {
    form.append(field, new Blob([Uint8Array.from(attachment.bytes)], { type: attachment.mimeType }), `input-${index}`);
  }
  const encoded = new Response(form);
  return { headers: [["content-type", encoded.headers.get("content-type")!]], body: encoded.body! };
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 10_000);
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
  if (typeof transport !== "function") throw new TypeError("OpenAI requires an injected HTTP transport");
  if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.includes("\r") || apiKey.includes("\n")) throw new TypeError("OpenAI requires a valid API key");
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
      const reserved = model.endpoint === "chat" ? ["model", "messages", "stream"]
        : model.endpoint === "images" ? ["model", "prompt", "image", "image[]", "stream"] : ["model", "prompt", "input_reference"];
      for (const key of Object.keys(request.options)) {
        if (reserved.includes(key)) throw new Error(`OpenAI option ${key} is controlled by the provider`);
      }
      const send = (path: string, method: string, body?: Pick<HttpRequest, "body" | "headers">) => openAiResponse(transport, {
        url: `${baseUrl}${path}`, method, signal: request.signal,
        ...body, headers: [["authorization", `Bearer ${apiKey}`], ...(body?.headers ?? [])],
      });
      if (model.endpoint === "chat") {
        const messages: unknown[] = [];
        if (request.system !== undefined) messages.push({ role: "system", content: request.system });
        messages.push({ role: "user", content: request.attachments.length === 0 ? request.prompt : [
          { type: "text", text: request.prompt },
          ...request.attachments.map(attachment => ({ type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${base64(attachment.bytes)}` } })),
        ] });
        for await (const response of send("/chat/completions", "POST", jsonBody({ ...jsonOptions(request.options, "chat"), model: request.model, messages, stream: true }))) {
          yield* openAiChat(response.body, request.signal);
        }
      } else if (model.endpoint === "images") {
        const editing = request.attachments.length > 0;
        const body = editing ? multipart(request, "image[]") : jsonBody({
          ...jsonOptions(request.options, "images"), model: request.model, prompt: request.system === undefined ? request.prompt : `${request.system}\n\n${request.prompt}`,
        });
        for await (const response of send(editing ? "/images/edits" : "/images/generations", "POST", body)) {
          const value = await openAiJson(response, request.signal);
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
        for await (const response of send("/videos", "POST", multipart(request, "input_reference"))) {
          current = job(await openAiJson(response, request.signal));
        }
        if (!current) throw new Error("OpenAI video creation returned no job");
        const path = `/videos/${encodeURIComponent(current.id)}`;
        while (current.status !== "completed") {
          await waitForPoll(request.signal);
          for await (const response of send(path, "GET")) current = job(await openAiJson(response, request.signal), current.id);
        }
        for await (const response of send(`${path}/content`, "GET")) {
          const contentType = response.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1].split(";")[0]?.trim().toLowerCase();
          if (contentType && contentType !== "application/octet-stream" && !contentType.startsWith("video/")) {
            throw new Error(`OpenAI video download has unexpected content type: ${contentType}`);
          }
          let received = false;
          for await (const chunk of openAiBytes(response.body, request.signal)) {
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
