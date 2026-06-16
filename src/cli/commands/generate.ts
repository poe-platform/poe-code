import path from "node:path";
import type { Command } from "commander";
import { intro, outro, withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_BOT,
  DEFAULT_AUDIO_BOT,
  DEFAULT_VIDEO_BOT
} from "../constants.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { getGlobalClient, initializeClient } from "../../services/client-instance.js";
import type { LlmClient, LlmResponse } from "../../services/llm-client.js";
import { downloadToFile, MediaDownloadError } from "../../services/media-download.js";
import { ValidationError } from "../errors.js";
import { loadAgentModel } from "@poe-code/poe-code-config";

export interface GenerateCommandOptions {
  model?: string;
  param?: string[] | string;
  output?: string;
}

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

const KNOWN_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/octet-stream": "bin",
  "application/pdf": "pdf",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-wav": "wav",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};

const SAFE_GENERATED_EXTENSION_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function registerGenerateCommand(
  program: Command,
  container: CliContainer
): void {
  const generate = program
    .command("generate")
    .alias("g")
    .description("Generate content via Poe API.")
    .option("--model <model>", `Model identifier (default: ${DEFAULT_TEXT_MODEL})`)
    .option(
      "--param <key=value>",
      "Additional parameters (repeatable)",
      collectParam,
      []
    )
    .option("-o, --output <path>", "Output file path (media only)")
    .argument("[prompt]", "Generation prompt (for text without subcommand)")
    .action(async function (this: Command, promptArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "generate");
      const prompt = ensurePrompt(promptArg, { type: "text", isDefault: true });

      const opts = resolveGenerateOptions(this);
      const params = parseParams(normalizeParamList(opts.param));
      const model = await resolveModel("text", opts, container, { readOnly: flags.dryRun });

      if (flags.dryRun) {
        await resolveClient(container);
        resources.logger.dryRun(
          `Dry run: would generate text with model ${model} and prompt (${prompt.length} chars)`
        );
        return;
      }

      intro("generate");
      const client = await resolveClient(container);
      const response = await withSpinner<LlmResponse>({
        message: `Generating with ${model}...`,
        fn: () => client.text({ model, prompt, params }),
        stopMessage: () => model,
        subtext: (r) => r.content
      });
      if (!response.content) {
        throw new ValidationError("No response from LLM");
      }
      outro("");
    });

  generate
    .command("text")
    .description("Generate text content.")
    .option("--model <model>", `Model identifier (default: ${DEFAULT_TEXT_MODEL})`)
    .option(
      "--param <key=value>",
      "Additional parameters (repeatable)",
      collectParam,
      []
    )
    .argument("[prompt]", "Generation prompt")
    .action(async function (this: Command, promptArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "generate");
      const prompt = ensurePrompt(promptArg, { type: "text", isDefault: false });
      const opts = resolveGenerateOptions(this);
      const params = parseParams(normalizeParamList(opts.param));
      const model = await resolveModel("text", opts, container, { readOnly: flags.dryRun });

      if (flags.dryRun) {
        await resolveClient(container);
        resources.logger.dryRun(
          `Dry run: would generate text with model ${model} and prompt (${prompt.length} chars)`
        );
        return;
      }

      intro("generate text");
      const client = await resolveClient(container);
      const response = await withSpinner<LlmResponse>({
        message: `Generating with ${model}...`,
        fn: () => client.text({ model, prompt, params }),
        stopMessage: () => model,
        subtext: (r) => r.content
      });
      if (!response.content) {
        throw new ValidationError("No response from LLM");
      }
      outro("");
    });

  registerMediaSubcommand(generate, program, container, "image");
  registerMediaSubcommand(generate, program, container, "video");
  registerMediaSubcommand(generate, program, container, "audio");
}

