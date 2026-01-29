import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import chalk from "chalk";
import { getGlobalClient } from "../services/client-instance.js";
import type { LlmResponse } from "../services/llm-client.js";
import {
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "./constants.js";

// Tool schemas - single source of truth for both MCP registration and help text
const generateTextSchema = {
  bot_name: z.string().describe("Name of the Poe bot to query"),
  message: z.string().describe("Message to send to the bot"),
  params: z.record(z.string(), z.string()).optional().describe("Additional parameters")
};

const generateImageSchema = {
  prompt: z.string().describe("Text prompt for image generation"),
  bot_name: z.string().optional().describe(`Bot to use (default: ${DEFAULT_IMAGE_BOT})`),
  params: z.record(z.string(), z.string()).optional().describe("Additional parameters")
};

const generateVideoSchema = {
  prompt: z.string().describe("Text prompt for video generation"),
  bot_name: z.string().optional().describe(`Bot to use (default: ${DEFAULT_VIDEO_BOT})`),
  params: z.record(z.string(), z.string()).optional().describe("Additional parameters")
};

const generateAudioSchema = {
  prompt: z.string().describe("Text to convert to audio"),
  bot_name: z.string().optional().describe(`Bot to use (default: ${DEFAULT_AUDIO_BOT})`),
  params: z.record(z.string(), z.string()).optional().describe("Additional parameters")
};

// Tool definitions with descriptions
const TOOL_REGISTRY = [
  {
    name: "generate_text",
    description: "Generate text using a Poe bot",
    schema: generateTextSchema
  },
  {
    name: "generate_image",
    description: "Generate an image using a Poe image model",
    schema: generateImageSchema
  },
  {
    name: "generate_video",
    description: "Generate a video using a Poe video model",
    schema: generateVideoSchema
  },
  {
    name: "generate_audio",
    description: "Convert text to audio using a Poe audio model",
    schema: generateAudioSchema
  }
] as const;

function getZodTypeName(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodRecord) return "object";
  if (schema instanceof z.ZodOptional) {
    const inner = schema.unwrap() as z.ZodTypeAny;
    return getZodTypeName(inner);
  }
  return "any";
}

function isOptional(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional;
}

export function formatMcpToolsDocs(): string {
  const lines: string[] = [];
  lines.push(chalk.magenta.bold("Available Tools"));
  lines.push("");

  for (const tool of TOOL_REGISTRY) {
    lines.push(`  ${chalk.cyan(tool.name)}`);
    lines.push(`  ${chalk.dim(tool.description)}`);
    lines.push("");
    for (const [paramName, paramSchema] of Object.entries(tool.schema)) {
      const zodSchema = paramSchema as z.ZodTypeAny;
      const typeName = getZodTypeName(zodSchema);
      const optional = isOptional(zodSchema);
      const description = zodSchema.description ?? "";
      const typeInfo = optional
        ? chalk.dim(`${typeName}, optional`)
        : chalk.dim(typeName);
      lines.push(`    ${chalk.yellow(paramName)} ${typeInfo}`);
      lines.push(`    ${description}`);
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

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "poe-code",
    version: "1.0.0"
  });

  server.tool(
    "generate_text",
    "Generate text using a Poe bot",
    generateTextSchema,
    async (args) => {
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
  );

  server.tool(
    "generate_image",
    "Generate an image using a Poe image model",
    generateImageSchema,
    async (args) => {
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
  );

  server.tool(
    "generate_video",
    "Generate a video using a Poe video model",
    generateVideoSchema,
    async (args) => {
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
  );

  server.tool(
    "generate_audio",
    "Convert text to audio using a Poe audio model",
    generateAudioSchema,
    async (args) => {
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

  return server;
}

export async function runMcpServerWithTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
