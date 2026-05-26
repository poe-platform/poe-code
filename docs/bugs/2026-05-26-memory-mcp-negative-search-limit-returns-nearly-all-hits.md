# Memory MCP negative search limit returns nearly all hits

## Summary

The exported `@poe-code/memory` MCP server accepts a negative `limit` for its `search_memory` tool and treats it as a valid JavaScript slice endpoint. A request for at most `-1` results therefore succeeds and returns every matching hit except the final one, rather than rejecting an invalid maximum-result count.

## Reproduction

Create the disposable probe `packages/memory/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createTestPair } from "tiny-stdio-mcp-server/testing";
import type { MemoryHandle } from "./handle.js";
import { startMemoryMcpServer } from "./mcp.js";

function createHandle(): MemoryHandle {
  return {
    root: "/repo/.poe-code/memory",
    listPages: vi.fn(),
    readPage: vi.fn(),
    searchMemory: vi.fn().mockResolvedValue([
      { relPath: "pages/a.md", score: 3, excerpt: "first" },
      { relPath: "pages/b.md", score: 2, excerpt: "second" },
      { relPath: "pages/c.md", score: 1, excerpt: "third" }
    ]),
    statusOf: vi.fn(),
    computeTokenStats: vi.fn(),
    explainPage: vi.fn(),
    writePage: vi.fn(),
    appendToPage: vi.fn(),
    clearMemory: vi.fn(),
    query: vi.fn(),
    ingest: vi.fn(),
    auditClaims: vi.fn()
  } as unknown as MemoryHandle;
}

describe("memory MCP negative search result limit", () => {
  it("returns nearly all hits instead of rejecting a negative maximum", async () => {
    const { server } = await startMemoryMcpServer(createHandle(), { allowWrites: false });
    const pair = await createTestPair(server);

    try {
      const result = await pair.client.callTool({
        name: "search_memory",
        arguments: { query: "needle", limit: -1 }
      });
      const payload = JSON.parse(result.content[0]!.text as string) as { hits: unknown[] };

      expect(result.isError).not.toBe(true);
      expect(payload.hits).toHaveLength(2);
    } finally {
      await pair.cleanup();
    }
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
rm -f packages/memory/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/memory/src/__probe__.test.ts > memory MCP negative search result limit > returns nearly all hits instead of rejecting a negative maximum
```

The mocked memory handle returns three hits. Calling the public `search_memory` MCP tool with `limit: -1` returns a successful tool result containing two hits because JavaScript evaluates `hits.slice(0, -1)` as “all entries except the last.”

`startMemoryMcpServer()` exposes `limit` as an optional unrestricted number in `packages/memory/src/mcp.ts:36` through `packages/memory/src/mcp.ts:42`, then applies any numeric value directly as a slice endpoint at `packages/memory/src/mcp.ts:43` through `packages/memory/src/mcp.ts:46`. The server helper is publicly exported at `packages/memory/src/index.ts:47`, and the documented embedded MCP-server API appears at `packages/memory/README.md:233` through `packages/memory/README.md:246`.

## Expected Behavior

`search_memory.limit` should accept only non-negative integer result counts, or reject malformed limits with a tool input error. A negative maximum must not successfully return an unintuitive subset of matching memory pages.

## Impact

MCP clients or agents that calculate an invalid negative search budget receive a successful response that may disclose almost the complete match set while omitting only one item. This defeats result limiting, makes malformed requests appear valid, and can expand memory-page content returned to the model beyond the caller's intended bound.