function registerMediaSubcommand(
  generate: Command,
  program: Command,
  container: CliContainer,
  type: MediaType
): void {
  const defaultModel = DEFAULT_MODELS[type];
  generate
    .command(type)
    .description(`Generate ${type} content.`)
    .option("--model <model>", `Model identifier (default: ${defaultModel})`)
    .option(
      "--param <key=value>",
      "Additional parameters (repeatable)",
      collectParam,
      []
    )
    .option("-o, --output <path>", "Output file path")
    .argument("[prompt]", "Generation prompt")
    .action(async function (this: Command, promptArg?: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "generate");
      const prompt = ensurePrompt(promptArg, { type, isDefault: false });
      const opts = resolveGenerateOptions(this);
      const params = parseParams(normalizeParamList(opts.param));
      const model = await resolveModel(type, opts, container, { readOnly: flags.dryRun });

      if (flags.dryRun) {
        await resolveClient(container);
        resources.logger.dryRun(
          `Dry run: would generate ${type} with model ${model} and prompt (${prompt.length} chars)`
        );
        return;
      }

      intro(`generate ${type}`);
      const client = await resolveClient(container);

      const saved = await withSpinner({
        message: `Generating ${type} with ${model}...`,
        fn: async () => {
          const response = await client.media(type, { model, prompt, params });

          if (!response.url) {
            throw new ValidationError(
              buildMissingMediaMessage(type, model, response.content)
            );
          }

          const mimeType = response.mimeType ?? getDefaultMimeType(type);
          const hasExplicitOutput = opts.output !== undefined;
          const filename = opts.output ?? generateFilename(type, mimeType);
          const resolved = resolveOutputPath(filename, container.env.cwd);
          if (!hasExplicitOutput) {
            assertGeneratedOutputPathInsideCwd(resolved.path, container.env.cwd);
          }

          try {
            await downloadToFile({
              url: response.url,
              outputPath: resolved.path,
              fs: container.fs
            });
          } catch (error) {
            if (error instanceof MediaDownloadError) {
              if (error.kind === "write") {
                throw new ValidationError(
                  `Cannot write to "${resolved.label}". Check the path exists and is writable.`
                );
              }
              throw new ValidationError(
                `Failed to download ${type} from URL.\nThe file may no longer be available or the URL may have expired.`
              );
            }
            throw error;
          }

          return resolved;
        },
        stopMessage: () => `Generated ${type}`
      });
      outro(`Saved ${saved.label}`);
    });
}

export function parseParams(params: string[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const param of params) {
    const eqIndex = param.indexOf("=");
    if (eqIndex === -1) {
      throw new ValidationError(
        `Invalid param format: "${param}". Expected key=value`
      );
    }
    const key = param.slice(0, eqIndex).trim();
    if (key.length === 0) {
      throw new ValidationError(`Invalid param key: "${param}". Expected key=value`);
    }
    const value = param.slice(eqIndex + 1);
    result[key] = value;
  }
  return result;
}

function normalizeParamList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function resolveGenerateOptions(command: Command): GenerateCommandOptions {
  const current = command.opts<GenerateCommandOptions>();
  const parent = command.parent?.opts<GenerateCommandOptions>() ?? {};

  return {
    model: current.model ?? parent.model,
    param: mergeParamValues(current.param, parent.param),
    output: current.output ?? parent.output
  };
}

function mergeParamValues(
  current: string[] | string | undefined,
  parent: string[] | string | undefined
): string[] | string | undefined {
  const currentList = normalizeParamList(current);
  const parentList = normalizeParamList(parent);

  if (currentList.length === 0 && parentList.length === 0) {
    return undefined;
  }

  return [...parentList, ...currentList];
}

function collectParam(value: string, previous: string[]): string[] {
  const list = Array.isArray(previous) ? [...previous] : [];
  list.push(value);
  return list;
}


