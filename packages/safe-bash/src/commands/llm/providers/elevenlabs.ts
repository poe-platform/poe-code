import type { LlmModel, LlmProvider, LlmRequest } from "../types.js";
import type { HttpTransport } from "../../network/types.js";
import { baseUrl, credential, providerLimits, fields, jsonBody, responseBytes, type LlmProviderLimits } from "./shared.js";

const audioFormats: Readonly<Record<string, string>> = { "audio/mpeg": "mp3_44100_128", "audio/wav": "wav_44100", "audio/pcm": "pcm_44100", "audio/ogg": "opus_48000_128", "audio/basic": "ulaw_8000" };

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

export function createElevenLabsProvider(options: ElevenLabsProviderOptions): LlmProvider {
  const origin = baseUrl(options.baseUrl ?? "https://api.elevenlabs.io");
  const headers = [["xi-api-key", credential(options.apiKey)]] as const;
  const transport = options.transport;
  const limits = providerLimits(options.limits);
  const models = options.models.map(model => Object.freeze({ ...model, ...(model.aliases ? { aliases: Object.freeze([...model.aliases]) } : {}), ...(model.attachmentTypes ? { attachmentTypes: Object.freeze([...model.attachmentTypes]) } : {}) }));
  if (typeof transport !== "function") throw new TypeError("Provider transport is required");
  for (const model of models) {
    if (!["tts", "music"].includes(model.endpoint)) throw new TypeError("Invalid ElevenLabs endpoint");
    if (!Object.hasOwn(audioFormats, model.outputType ?? "") || (model.endpoint === "music" && model.outputType === "audio/wav")) throw new TypeError("Unsupported ElevenLabs model outputType");
  }
  return {
    name: "elevenlabs", models: Object.freeze(models),
    async *complete(request: LlmRequest) {
      request.signal.throwIfAborted();
      const model = models.find(candidate => candidate.id === request.model);
      if (!model) throw new Error(`Unknown model: ${request.model}`);
      if (request.attachments.length) throw new TypeError("ElevenLabs reference endpoints do not accept attachments");
      if (request.system !== undefined) throw new TypeError("ElevenLabs reference endpoints do not accept system prompts");
      const format = audioFormats[model.outputType!]!;
      const { output_format: requestedFormat, ...requestOptions } = request.options;
      if (requestedFormat !== undefined && requestedFormat !== format) throw new TypeError("output_format conflicts with model outputType");
      let path: string, body: Record<string, unknown>;
      if (model.endpoint === "tts") {
        const { voice_id: selectedVoice, ...settings } = requestOptions;
        const voice = selectedVoice ?? model.defaultVoiceId;
        if (!voice) throw new TypeError("ElevenLabs TTS requires voice_id or defaultVoiceId");
        path = `/v1/text-to-speech/${encodeURIComponent(voice)}`;
        body = { text: request.prompt, model_id: model.id, voice_settings: fields(settings, ["stability", "similarity_boost", "style", "speed"], ["use_speaker_boost"]) };
      } else {
        path = "/v1/music";
        body = { ...fields(requestOptions, ["music_length_ms", "seed"], ["force_instrumental", "respect_sections_durations"]), prompt: request.prompt, model_id: model.id };
        if (body.music_length_ms !== undefined && !Number.isInteger(body.music_length_ms)) throw new TypeError("Invalid music_length_ms: expected integer");
      }
      yield* responseBytes(transport, `${origin}${path}?output_format=${format}`, headers, request.signal, limits.maxResponseBytes, jsonBody(body, limits.maxRequestBytes));
    },
  };
}
