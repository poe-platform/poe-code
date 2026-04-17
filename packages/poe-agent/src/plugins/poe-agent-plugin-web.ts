import TurndownService from "turndown";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { getOptionalNonNegativeInteger, getRequiredString } from "./plugin-args.js";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SearchWebFn = (query: string, options: { signal: AbortSignal }) => Promise<string>;

type WebPluginOptions = {
  searchWeb?: SearchWebFn;
  fetch?: FetchFn;
};

interface DuckDuckGoTopic {
  Text?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoPayload {
  AbstractText?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

const fetchUrlPageSize = 20_000;
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
  const response = await fetchFn(url, { signal });
  if (!response.ok) {
    throw new Error(`URL fetch failed (${response.status})`);
  }

  const contentType = normalizeContentType(response.headers.get("content-type"));
  const rawContent = await response.text();
  const content = formatFetchedBody(rawContent, contentType);
  const start = Math.min(offset, content.length);
  const end = Math.min(start + fetchUrlPageSize, content.length);
  const page = content.slice(start, end);
  const lines = [
    `URL: ${url}`,
    `Content type: ${contentType}`,
    `Showing characters ${start}-${end} of ${content.length}.`
  ];

  if (end < content.length) {
    lines.push(`More content available at offset ${end}.`);
  }

  lines.push("", page);
  return lines.join("\n");
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
