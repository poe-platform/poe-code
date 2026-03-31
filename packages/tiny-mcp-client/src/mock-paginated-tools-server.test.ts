import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "bun:test";
import { createMockPaginatedToolsServer } from "./internal.js";

describe("createMockPaginatedToolsServer", () => {
  it("returns 5 tools per page with nextCursor only on non-final pages", async () => {
    const server = await createMockPaginatedToolsServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const firstPage = await client.listTools();
      expect(firstPage.tools).toHaveLength(5);
      expect(firstPage.nextCursor).toBe("5");

      const secondPage = await client.listTools({ cursor: firstPage.nextCursor });
      expect(secondPage.tools).toHaveLength(5);
      expect(secondPage.nextCursor).toBe("10");

      const thirdPage = await client.listTools({ cursor: secondPage.nextCursor });
      expect(thirdPage.tools).toHaveLength(5);
      expect(thirdPage.nextCursor).toBe("15");

      const fourthPage = await client.listTools({ cursor: thirdPage.nextCursor });
      expect(fourthPage.tools).toHaveLength(5);
      expect(fourthPage.nextCursor).toBeUndefined();
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("iterates all pages and collects all 20 tools", async () => {
    const server = await createMockPaginatedToolsServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const collectedNames: string[] = [];
      let cursor: string | undefined;

      do {
        const page =
          cursor === undefined
            ? await client.listTools()
            : await client.listTools({ cursor });
        collectedNames.push(...page.tools.map((tool) => tool.name));
        cursor = page.nextCursor;
      } while (cursor !== undefined);

      expect(collectedNames).toHaveLength(20);
      expect(new Set(collectedNames).size).toBe(20);
      expect(collectedNames[0]).toBe("tool-1");
      expect(collectedNames[19]).toBe("tool-20");
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
