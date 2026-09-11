import type { HttpTransport } from "../network/types.js";
import type { LlmModel, LlmProvider } from "./types.js";
import { streamElevenLabs } from "./elevenlabs-stream.js";
import { acceptsMimeType } from "./mime.js";
import { credential, providerLimits, jsonBody, type LlmProviderLimits } from "./providers/shared.js";

export interface ElevenLabsModel extends LlmModel {
  readonly endpoint: "tts" | "music";
  readonly defaultVoiceId?: string;
}

export interface ElevenLabsProviderOptions {
  readonly transport: HttpTransport;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly models: readonly ElevenLabsModel[];
  readonly limits?: Partial<LlmProviderLimits>;
}

const outputFormats = new Map([
  ["audio/mpeg", "mp3_44100_128"],
  ["audio/wav", "wav_44100"],
  ["audio/x-wav", "wav_44100"],
  ["audio/pcm", "pcm_44100"],
  ["audio/basic", "ulaw_8000"],
  ["audio/opus", "opus_48000_128"],
  ["audio/ogg", "opus_48000_128"],
]);

const optionTypes = {
  tts: new Map([
    ["stability", "number"], ["similarity_boost", "number"], ["style", "number"],
    ["speed", "number"], ["use_speaker_boost", "boolean"],
  ]),
  music: new Map([
    ["music_length_ms", "integer"], ["seed", "integer"], ["force_instrumental", "boolean"],
    ["respect_sections_durations", "boolean"], ["store_for_inpainting", "boolean"],
    ["sign_with_c2pa", "boolean"],
  ]),
};

function parseOptions(options: Readonly<Record<string, string>>, endpoint: ElevenLabsModel["endpoint"]): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(options).map(([key, value]) => {
    const type = optionTypes[endpoint].get(key);
    if (!type) return [key, value];
    if (type === "boolean") {
      if (value === "true" || value === "false") return [key, value === "true"];
    } else {
      const number = value.trim() ? Number(value) : NaN;
      if (Number.isFinite(number) && (type !== "integer" || Number.isSafeInteger(number))) return [key, number];
    }
    throw new Error(`Invalid ElevenLabs option ${key}: expected ${type}`);
  }));
}

export function createElevenLabsProvider(options: ElevenLabsProviderOptions): LlmProvider {
  const transport = options.transport;
  if (typeof transport !== "function") throw new TypeError("Provider transport is required");
  const apiKey = credential(options.apiKey);
  const limits = providerLimits(options.limits);
  const baseUrl = new URL(options.baseUrl ?? "https://api.elevenlabs.io");
  if (!["https:", "http:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("Invalid ElevenLabs baseUrl: expected an HTTP(S) URL without credentials, query, or fragment");
  }
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  const models = options.models.map(model => Object.freeze({
    ...model,
    ...(model.aliases === undefined ? {} : { aliases: Object.freeze([...model.aliases]) }),
    ...(model.attachmentTypes === undefined ? {} : { attachmentTypes: Object.freeze([...model.attachmentTypes]) }),
  }));
  const byId = new Map<string, { model: (typeof models)[number]; format: string }>();
  for (const model of models) {
    if (model.endpoint !== "tts" && model.endpoint !== "music") throw new Error(`Invalid ElevenLabs endpoint: ${model.endpoint}`);
    if (!model.outputType) throw new TypeError("ElevenLabs models require an audio outputType");
    const mimeType = model.outputType.split(";", 1)[0]!.trim().toLowerCase();
    const format = outputFormats.get(mimeType);
    if (!format || !acceptsMimeType([mimeType], model.outputType) || (model.endpoint === "music" && format.startsWith("wav_"))) {
      throw new Error(`Unsupported ElevenLabs outputType for ${model.endpoint}: ${model.outputType}`);
    }
    if (model.attachmentTypes?.length) throw new Error(`ElevenLabs model ${model.id} does not accept attachments`);
    if (!model.id || byId.has(model.id)) throw new Error(`Duplicate or empty ElevenLabs model: ${model.id}`);
    byId.set(model.id, { model, format });
  }
  return {
    name: "elevenlabs",
    models: Object.freeze(models),
    async *complete(request) {
      request.signal.throwIfAborted();
      const entry = byId.get(request.model);
      if (!entry) throw new Error(`Unknown model: ${request.model}`);
      const { model, format } = entry;
      if (request.attachments.length) throw new Error(`Model ${model.id} does not accept ${request.attachments[0]!.mimeType} attachments`);
      if (request.system !== undefined) throw new TypeError("ElevenLabs reference endpoints do not accept system prompts");
      const { output_format: requestedFormat, ...requestOptions } = request.options;
      if (requestedFormat !== undefined && requestedFormat !== format) throw new TypeError("output_format conflicts with model outputType");
      let path: string;
      let body: Record<string, unknown>;
      if (model.endpoint === "tts") {
        const { voice_id: suppliedVoice, ...settings } = requestOptions;
        const voice = suppliedVoice ?? model.defaultVoiceId;
        if (!voice?.trim()) throw new Error(`ElevenLabs model ${model.id} requires voice_id or a configured defaultVoiceId`);
        if (voice === "." || voice === "..") throw new Error("Invalid ElevenLabs voice_id: dot segments are not allowed");
        path = `v1/text-to-speech/${encodeURIComponent(voice)}`;
        body = { text: request.prompt, model_id: model.id, voice_settings: parseOptions(settings, model.endpoint) };
      } else {
        path = "v1/music";
        body = { ...parseOptions(requestOptions, model.endpoint), prompt: request.prompt, model_id: model.id };
      }
      const url = new URL(path, baseUrl);
      url.searchParams.set("output_format", format);
      const payload = jsonBody(body, limits.maxRequestBytes);
      yield* streamElevenLabs(transport, {
        url: url.href,
        method: "POST",
        headers: [["xi-api-key", apiKey], ...payload.headers, ["accept", model.outputType!]],
        body: payload.body,
        signal: request.signal,
      }, limits.maxResponseBytes);
    },
  };
}
