import { createServer, defineSchema } from "tiny-stdio-mcp-server";
import type { JSONSchema, Server } from "tiny-stdio-mcp-server";
import type { MemoryHandle } from "./handle.js";

const listPagesOutputSchema = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rel_path: { type: "string" },
          description: { type: "string" }
        },
        required: ["rel_path", "description"],
        additionalProperties: false
      }
    }
  },
  required: ["pages"],
  additionalProperties: false
} satisfies JSONSchema;

const readPageOutputSchema = {
  type: "object",
  properties: {
    rel_path: { type: "string" },
    frontmatter: { type: "object", additionalProperties: true },
    body: { type: "string" },
    bytes: { type: "number" }
  },
  required: ["rel_path", "frontmatter", "body", "bytes"],
  additionalProperties: false
} satisfies JSONSchema;

const searchMemoryOutputSchema = {
  type: "object",
  properties: {
    hits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rel_path: { type: "string" },
          line_number: { type: "number" },
          line: { type: "string" }
        },
        required: ["rel_path", "line_number", "line"],
        additionalProperties: false
      }
    }
  },
  required: ["hits"],
  additionalProperties: false
} satisfies JSONSchema;

const statusOutputSchema = {
  type: "object",
  properties: {
    pageCount: { type: "number" },
    totalBytes: { type: "number" },
    lastWriteAt: { type: ["string", "null"] },
    initialized: { type: "boolean" }
  },
  required: ["pageCount", "totalBytes", "lastWriteAt", "initialized"],
  additionalProperties: false
} satisfies JSONSchema;

const memoryDiffOutputSchema = {
  type: "object",
  properties: {
    diff: {
      type: "object",
      properties: {
        created: { type: "array", items: { type: "string" } },
        updated: { type: "array", items: { type: "string" } },
        deleted: { type: "array", items: { type: "string" } }
      },
      required: ["created", "updated", "deleted"],
      additionalProperties: false
    }
  },
  required: ["diff"],
  additionalProperties: false
} satisfies JSONSchema;

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
  }), listPagesOutputSchema);

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
    },
    readPageOutputSchema
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
      const limitedHits = typeof limit === "number" ? hits.slice(0, limit) : hits;
      return {
        hits: limitedHits.map((hit) => ({
          rel_path: hit.relPath,
          line_number: hit.lineNumber,
          line: hit.line
        }))
      };
    },
    searchMemoryOutputSchema
  );

  server.tool("status", "Show memory status.", defineSchema({}), async () => handle.statusOf(), statusOutputSchema);

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
      }),
      memoryDiffOutputSchema
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
