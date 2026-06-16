import { isIP } from "node:net";
import TurndownService from "turndown";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
import { getOptionalNonNegativeInteger, getRequiredString } from "./plugin-args.js";
import type { PluginSpec } from "./registry.js";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SearchWebFn = (query: string, options: { signal: AbortSignal }) => Promise<string>;

type WebPluginOptions = {
  searchWeb?: SearchWebFn;
  fetch?: FetchFn;
};

export type WebPluginConfigOptions = Record<string, never>;

interface DuckDuckGoTopic {
  Text?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoPayload {
  AbstractText?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

const fetchUrlPageSize = 20_000;
const fetchUrlContentLimit = 200_000;
const htmlToMarkdown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced"
});

const webPlugin = (options: WebPluginOptions = {}): AgentPlugin => {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const searchWeb = options.searchWeb ?? ((query, searchOptions) => defaultSearchWeb(query, fetchFn, searchOptions.signal));

  const searchWebTool = {
    name: "search_web",
    description: "Search the web for a query.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query."
        }
      },
      required: ["query"]
    },
    async call(args: unknown, ctx: { signal: AbortSignal }): Promise<string> {
      return searchWeb(getRequiredString(args, "query"), { signal: ctx.signal });
    }
  };

  const fetchUrlTool = {
    name: "fetch_url",
    description:
      "Fetch a URL with HTTP GET. HTML is converted to markdown and responses are paginated with an offset.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch with HTTP GET."
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: `Character offset into the fetched content. Each call returns up to ${fetchUrlPageSize} characters.`
        }
      },
      required: ["url"]
    },
    async call(args: unknown, ctx: { signal: AbortSignal }): Promise<string> {
      return defaultFetchUrl(
        getRequiredString(args, "url"),
        getOptionalNonNegativeInteger(args, "offset") ?? 0,
        fetchFn,
        ctx.signal
      );
    }
  };

  return {
    name: "poe-agent-plugin-web",
    tools: [searchWebTool, fetchUrlTool]
  };
};

async function defaultSearchWeb(
  query: string,
  fetchFn: FetchFn,
  signal: AbortSignal
): Promise<string> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetchFn(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`Web search failed (${response.status})`);
  }

  const body = (await response.json()) as DuckDuckGoPayload;
  const lines: string[] = [];

  if (typeof body.AbstractText === "string" && body.AbstractText.trim().length > 0) {
    lines.push(body.AbstractText.trim());
  }

  if (body.RelatedTopics) {
    const queue = [...body.RelatedTopics];
    while (queue.length > 0 && lines.length < 5) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (typeof current.Text === "string" && current.Text.trim().length > 0) {
        lines.push(current.Text.trim());
      }

      if (current.Topics) {
        queue.push(...current.Topics);
      }
    }
  }

  if (lines.length === 0) {
    return "No search results found.";
  }

  return lines.join("\n");
}

async function defaultFetchUrl(
  url: string,
  offset: number,
  fetchFn: FetchFn,
  signal: AbortSignal
): Promise<string> {
  const parsedUrl = parseFetchUrl(url);
  const normalizedUrl = parsedUrl.toString();
  const response = await fetchFn(normalizedUrl, { signal });
  if (!response.ok) {
    throw new Error(`URL fetch failed (${response.status})`);
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  const rawContent = await readFetchedBody(response);
  const content = formatFetchedBody(rawContent, contentType);
  const start = Math.min(offset, content.length);
  const end = Math.min(start + fetchUrlPageSize, content.length);
  const page = content.slice(start, end);
  const lines = [
    `URL: ${normalizedUrl}`,
    `Content type: ${contentType}`,
    `Showing characters ${start}-${end} of ${content.length}.`
  ];

  if (end < content.length) {
    lines.push(`More content available at offset ${end}.`);
  }

  lines.push("", page);
  return lines.join("\n");
}

function parseFetchUrl(url: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid fetch_url URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("fetch_url only supports http and https URLs.");
  }

  if (isNonPublicHost(parsedUrl.hostname)) {
    throw new Error(`fetch_url cannot access non-public URL host: ${parsedUrl.hostname}`);
  }

  return parsedUrl;
}

function isNonPublicHost(hostname: string): boolean {
  const host = normalizeUrlHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  if (isIP(host) === 4) {
    return isNonPublicIpv4(host);
  }

  if (isIP(host) === 6) {
    return isNonPublicIpv6(host);
  }

  return false;
}

function normalizeUrlHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  const withoutTrailingDot = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  if (withoutTrailingDot.startsWith("[") && withoutTrailingDot.endsWith("]")) {
    return withoutTrailingDot.slice(1, -1);
  }

  return withoutTrailingDot;
}

function isNonPublicIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;
  if (a === undefined || b === undefined) {
    return true;
  }

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isNonPublicIpv6(host: string): boolean {
  if (host === "::" || host === "::1") {
    return true;
  }

  const firstHextet = Number.parseInt(host.split(":", 1)[0] ?? "", 16);
  if (!Number.isInteger(firstHextet)) {
    return true;
  }

  return (
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)
  );
}

async function readFetchedBody(response: Response): Promise<string> {
  if (response.body === null) {
    const content = await response.text();
    assertFetchedBodyLimit(content);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        content += decoder.decode();
        assertFetchedBodyLimit(content);
        return content;
      }

      content += decoder.decode(chunk.value, { stream: true });
      assertFetchedBodyLimit(content);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

function assertFetchedBodyLimit(content: string): void {
  if (content.length > fetchUrlContentLimit) {
    throw new Error(`URL fetch response exceeds ${fetchUrlContentLimit} character limit.`);
  }
}

function normalizeContentType(contentType: string | null): string {
  if (!contentType) {
    return "unknown";
  }

  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

function formatFetchedBody(content: string, contentType: string): string {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    const markdown = htmlToMarkdown.turndown(content).trim();
    return markdown.length > 0 ? markdown : "(empty response body)";
  }

  return content.length > 0 ? content : "(empty response body)";
}

export default webPlugin;

export const spec: PluginSpec<WebPluginConfigOptions> = {
  name: "web",
  parseOptions(input) {
    rejectUnknownKeys(toOptionsObject(input), []);
    return {} as WebPluginConfigOptions;
  },
  factory: () => webPlugin(),
};
