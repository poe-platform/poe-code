import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createMockSubscribableResourceServer } from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for notification");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("createMockSubscribableResourceServer", () => {
  it("accepts subscriptions and sends update/list_changed notifications", async () => {
    const server = await createMockSubscribableResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const updatedUris: string[] = [];
    let listChangedCount = 0;

    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
      updatedUris.push(notification.params.uri);
    });
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
      listChangedCount += 1;
    });

    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      expect(client.getServerCapabilities()?.resources).toMatchObject({
        subscribe: true,
        listChanged: true,
      });

      await client.subscribeResource({ uri: "file:///readme.txt" });

      await server.triggerResourceUpdated("file:///image.png");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(updatedUris).toEqual([]);

      await server.triggerResourceUpdated("file:///readme.txt");
      await waitFor(() => updatedUris.includes("file:///readme.txt"));
      expect(updatedUris).toEqual(["file:///readme.txt"]);

      await server.triggerResourceListChanged();
      await waitFor(() => listChangedCount === 1);
      expect(listChangedCount).toBe(1);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });
});
