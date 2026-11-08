import type { HttpClient, HttpResponse } from "../cli/http.js";
import { ApiError } from "../cli/errors.js";
import { redactHttpBodyText } from "../utils/redaction.js";

export interface LlmRequest {
  model: string;
  prompt: string;
  params?: Record<string, string>;
}

export interface LlmResponse {
  content?: string;
  url?: string;
  mimeType?: string;
  data?: string;
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

    async media(type, request): Promise<LlmResponse> {
      const data = await requestCompletion(httpClient, options.baseUrl, options.apiKey, request);
      return extractMediaFromCompletion(type, data);
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
    const redactedDetail = detail === undefined ? undefined : redactHttpBodyText(detail);
    const message =
      redactedDetail === undefined
        ? `Poe API error (${response.status})`
        : `Poe API error (${response.status}): ${redactedDetail}`;
    throw new ApiError(message, {
      httpStatus: response.status,
      endpoint: "chat/completions",
      context: redactedDetail === undefined ? undefined : { responseBody: redactedDetail }
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

function extractMediaFromCompletion(
  type: "image" | "video" | "audio",
  data: unknown
): LlmResponse {
  const content = extractTextContent(data);
  if (!content) return {};

  // Try parsing as JSON first (API returns { url, mimeType })
  try {
    const parsed = JSON.parse(content);
    if (isRecord(parsed) && typeof parsed.url === "string") {
      return {
        url: parsed.url,
        mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : undefined,
        data: typeof parsed.data === "string" ? parsed.data : undefined
      };
    }

    if (isRecord(parsed) && typeof parsed.data === "string") {
      return {
        data: parsed.data,
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

  // Try extracting media-specific markdown (e.g., "![image](url)" or "[video](url)").
  const markdownUrl = extractMarkdownMediaUrl(content, type);
  if (markdownUrl) {
    return { url: markdownUrl };
  }

  // No URL found, return content for error message
  return { content };
}

function extractMarkdownMediaUrl(
  content: string,
  type: "image" | "video" | "audio"
): string | undefined {
  let searchFrom = 0;
  while (searchFrom < content.length) {
    const openLabel = content.indexOf("[", searchFrom);
    if (openLabel === -1) return undefined;
    const closeLabel = content.indexOf("](", openLabel);
    if (closeLabel === -1) return undefined;

    const urlStart = closeLabel + 2;
    const urlEnd = content.indexOf(")", urlStart);
    if (urlEnd === -1) return undefined;

    const label = content.slice(openLabel + 1, closeLabel);
    const url = content.slice(urlStart, urlEnd);
    const isImageMarkdown = openLabel > 0 && content[openLabel - 1] === "!";
    if (isValidUrl(url) && isGeneratedMediaLabel(label, type, isImageMarkdown)) {
      return url;
    }

    searchFrom = urlEnd + 1;
  }

  return undefined;
}

function isGeneratedMediaLabel(
  label: string,
  type: "image" | "video" | "audio",
  isImageMarkdown: boolean
): boolean {
  if (type === "image" && isImageMarkdown) {
    return true;
  }
  return labelTokens(label).includes(type);
}

function labelTokens(label: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of label.toLowerCase()) {
    const code = char.charCodeAt(0);
    const isAsciiLetter = code >= 97 && code <= 122;
    const isAsciiDigit = code >= 48 && code <= 57;
    if (isAsciiLetter || isAsciiDigit) {
      current += char;
      continue;
    }
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
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
