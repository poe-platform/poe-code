import type { AgentPlugin } from "../runtime/plugin-types.js";
import { getRequiredString } from "./plugin-args.js";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SearchWebFn = (query: string) => Promise<string>;

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

const webPlugin = (options: WebPluginOptions = {}): AgentPlugin => {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const searchWeb = options.searchWeb ?? (query => defaultSearchWeb(query, fetchFn));

  const searchWebTool = {
    name: "search_web",
    description: "Search the web for a query.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
      },
      required: ["query"],
    },
    async call(args: unknown): Promise<string> {
      return searchWeb(getRequiredString(args, "query"));
    },
  };

  return {
    name: "poe-agent-plugin-web",
    tools: [searchWebTool],
  };
};

async function defaultSearchWeb(query: string, fetchFn: FetchFn): Promise<string> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetchFn(url.toString());
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

export default webPlugin;
