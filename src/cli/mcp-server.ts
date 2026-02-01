import {
  createServer,
  defineSchema,
  type Server,
  Image,
  Audio,
  type ContentBlock
} from "@poe-code/tiny-mcp-server";
import chalk from "chalk";
import { getGlobalClient } from "../services/client-instance.js";
import type { LlmResponse } from "../services/llm-client.js";
import {
  DEFAULT_AGENT,
  getAgentProfile,
  type McpAgentProfile
} from "./mcp-agents.js";
import {
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "./constants.js";

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
  profile: McpAgentProfile
): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_IMAGE_BOT;
  const response = await client.media("image", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  const hasBase64 = typeof response.data === "string" && typeof response.mimeType === "string";
  if (!response.url && !(profile.supportsRichContent && hasBase64)) {
    throw new Error(`Model "${model}" did not return an image URL`);
  }
  return toMcpContent(response, profile, "image");
}

export async function generateVideo(
  args: GenerateMediaArgs,
  profile: McpAgentProfile
): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_VIDEO_BOT;
  const response = await client.media("video", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  if (!response.url) {
    throw new Error(`Model "${model}" did not return a video URL`);
  }
  return toMcpContent(response, profile, "video");
}

export async function generateAudio(
  args: GenerateMediaArgs,
  profile: McpAgentProfile
): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_AUDIO_BOT;
  const response = await client.media("audio", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  const hasBase64 = typeof response.data === "string" && typeof response.mimeType === "string";
  if (!response.url && !(profile.supportsRichContent && hasBase64)) {
    throw new Error(`Model "${model}" did not return an audio URL`);
  }
  return toMcpContent(response, profile, "audio");
}

function toMcpContent(
  response: LlmResponse,
  profile: McpAgentProfile,
  mediaType?: "image" | "audio" | "video"
): ContentBlock[] {
  const content: ContentBlock[] = [];

  if (response.content) {
    content.push({ type: "text", text: response.content });
  }

  const data = response.data;
  const mimeType = response.mimeType;
  const hasBase64 = typeof data === "string" && typeof mimeType === "string";
  if (profile.supportsRichContent && hasBase64 && mediaType) {
    if (mediaType === "image") {
      content.push(Image.fromBase64(data, mimeType).toContentBlock());
    } else if (mediaType === "audio") {
      content.push(Audio.fromBase64(data, mimeType).toContentBlock());
    }
  } else if (response.url) {
    content.push({ type: "text", text: response.url });
  }

  return content;
}

function normalizeParams(
  params: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!params) return undefined;
  const result: Record<string, string> = {};
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

export function createMcpServer(profile?: McpAgentProfile): Server {
  const resolvedProfile = resolveAgentProfile(profile);
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
        }, resolvedProfile);
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
        }, resolvedProfile);
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
        }, resolvedProfile);
      }
    );
}

export async function runMcpServerWithTransport(profile: McpAgentProfile): Promise<void> {
  const server = createMcpServer(profile);
  await server.listen();
}

function resolveAgentProfile(profile?: McpAgentProfile): McpAgentProfile {
  if (profile) {
    return profile;
  }
  const fallback = getAgentProfile(DEFAULT_AGENT);
  if (!fallback) {
    throw new Error(`Unknown agent: ${DEFAULT_AGENT}`);
  }
  return fallback;
}
