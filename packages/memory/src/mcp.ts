import { createServer, defineSchema } from "tiny-stdio-mcp-server";
import type { Server } from "tiny-stdio-mcp-server";
import type { MemoryHandle } from "./handle.js";

export async function startMemoryMcpServer(
  handle: MemoryHandle,
  opts: { allowWrites: boolean }
): Promise<{ stop: () => Promise<void>; server: Server }> {
  const server = createServer({
    name: "poe-code-memory",
    version: "0.0.1"
  });

  server.tool("list_pages", "List memory pages.", defineSchema({}), async () => ({
    pages: (await handle.listPages()).map((page) => ({
      rel_path: page.relPath,
      description: page.frontmatter.description ?? ""
    }))
  }));

  server.tool(
    "read_page",
    "Read a memory page.",
    defineSchema({ rel_path: { type: "string" } }),
    async ({ rel_path }: { rel_path: string }) => {
      const page = await handle.readPage(rel_path);
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
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
        throw new Error("limit must be a non-negative integer");
      }

      const hits = await handle.searchMemory(query);
      return { hits: typeof limit === "number" ? hits.slice(0, limit) : hits };
    }
  );

  server.tool("status", "Show memory status.", defineSchema({}), async () => handle.statusOf());

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
        diff: await handle.appendToPage(rel_path, content, { reason })
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
