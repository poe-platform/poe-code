import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProgressNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "bun:test";
import { createMockProgressServer } from "./internal.js";

describe("createMockProgressServer", () => {
  it("sends 3+ progress notifications for slow_task before returning the final result", async () => {
    const server = await createMockProgressServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const progressUpdates: Array<{
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      progressUpdates.push(notification.params);
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const progressToken = "slow-task-1";
      const result = await client.callTool({
        name: "slow_task",
        _meta: {
          progressToken,
        },
      });

      expect(result).toMatchObject({
        content: [{ type: "text", text: "slow_task complete" }],
      });

      expect(progressUpdates).toHaveLength(4);
      expect(progressUpdates).toEqual([
        {
          progressToken,
          progress: 1,
          total: 4,
          message: "Completed step 1 of 4",
        },
        {
          progressToken,
          progress: 2,
          total: 4,
          message: "Completed step 2 of 4",
        },
        {
          progressToken,
          progress: 3,
          total: 4,
          message: "Completed step 3 of 4",
        },
        {
          progressToken,
          progress: 4,
          total: 4,
          message: "Completed step 4 of 4",
        },
      ]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
