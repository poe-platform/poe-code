import {
  createServer,
  defineSchema,
  type Server,
  type ContentBlock,
  Image,
  Audio
} from "tiny-stdio-mcp-server";
import chalk from "chalk";
import { getGlobalClient } from "../services/client-instance.js";
import type { LlmResponse } from "../services/llm-client.js";
import {
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "./constants.js";
import type { McpOutputFormat } from "./mcp-output-format.js";

// Tool schemas using defineSchema
const generateTextSchema = defineSchema({
  bot_name: { type: "string", description: "Name of the Poe bot to query" },
  message: { type: "string", description: "Message to send to the bot" },
  params: { type: "object", description: "Additional parameters", optional: true }
});

const generateImageSchema = defineSchema({
  prompt: { type: "string", description: "Text prompt for image generation" },
  bot_name: { type: "string", description: `Bot to use (default: ${DEFAULT_IMAGE_BOT})`, optional: true },
  params: { type: "object", description: "Additional parameters", optional: true }
});

const generateVideoSchema = defineSchema({
  prompt: { type: "string", description: "Text prompt for video generation" },
  bot_name: { type: "string", description: `Bot to use (default: ${DEFAULT_VIDEO_BOT})`, optional: true },
  params: { type: "object", description: "Additional parameters", optional: true }
});

const generateAudioSchema = defineSchema({
  prompt: { type: "string", description: "Text to convert to audio" },
  bot_name: { type: "string", description: `Bot to use (default: ${DEFAULT_AUDIO_BOT})`, optional: true },
  params: { type: "object", description: "Additional parameters", optional: true }
});

// Tool definitions with descriptions for help text
interface ToolRegistryEntry {
  name: string;
  description: string;
  schema: Record<string, { type: string; description?: string; optional?: boolean }>;
}

const TOOL_REGISTRY: ToolRegistryEntry[] = [
  {
    name: "generate_text",
    description: "Generate text using a Poe bot",
    schema: {
      bot_name: { type: "string", description: "Name of the Poe bot to query" },
      message: { type: "string", description: "Message to send to the bot" },
      params: { type: "object", description: "Additional parameters", optional: true }
    }
  },
  {
    name: "generate_image",
    description: "Generate an image using a Poe image model",
    schema: {
      prompt: { type: "string", description: "Text prompt for image generation" },
      bot_name: { type: "string", description: `Bot to use (default: ${DEFAULT_IMAGE_BOT})`, optional: true },
      params: { type: "object", description: "Additional parameters", optional: true }
    }
  },
  {
    name: "generate_video",
    description: "Generate a video using a Poe video model",
    schema: {
      prompt: { type: "string", description: "Text prompt for video generation" },
      bot_name: { type: "string", description: `Bot to use (default: ${DEFAULT_VIDEO_BOT})`, optional: true },
      params: { type: "object", description: "Additional parameters", optional: true }
    }
  },
  {
    name: "generate_audio",
    description: "Convert text to audio using a Poe audio model",
    schema: {
      prompt: { type: "string", description: "Text to convert to audio" },
      bot_name: { type: "string", description: `Bot to use (default: ${DEFAULT_AUDIO_BOT})`, optional: true },
      params: { type: "object", description: "Additional parameters", optional: true }
    }
  }
];

export function formatMcpToolsDocs(): string {
  const lines: string[] = [];
  lines.push(chalk.magenta.bold("Available Tools"));
  lines.push("");

  for (const tool of TOOL_REGISTRY) {
    lines.push(`  ${chalk.cyan(tool.name)}`);
    lines.push(`  ${chalk.dim(tool.description)}`);
    lines.push("");
    for (const [paramName, paramDef] of Object.entries(tool.schema)) {
      const typeInfo = paramDef.optional
        ? chalk.dim(`${paramDef.type}, optional`)
        : chalk.dim(paramDef.type);
      lines.push(`    ${chalk.yellow(paramName)} ${typeInfo}`);
      lines.push(`    ${paramDef.description ?? ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

type McpToolResult = ContentBlock[];

interface GenerateTextArgs {
  bot_name: string;
  message: string;
  params?: Record<string, string>;
}

interface GenerateMediaArgs {
  prompt: string;
  bot_name?: string;
  params?: Record<string, string>;
}

export async function generateText(args: GenerateTextArgs): Promise<McpToolResult> {
  const client = getGlobalClient();
  const response = await client.text({
    model: args.bot_name,
    prompt: args.message,
    params: args.params
  });
  return [{ type: "text", text: response.content ?? "" }];
}

export async function generateImage(
  args: GenerateMediaArgs,
  outputFormatPreferences: McpOutputFormat[] = ["url"]
): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_IMAGE_BOT;
  const response = await client.media("image", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  return toPreferredMediaContent({
    mediaType: "image",
    model,
    outputFormatPreferences,
    response
  });
}

export async function generateVideo(
  args: GenerateMediaArgs,
  outputFormatPreferences: McpOutputFormat[] = ["url"]
): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_VIDEO_BOT;
  const response = await client.media("video", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  return toPreferredMediaContent({
    mediaType: "video",
    model,
    outputFormatPreferences,
    response
  });
}

export async function generateAudio(
  args: GenerateMediaArgs,
  outputFormatPreferences: McpOutputFormat[] = ["url"]
): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_AUDIO_BOT;
  const response = await client.media("audio", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  return toPreferredMediaContent({
    mediaType: "audio",
    model,
    outputFormatPreferences,
    response
  });
}

type MediaType = "image" | "audio" | "video";

function filenameFromUrlPathname(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/")) {
      return fallback;
    }
    const segments = parsed.pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    const last = segments.at(-1);
    return last && last.length > 0 ? last : fallback;
  } catch {
    return fallback;
  }
}

async function toPreferredMediaContent(options: {
  mediaType: MediaType;
  model: string;
  outputFormatPreferences: McpOutputFormat[];
  response: LlmResponse;
}): Promise<ContentBlock[]> {
  const content: ContentBlock[] = [];
  if (options.response.content) {
    content.push({ type: "text", text: options.response.content });
  }

  const preferenceErrors: string[] = [];

  for (const format of options.outputFormatPreferences) {
    if (format === "markdown") {
      if (!options.response.url) {
        throw new Error(
          `markdown output requires a URL for ${options.mediaType}. Model response did not include a URL.`
        );
      }

      if (options.mediaType === "image") {
        content.push({
          type: "text",
          text: `![Image](${options.response.url})`
        });
        return content;
      }

      const fallbackFilename = options.mediaType === "audio" ? "audio" : "video";
      const filename = filenameFromUrlPathname(options.response.url, fallbackFilename);
      content.push({
        type: "text",
        text: `[${filename}](${options.response.url})`
      });
      return content;
    }

    if (format === "markdown_instructions") {
      if (!options.response.url) {
        throw new Error(
          `markdown_instructions output requires a URL for ${options.mediaType}. Model response did not include a URL.`
        );
      }

      const markdownInstruction = {
        image: {
          action: "Render this image as markdown image tag in the chat",
          urlKey: "image_url"
        },
        audio: {
          action: "Render this audio as markdown link in the chat",
          urlKey: "audio_url"
        },
        video: {
          action: "Render this video as markdown link in the chat",
          urlKey: "video_url"
        }
      } as const;

      const instruction = markdownInstruction[options.mediaType];
      content.push({
        type: "text",
        text: `${instruction.action}\n\n${instruction.urlKey}: ${options.response.url}`
      });
      return content;
    }

    if (format === "url") {
      if (options.response.url) {
        content.push({ type: "text", text: options.response.url });
        return content;
      }
      preferenceErrors.push("url output requires a URL");
      continue;
    }

    if (format === "base64") {
      const base64Block = await tryToBase64ContentBlock(
        options.mediaType,
        options.response
      );
      if (base64Block) {
        content.push(base64Block);
        return content;
      }
      preferenceErrors.push(base64OutputRequirement(options.mediaType));
      continue;
    }
  }

  if (
    options.outputFormatPreferences.length === 1 &&
    options.outputFormatPreferences[0] === "url"
  ) {
    throw new Error(
      `Cannot produce url output for ${options.mediaType} from model "${options.model}": ` +
        `response did not include a URL. ` +
        `If the model returns base64 data, try "--output-format base64" or "--output-format base64,url".`
    );
  }

  throw new Error(
    `Cannot produce requested media output for ${options.mediaType} from model "${options.model}". ` +
      `Preferences: ${options.outputFormatPreferences.join(",")}. ` +
      `Available: ${describeMediaAvailability(options.mediaType, options.response)}. ` +
      `Tried: ${preferenceErrors.join("; ")}.`
  );
}

function base64OutputRequirement(mediaType: MediaType): string {
  if (mediaType === "video") {
    return "base64 output is not supported for video";
  }
  return "base64 output requires base64 data or a convertible URL";
}

function describeMediaAvailability(mediaType: MediaType, response: LlmResponse): string {
  const parts: string[] = [];
  if (typeof response.url === "string") {
    parts.push("url: present");
  } else {
    parts.push("url: missing");
  }

  if (typeof response.data === "string") {
    parts.push("data: present");
    if (typeof response.mimeType === "string") {
      parts.push(`mimeType: ${response.mimeType}`);
    } else if (mediaType !== "video") {
      parts.push("mimeType: missing");
    }
  } else {
    parts.push("data: missing");
  }

  if (typeof response.content === "string" && response.content.trim().length > 0) {
    parts.push("content: present");
  }

  return parts.join(", ");
}

async function tryToBase64ContentBlock(
  mediaType: MediaType,
  response: LlmResponse
): Promise<ContentBlock | undefined> {
  if (mediaType === "video") {
    return undefined;
  }

  if (typeof response.data === "string") {
    if (typeof response.mimeType === "string") {
      return mediaType === "image"
        ? { type: "image", data: response.data, mimeType: response.mimeType }
        : { type: "audio", data: response.data, mimeType: response.mimeType };
    }

    try {
      const decoded = Buffer.from(response.data, "base64");
      const bytes = new Uint8Array(decoded);
      return mediaType === "image"
        ? Image.fromBytes(bytes).toContentBlock()
        : Audio.fromBytes(bytes).toContentBlock();
    } catch {
      // fall through to URL conversion if available
    }
  }

  if (typeof response.url === "string") {
    try {
      return mediaType === "image"
        ? (await Image.fromUrl(response.url)).toContentBlock()
        : (await Audio.fromUrl(response.url)).toContentBlock();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function normalizeParams(
  params: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!params) return undefined;
  const result = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

interface GenerateTextSchemaType {
  bot_name: string;
  message: string;
  params?: Record<string, unknown>;
}

interface GenerateMediaSchemaType {
  prompt: string;
  bot_name?: string;
  params?: Record<string, unknown>;
}

export function createMcpServer(
  outputFormatPreferences: McpOutputFormat[] = ["url"]
): Server {
  return createServer({
    name: "poe-code",
    version: "1.0.0"
  })
    .tool(
      "generate_text",
      "Generate text using a Poe bot",
      generateTextSchema,
      async (args: GenerateTextSchemaType) => {
        return generateText({
          bot_name: args.bot_name,
          message: args.message,
          params: normalizeParams(args.params)
        });
      }
    )
    .tool(
      "generate_image",
      "Generate an image using a Poe image model",
      generateImageSchema,
      async (args: GenerateMediaSchemaType) => {
        return generateImage({
          prompt: args.prompt,
          bot_name: args.bot_name,
          params: normalizeParams(args.params)
        }, outputFormatPreferences);
      }
    )
    .tool(
      "generate_video",
      "Generate a video using a Poe video model",
      generateVideoSchema,
      async (args: GenerateMediaSchemaType) => {
        return generateVideo({
          prompt: args.prompt,
          bot_name: args.bot_name,
          params: normalizeParams(args.params)
        }, outputFormatPreferences);
      }
    )
    .tool(
      "generate_audio",
      "Convert text to audio using a Poe audio model",
      generateAudioSchema,
      async (args: GenerateMediaSchemaType) => {
        return generateAudio({
          prompt: args.prompt,
          bot_name: args.bot_name,
          params: normalizeParams(args.params)
        }, outputFormatPreferences);
      }
    );
}

export async function runMcpServerWithTransport(
  outputFormatPreferences: McpOutputFormat[] = ["url"]
): Promise<void> {
  const server = createMcpServer(outputFormatPreferences);
  await server.listen();
}
