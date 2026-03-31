import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "bun:test";
import { createMockFullFeaturedServer } from "./internal.js";

describe("createMockFullFeaturedServer", () => {
  it("initializes with all core capabilities and exposes tool/resource/prompt entries", async () => {
    const server = await createMockFullFeaturedServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()).toMatchObject({
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
        completions: {},
      });

      const toolsResult = await client.listTools();
      const resourcesResult = await client.listResources();
      const promptsResult = await client.listPrompts();

      expect(toolsResult.tools).toHaveLength(1);
      expect(resourcesResult.resources).toHaveLength(1);
      expect(promptsResult.prompts).toHaveLength(1);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
