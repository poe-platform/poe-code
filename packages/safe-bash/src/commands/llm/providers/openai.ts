import type { LlmModel, LlmProvider, LlmRequest } from "../types.js";
import type { HttpTransport } from "../../network/types.js";
import { delay } from "../../network/shared.js";
import { baseUrl, credential, providerLimits, fields, jsonBody, multipart, toBase64, fromBase64, responseBytes, responseJson, chatEvents, type LlmProviderLimits } from "./shared.js";

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

export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const origin = baseUrl(options.baseUrl ?? "https://api.openai.com/v1");
  const headers = [["Authorization", `Bearer ${credential(options.apiKey)}`]] as const;
  const transport = options.transport;
  const limits = providerLimits(options.limits);
  const models = options.models.map(model => Object.freeze({ ...model, ...(model.aliases ? { aliases: Object.freeze([...model.aliases]) } : {}), ...(model.attachmentTypes ? { attachmentTypes: Object.freeze([...model.attachmentTypes]) } : {}) }));
  if (typeof transport !== "function") throw new TypeError("Provider transport is required");
  for (const model of models) {
    if (!["chat", "images", "videos"].includes(model.endpoint)) throw new TypeError("Invalid OpenAI endpoint");
    if (model.endpoint === "images" && !["image/png", "image/jpeg", "image/webp"].includes(model.outputType ?? "")) throw new TypeError("Image models require outputType image/png, image/jpeg or image/webp");
    if (model.endpoint === "videos" && model.outputType !== "video/mp4") throw new TypeError("Video models require outputType video/mp4");
    if (model.endpoint === "chat" && model.outputType !== undefined && !model.outputType.startsWith("text/")) throw new TypeError("Chat models require a text outputType");
  }
  return {
    name: "openai", models: Object.freeze(models),
    async *complete(request: LlmRequest) {
      request.signal.throwIfAborted();
      const model = models.find(candidate => candidate.id === request.model);
      if (!model) throw new Error(`Unknown model: ${request.model}`);
      if (request.attachments.some(attachment => !attachment.mimeType.startsWith("image/"))) throw new TypeError("OpenAI reference endpoints accept only image attachments");
      if (request.attachments.reduce((size, file) => size + file.bytes.length, 0) > limits.maxRequestBytes) throw new RangeError("Provider request byte limit exceeded");
      const send = (path: string, payload?: { body: import("../../../contracts/io.js").ByteSource; contentType: string }) => responseBytes(transport, `${origin}${path}`, headers, request.signal, limits.maxResponseBytes, payload);
      if (model.endpoint === "chat") {
        const content = request.attachments.length ? [{ type: "text", text: request.prompt }, ...request.attachments.map(attachment => ({ type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${toBase64(attachment.bytes, limits.maxRequestBytes)}` } }))] : request.prompt;
        const messages = [...(request.system === undefined ? [] : [{ role: "system", content: request.system }]), { role: "user", content }];
        const body = jsonBody({ ...fields(request.options, ["temperature", "top_p", "max_tokens", "max_completion_tokens", "frequency_penalty", "presence_penalty", "seed", "n", "top_logprobs"], ["store", "parallel_tool_calls", "logprobs"]), model: model.id, messages, stream: true }, limits.maxRequestBytes);
        yield* chatEvents(send("/chat/completions", body), limits.maxEventBytes, request.signal);
        return;
      }
      if (request.system !== undefined) throw new TypeError("System prompts are supported only by chat models");
      if (model.endpoint === "images") {
        const outputFormat = model.outputType === "image/jpeg" ? "jpeg" : model.outputType === "image/webp" ? "webp" : "png";
        if (request.options.output_format !== undefined && request.options.output_format !== outputFormat) throw new TypeError("output_format conflicts with model outputType");
        const values: Record<string, unknown> = { ...fields(request.options, ["n", "output_compression", "partial_images"], ["stream"]), output_format: outputFormat, model: model.id, prompt: request.prompt };
        if (values.stream === true) throw new TypeError("Image event streaming is not supported by this reference provider");
        const payload = request.attachments.length ? multipart(values, request.attachments.map(file => ({ ...file, field: "image[]" })), limits.maxRequestBytes) : jsonBody(values, limits.maxRequestBytes);
        const result = await responseJson(send(request.attachments.length ? "/images/edits" : "/images/generations", payload), limits.maxResponseBytes, request.signal);
        if (!Array.isArray(result.data) || result.data.length !== 1) throw new TypeError("Expected one generated image");
        yield fromBase64((result.data[0] as { b64_json?: unknown })?.b64_json, limits.maxResponseBytes);
        return;
      }
      if (request.attachments.length > 1) throw new TypeError("Videos accept one input_reference attachment");
      const payload = multipart({ ...request.options, model: model.id, prompt: request.prompt }, request.attachments.map(file => ({ ...file, field: "input_reference" })), limits.maxRequestBytes);
      let job = await responseJson(send("/videos", payload), limits.maxResponseBytes, request.signal);
      if (typeof job.id !== "string" || !job.id) throw new TypeError("Invalid video job id");
      const path = `/videos/${encodeURIComponent(job.id)}`;
      let polls = 0;
      while (job.status !== "completed") {
        if (job.status === "failed") throw new Error("Provider video generation failed");
        if (job.status !== "queued" && job.status !== "in_progress") throw new TypeError("Invalid video job status");
        if (polls++ >= limits.maxPolls) throw new RangeError("Provider video polling limit exceeded");
        await delay(limits.pollIntervalMs, request.signal);
        job = await responseJson(send(path), limits.maxResponseBytes, request.signal);
      }
      yield* send(`${path}/content`);
    },
  };
}