async function resolveClient(container: CliContainer): Promise<LlmClient> {
  try {
    return getGlobalClient();
  } catch {
    const apiKey = normalizeEnvModel(container.env.getVariable("POE_API_KEY")) ?? await container.readApiKey();
    if (!apiKey) {
      throw new Error("Poe API key not found. Run 'poe-code login' first.");
    }
    const apiBaseUrl = resolveApiBaseUrl(container);
    await initializeClient({
      apiKey,
      baseUrl: apiBaseUrl,
      httpClient: container.httpClient
    });
    return getGlobalClient();
  }
}

function resolveApiBaseUrl(container: CliContainer): string {
  const override = container.env.getVariable("POE_API_BASE_URL");
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  return container.env.poeApiBaseUrl;
}

async function resolveModel(
  type: GenerateType,
  options: GenerateCommandOptions,
  container: CliContainer,
  configOptions: { readOnly?: boolean } = {}
): Promise<string> {
  if (options.model !== undefined) {
    const model = options.model.trim();
    if (model.length === 0) {
      throw new ValidationError("--model must be a non-empty string.");
    }
    return model;
  }
  const envKey = MODEL_ENV_KEYS[type];
  const envModel = normalizeEnvModel(container.env.variables[envKey]);
  if (envModel) {
    return envModel;
  }
  const configModel = await loadAgentModel(
    { fs: container.fs, filePath: container.env.configPath, readOnly: configOptions.readOnly },
    `generate-${type}`
  );
  if (configModel) {
    return configModel;
  }
  return DEFAULT_MODELS[type];
}

function normalizeEnvModel(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildMissingMediaMessage(
  type: MediaType,
  model: string,
  responseContent?: string
): string {
  const article = type === "video" ? "a" : "an";
  const base = (
    `The model "${model}" did not return ${article} ${type}.` +
    `\nThis model may not support ${type} generation. Try using a different model with --model.`
  );
  const trimmed = responseContent?.trim();
  if (trimmed && trimmed.length > 0) {
    return `${base}\nResponse: ${trimmed}`;
  }
  return base;
}

function ensurePrompt(
  prompt: string | undefined,
  options: { type: GenerateType; isDefault: boolean }
): string {
  if (prompt && prompt.length > 0) {
    return prompt;
  }
  const usage = options.isDefault
    ? "poe-code generate \"your prompt\""
    : `poe-code generate ${options.type} "your prompt"`;
  throw new ValidationError(`No prompt provided. Usage: ${usage}`);
}

function generateFilename(type: MediaType, mimeType: string): string {
  const timestamp = Date.now();
  const ext = mimeTypeToExt(mimeType);
  return `${type}-${timestamp}.${ext}`;
}

function mimeTypeToExt(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  const mapped = KNOWN_MIME_EXTENSIONS[normalized];
  if (mapped) {
    return mapped;
  }
  const slashIndex = normalized.indexOf("/");
  if (slashIndex === -1 || slashIndex === normalized.length - 1) {
    return "bin";
  }
  const subtype = normalized.slice(slashIndex + 1);
  return SAFE_GENERATED_EXTENSION_PATTERN.test(subtype) ? subtype : "bin";
}

function normalizeMimeType(mimeType: string): string {
  const baseType = mimeType.split(";", 1)[0];
  return (baseType ?? "").trim().toLowerCase();
}

function getDefaultMimeType(type: MediaType): string {
  const defaults: Record<MediaType, string> = {
    image: "image/png",
    video: "video/mp4",
    audio: "audio/mp3"
  };
  return defaults[type];
}

function resolveOutputPath(filename: string, cwd: string): { path: string; label: string } {
  if (path.isAbsolute(filename)) {
    return { path: filename, label: filename };
  }
  return {
    path: path.join(cwd, filename),
    label: `./${filename}`
  };
}

function assertGeneratedOutputPathInsideCwd(outputPath: string, cwd: string): void {
  const relative = path.relative(cwd, outputPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new ValidationError(
    "Generated output filename resolved outside the current working directory."
  );
}
