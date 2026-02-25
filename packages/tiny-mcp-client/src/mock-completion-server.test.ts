import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMockCompletionServer } from "./internal.js";

describe("createMockCompletionServer", () => {
  it("declares completions capability and filters prompt completions", async () => {
    const server = await createMockCompletionServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.completions).toBeDefined();

      const result = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "code_review",
        },
        argument: {
          name: "language",
          value: "py",
        },
      });

      expect(result.completion).toEqual({
        values: ["python", "pydantic", "pytest"],
        hasMore: true,
        total: 5,
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
