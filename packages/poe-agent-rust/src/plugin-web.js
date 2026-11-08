import { native } from "./native.js";
import { rejectUnknownKeys, toOptionsObject } from "./parse-options.js";
import { getOptionalNonNegativeInteger, getRequiredString } from "./plugin-args.js";
const fetchUrlPageSize = 20000;
const fetchUrlContentLimit = 200000;
const webPlugin = (options = {}) => {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const searchWeb =
    options.searchWeb ??
    ((query, searchOptions) => defaultSearchWeb(query, fetchFn, searchOptions.signal));
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
    async call(args, ctx) {
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
    async call(args, ctx) {
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
async function defaultSearchWeb(query, fetchFn, signal) {
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
  const body = await response.json();
  const state = new native.NativeAgentWebSearch();
  if (typeof body.AbstractText === "string" && body.AbstractText.trim().length > 0) {
    state.push(body.AbstractText);
  }
  if (body.RelatedTopics) {
    const queue = [...body.RelatedTopics];
    while (queue.length > 0 && !state.complete) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      if (typeof current.Text === "string" && current.Text.trim().length > 0) {
        state.push(current.Text);
      }
      if (current.Topics) {
        queue.push(...current.Topics);
      }
    }
  }
  return state.format();
}
async function defaultFetchUrl(url, offset, fetchFn, signal) {
  const parsedUrl = parseFetchUrl(url);
  const normalizedUrl = parsedUrl.toString();
  const response = await fetchFn(normalizedUrl, { signal });
  if (!response.ok) {
    throw new Error(`URL fetch failed (${response.status})`);
  }
  const contentType = native.agentWebContentType(response.headers.get("content-type"));
  const rawContent = await readFetchedBody(response, signal);
  const content = formatFetchedBody(rawContent, contentType);
  return native.agentWebPage(normalizedUrl, contentType, content, offset);
}
function parseFetchUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid fetch_url URL.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("fetch_url only supports http and https URLs.");
  }
  if (native.agentWebNonPublicHost(parsedUrl.hostname)) {
    throw new Error(`fetch_url cannot access non-public URL host: ${parsedUrl.hostname}`);
  }
  return parsedUrl;
}
async function readFetchedBody(response, signal) {
  signal?.throwIfAborted();
  if (response.body === null) {
    const content = await response.text();
    signal?.throwIfAborted();
    assertFetchedBodyLimit(content);
    return content;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
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
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
function assertFetchedBodyLimit(content) {
  if (content.length > fetchUrlContentLimit) {
    throw new Error(`URL fetch response exceeds ${fetchUrlContentLimit} character limit.`);
  }
}
export default webPlugin;
export const spec = {
  name: "web",
  parseOptions(input) {
    rejectUnknownKeys(toOptionsObject(input), []);
    return {};
  },
  factory: () => webPlugin()
};

function formatFetchedBody(content, contentType) {
  const formatted =
    contentType === "text/html" || contentType === "application/xhtml+xml"
      ? native.agentHtmlMarkdown(content)
      : content;
  return formatted.length ? formatted : "(empty response body)";
}
