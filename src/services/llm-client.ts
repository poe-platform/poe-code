import type { HttpClient, HttpResponse } from "../cli/http.js";
import { ApiError } from "../cli/errors.js";

export interface LlmRequest {
  model: string;
  prompt: string;
  params?: Record<string, string>;
}

export interface LlmResponse {
  content?: string;
  url?: string;
  mimeType?: string;
}

export interface LlmClient {
  text(request: LlmRequest): Promise<LlmResponse>;
  media(type: "image" | "video" | "audio", request: LlmRequest): Promise<LlmResponse>;
}

export interface PoeClientOptions {
  apiKey: string;
  baseUrl: string;
  httpClient?: HttpClient;
}

export function createPoeClient(options: PoeClientOptions): LlmClient {
  const httpClient = options.httpClient ?? createDefaultHttpClient();

  return {
    async text(request): Promise<LlmResponse> {
      const data = await requestCompletion(httpClient, options.baseUrl, options.apiKey, request);
      return { content: extractTextContent(data) };
    },

    async media(_type, request): Promise<LlmResponse> {
      const data = await requestCompletion(httpClient, options.baseUrl, options.apiKey, request);
      return extractMediaFromCompletion(data);
    }
  };
}

function createDefaultHttpClient(): HttpClient {
  return async (url, init) => {
    const response = await globalThis.fetch(url, init as RequestInit);
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json(),
      text: () => response.text()
    };
  };
}

async function requestCompletion(
  httpClient: HttpClient,
  baseUrl: string,
  apiKey: string,
  request: LlmRequest
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: [{ role: "user", content: request.prompt }]
  };
  if (request.params && Object.keys(request.params).length > 0) {
    body.extra_body = request.params;
  }

  const response = await httpClient(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await readErrorBody(response);
    const message = detail ? `Poe API error (${response.status}): ${detail}` : `Poe API error (${response.status})`;
    throw new ApiError(message, {
      httpStatus: response.status,
      endpoint: "chat/completions",
      context: detail ? { responseBody: detail } : undefined
    });
  }

  return response.json();
}

async function readErrorBody(response: HttpResponse): Promise<string | undefined> {
  if (!response.text) {
    return undefined;
  }
  try {
    const text = await response.text();
    return text?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function extractTextContent(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!isRecord(first)) return undefined;
  const message = first.message;
  if (!isRecord(message)) return undefined;
  return typeof message.content === "string" ? message.content : undefined;
}

function extractMediaFromCompletion(data: unknown): LlmResponse {
  const content = extractTextContent(data);
  if (!content) return {};

  // Try parsing as JSON first (API returns { url, mimeType })
  try {
    const parsed = JSON.parse(content);
    if (isRecord(parsed) && typeof parsed.url === "string") {
      return {
        url: parsed.url,
        mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : undefined
      };
    }
  } catch {
    // Not JSON, continue
  }

  // Try as raw URL
  if (isValidUrl(content.trim())) {
    return { url: content.trim() };
  }

  // Try extracting URL from markdown (e.g., "![image](url)")
  const markdownUrl = extractMarkdownUrl(content);
  if (markdownUrl) {
    return { url: markdownUrl };
  }

  // No URL found, return content for error message
  return { content };
}

function extractMarkdownUrl(content: string): string | undefined {
  const start = content.indexOf("](");
  if (start === -1) return undefined;
  const urlStart = start + 2;
  const end = content.indexOf(")", urlStart);
  if (end === -1) return undefined;
  const url = content.slice(urlStart, end);
  return isValidUrl(url) ? url : undefined;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
