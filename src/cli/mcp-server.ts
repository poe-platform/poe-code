import { createServer, defineSchema, type Server } from "@poe-code/tiny-mcp-server";
import chalk from "chalk";
import { getGlobalClient } from "../services/client-instance.js";
import type { LlmResponse } from "../services/llm-client.js";
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

interface McpTextContent {
  type: "text";
  text: string;
}

interface McpResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
  };
}

type McpContent = McpTextContent | McpResourceContent;

interface McpToolResult {
  content: McpContent[];
}

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
  return { content: [{ type: "text", text: response.content ?? "" }] };
}

export async function generateImage(args: GenerateMediaArgs): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_IMAGE_BOT;
  const response = await client.media("image", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  if (!response.url) {
    throw new Error(`Model "${model}" did not return an image URL`);
  }
  return { content: toMcpContent(response) };
}

export async function generateVideo(args: GenerateMediaArgs): Promise<McpToolResult> {
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
  return { content: toMcpContent(response) };
}

export async function generateAudio(args: GenerateMediaArgs): Promise<McpToolResult> {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_AUDIO_BOT;
  const response = await client.media("audio", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  if (!response.url) {
    throw new Error(`Model "${model}" did not return an audio URL`);
  }
  return { content: toMcpContent(response) };
}

function toMcpContent(response: LlmResponse): McpContent[] {
  const content: McpContent[] = [];

  if (response.content) {
    content.push({ type: "text", text: response.content });
  }

  if (response.url) {
    content.push({
      type: "resource",
      resource: {
        uri: response.url,
        mimeType: response.mimeType
      }
    });
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

export function createMcpServer(): Server {
  return createServer({
    name: "poe-code",
    version: "1.0.0"
  })
    .tool(
      "generate_text",
      "Generate text using a Poe bot",
      generateTextSchema,
      async (args: GenerateTextSchemaType) => {
        const result = await generateText({
          bot_name: args.bot_name,
          message: args.message,
          params: normalizeParams(args.params)
        });
        return {
          content: result.content.map((c) => {
            if (c.type === "text") {
              return { type: "text" as const, text: c.text };
            }
            return { type: "text" as const, text: `URL: ${c.resource.uri}` };
          })
        };
      }
    )
    .tool(
      "generate_image",
      "Generate an image using a Poe image model",
      generateImageSchema,
      async (args: GenerateMediaSchemaType) => {
        const result = await generateImage({
          prompt: args.prompt,
          bot_name: args.bot_name,
          params: normalizeParams(args.params)
        });
        return {
          content: result.content.map((c) => {
            if (c.type === "text") {
              return { type: "text" as const, text: c.text };
            }
            return { type: "text" as const, text: c.resource.uri };
          })
        };
      }
    )
    .tool(
      "generate_video",
      "Generate a video using a Poe video model",
      generateVideoSchema,
      async (args: GenerateMediaSchemaType) => {
        const result = await generateVideo({
          prompt: args.prompt,
          bot_name: args.bot_name,
          params: normalizeParams(args.params)
        });
        return {
          content: result.content.map((c) => {
            if (c.type === "text") {
              return { type: "text" as const, text: c.text };
            }
            return { type: "text" as const, text: c.resource.uri };
          })
        };
      }
    )
    .tool(
      "generate_audio",
      "Convert text to audio using a Poe audio model",
      generateAudioSchema,
      async (args: GenerateMediaSchemaType) => {
        const result = await generateAudio({
          prompt: args.prompt,
          bot_name: args.bot_name,
          params: normalizeParams(args.params)
        });
        return {
          content: result.content.map((c) => {
            if (c.type === "text") {
              return { type: "text" as const, text: c.text };
            }
            return { type: "text" as const, text: c.resource.uri };
          })
        };
      }
    );
}

export async function runMcpServerWithTransport(): Promise<void> {
  const server = createMcpServer();
  await server.listen();
}
