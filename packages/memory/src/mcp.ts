import { createServer, defineSchema } from "tiny-stdio-mcp-server";
import type { Server } from "tiny-stdio-mcp-server";
import { appendToPage } from "./write.js";
import { listPages, readPage } from "./pages.js";
import { searchMemory } from "./search.js";
import { statusOf } from "./status.js";
import type { McpServerOptions } from "./types.js";

export async function startMemoryMcpServer(
  opts: McpServerOptions
): Promise<{ stop: () => Promise<void>; server: Server }> {
  const server = createServer({
    name: "poe-code-memory",
    version: "0.0.1"
  });

  server.tool("list_pages", "List memory pages.", defineSchema({}), async () => ({
    pages: (await listPages(opts.root)).map((page) => ({
      rel_path: page.relPath,
      description: page.frontmatter.description ?? ""
    }))
  }));

  server.tool(
    "read_page",
    "Read a memory page.",
    defineSchema({ rel_path: { type: "string" } }),
    async ({ rel_path }: { rel_path: string }) => {
      const page = await readPage(opts.root, rel_path);
      return {
        rel_path: page.relPath,
        frontmatter: page.frontmatter,
        body: page.body,
        bytes: page.bytes
      };
    }
  );

  server.tool(
    "search_memory",
    "Search memory pages.",
    defineSchema({
      query: { type: "string" },
      limit: { type: "number", optional: true }
    }),
    async ({ query, limit }: { query: string; limit?: number }) => {
      const hits = await searchMemory(opts.root, query);
      return { hits: typeof limit === "number" ? hits.slice(0, limit) : hits };
    }
  );

  server.tool("status", "Show memory status.", defineSchema({}), async () => statusOf(opts.root));

  if (opts.allowWrites) {
    server.tool(
      "append_to_page",
      "Append content to a memory page.",
      defineSchema({
        rel_path: { type: "string" },
        content: { type: "string" },
        reason: { type: "string" }
      }),
      async ({ rel_path, content, reason }: { rel_path: string; content: string; reason: string }) => ({
        diff: await appendToPage(opts.root, rel_path, content, { reason })
      })
    );
  }

  return {
    server,
    stop: async () => {},
  };
}

export function printMcpConfig(): string {
  return JSON.stringify(
    {
      mcpServers: {
        "poe-code-memory": {
          type: "stdio",
          command: "poe-code",
          args: ["memory-mcp"]
        }
      }
    },
    null,
    2
  );
}
