import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "../cli/constants.js";
import { getPoeApiKey } from "./credentials.js";
import { getGlobalClient, setGlobalClient } from "../services/client-instance.js";
import { createPoeClient } from "../services/llm-client.js";
import type { LlmClient } from "../services/llm-client.js";
import type {
  GenerateOptions,
  GenerateResult,
  MediaGenerateOptions,
  MediaGenerateResult
} from "./types.js";

type GenerateType = "text" | "image" | "video" | "audio";

type MediaType = "image" | "video" | "audio";

const MODEL_ENV_KEYS: Record<GenerateType, string> = {
  text: "POE_TEXT_MODEL",
  image: "POE_IMAGE_MODEL",
  video: "POE_VIDEO_MODEL",
  audio: "POE_AUDIO_MODEL"
};

const DEFAULT_MODELS: Record<GenerateType, string> = {
  text: DEFAULT_TEXT_MODEL,
  image: DEFAULT_IMAGE_BOT,
  video: DEFAULT_VIDEO_BOT,
  audio: DEFAULT_AUDIO_BOT
};

export async function generate(
  prompt: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  if (!prompt) {
    throw new Error("Prompt is required");
  }
  const client = await resolveClient();
  const model = resolveSdkModel("text", options);
  const response = await client.text({
    model,
    prompt,
    params: options.params
  });
  if (!response.content) {
    throw new Error("No response from LLM");
  }
  return { content: response.content };
}

export async function generateImage(
  prompt: string,
  options: MediaGenerateOptions = {}
): Promise<MediaGenerateResult> {
  return generateMedia("image", prompt, options);
}

export async function generateVideo(
  prompt: string,
  options: MediaGenerateOptions = {}
): Promise<MediaGenerateResult> {
  return generateMedia("video", prompt, options);
}

export async function generateAudio(
  prompt: string,
  options: MediaGenerateOptions = {}
): Promise<MediaGenerateResult> {
  return generateMedia("audio", prompt, options);
}

async function generateMedia(
  type: MediaType,
  prompt: string,
  options: MediaGenerateOptions
): Promise<MediaGenerateResult> {
  if (!prompt) {
    throw new Error("Prompt is required");
  }
  const client = await resolveClient();
  const model = resolveSdkModel(type, options);
  const response = await client.media(type, {
    model,
    prompt,
    params: options.params
  });
  if (!response.url) {
    throw new Error(`No ${type} URL returned`);
  }
  return { url: response.url, mimeType: response.mimeType };
}

async function resolveClient(): Promise<LlmClient> {
  try {
    return getGlobalClient();
  } catch {
    const apiKey = await getPoeApiKey();
    const baseUrl = normalizeBaseUrl(process.env.POE_API_BASE_URL);
    const client = createPoeClient({
      apiKey,
      baseUrl
    });
    setGlobalClient(client);
    return client;
  }
}

function resolveSdkModel(
  type: GenerateType,
  options: GenerateOptions
): string {
  if (options.model) {
    return options.model;
  }
  const envKey = MODEL_ENV_KEYS[type];
  const envModel = normalizeEnvModel(process.env[envKey]);
  return envModel ?? DEFAULT_MODELS[type];
}

function normalizeEnvModel(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(value: string | undefined): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "https://api.poe.com/v1";
}
