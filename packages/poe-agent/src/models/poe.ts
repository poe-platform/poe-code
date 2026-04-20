import { createSecretStore } from "auth-store";
import type { AcpModel, AcpModelRequestMessage } from "../runtime/acp-core.js";
import { toolResultPartToText } from "../runtime/tool-results.js";
import type { ToolResultPart } from "../runtime/types.js";

export type PoeFetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type CreatePoeAcpModelOptions = {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: PoeFetchFn;
};

export async function createPoeAcpModel(options: CreatePoeAcpModelOptions): Promise<AcpModel> {
  const apiKey = await resolveApiKey(options.apiKey);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const endpoint = toChatCompletionsUrl(options.baseUrl ?? "https://api.poe.com");

  return {
    async complete(request) {
      const payload = {
        model: options.model,
        messages: request.messages.map(message => ({
          ...message,
          ...(message.role === "tool" && typeof message.name === "string"
            ? { name: message.name }
            : {}),
          ...(message.tool_calls
            ? {
                tool_calls: message.tool_calls.map(call => ({
                  ...call,
                  function: {
                    ...call.function,
                    name: call.function.name,
                  },
                })),
              }
            : {}),
          content: serializeProviderMessageContent(message.content),
        })),
        ...(request.tools.length === 0
          ? {}
          : {
              tools: request.tools.map(tool => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description ?? "",
                  parameters: normalizeToolInputSchema(tool.inputSchema),
                },
              })),
            }),
      };

      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: request.signal,
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(
          `Poe API request failed (${response.status}): ${details || response.statusText}`,
        );
      }

      const json = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning_content?: string;
            reasoning?: string;
            tool_calls?: AcpModelRequestMessage["tool_calls"];
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: {
            cached_tokens?: number;
          };
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
      const message = json.choices?.[0]?.message;

      if (!message) {
        throw new Error("Poe API response did not include an assistant message.");
      }

      const usage = extractUsage(json.usage);

      return {
        message: {
          content: message.content,
          ...(message.reasoning_content === undefined
            ? {}
            : {
                reasoning_content: message.reasoning_content,
              }),
          ...(message.reasoning === undefined
            ? {}
            : {
                reasoning: message.reasoning,
              }),
          ...(message.tool_calls === undefined
            ? {}
            : {
                tool_calls: message.tool_calls,
              }),
        },
        ...(usage === undefined ? {} : { usage }),
      };
    },
  };
}

function extractUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined,
):
  | {
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cacheCreationTokens: number;
    }
  | undefined {
  if (!usage) {
    return undefined;
  }

  const inputTokens = toNonNegativeInteger(usage.prompt_tokens) ?? 0;
  const outputTokens = toNonNegativeInteger(usage.completion_tokens) ?? 0;
  const cachedTokens =
    toNonNegativeInteger(usage.prompt_tokens_details?.cached_tokens) ??
    toNonNegativeInteger(usage.cache_read_input_tokens) ??
    0;
  const cacheCreationTokens = toNonNegativeInteger(usage.cache_creation_input_tokens) ?? 0;

  if (
    inputTokens === 0
    && outputTokens === 0
    && cachedTokens === 0
    && cacheCreationTokens === 0
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheCreationTokens,
  };
}

function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.trunc(value);
}

async function resolveApiKey(explicitApiKey: string | undefined): Promise<string> {
  const normalizedExplicitApiKey = toNonEmptyString(explicitApiKey);
  if (normalizedExplicitApiKey) {
    return normalizedExplicitApiKey;
  }

  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc",
    },
  });
  const storedApiKey = toNonEmptyString(await store.get());
  if (storedApiKey) {
    return storedApiKey;
  }

  throw new Error("Missing Poe API key. Provide apiKey or run 'poe-code login'.");
}

function toChatCompletionsUrl(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  if (trimmedBaseUrl.endsWith("/v1")) {
    return `${trimmedBaseUrl}/chat/completions`;
  }

  return `${trimmedBaseUrl}/v1/chat/completions`;
}

function serializeProviderMessageContent(
  content: AcpModelRequestMessage["content"],
):
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    > {
  if (typeof content === "string") {
    return content;
  }

  return content.map(part => serializeProviderContentPart(part));
}

function serializeProviderContentPart(part: ToolResultPart):
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    } {
  if (part.type === "image") {
    return {
      type: "image_url",
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`,
      },
    };
  }

  return {
    type: "text",
    text: toolResultPartToText(part),
  };
}

function normalizeToolInputSchema(schema: unknown): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
} {
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema)) {
    const objectSchema = schema as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };

    return {
      type: "object",
      properties: objectSchema.properties ?? {},
      ...(objectSchema.required === undefined ? {} : { required: [...objectSchema.required] }),
    };
  }

  return {
    type: "object",
    properties: {},
  };
}

function toNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
