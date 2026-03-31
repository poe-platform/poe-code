import { describe, expect, it } from "bun:test";
import {
  McpClient,
  createMockResourceServer,
  createMockSubscribableResourceServer,
  createSdkTestPair,
} from "./internal.js";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for resource update notification");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("McpClient SDK integration resources", () => {
  it("lists resources and reads text resource content", async () => {
    const server = await createMockResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listResources();
      const textResource = listResult.resources.find(
        (resource) => resource.mimeType === "text/plain"
      );

      expect(textResource).toBeDefined();
      if (textResource === undefined) {
        throw new Error("Expected text resource from resources/list");
      }

      const readResult = await client.readResource({ uri: textResource.uri });

      expect(readResult.contents).toEqual([
        {
          uri: "file:///readme.txt",
          mimeType: "text/plain",
          text: "This is a mock README resource.",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("lists resources and reads binary resource blob", async () => {
    const server = await createMockResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const listResult = await client.listResources();
      const binaryResource = listResult.resources.find(
        (resource) => resource.mimeType === "image/png"
      );

      expect(binaryResource).toBeDefined();
      if (binaryResource === undefined) {
        throw new Error("Expected binary resource from resources/list");
      }

      const readResult = await client.readResource({ uri: binaryResource.uri });

      expect(readResult.contents).toEqual([
        {
          uri: "file:///image.png",
          mimeType: "image/png",
          blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgL9qj3QAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("lists resource templates and exposes uriTemplate", async () => {
    const server = await createMockResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );

    try {
      const result = await client.listResourceTemplates();

      expect(result.resourceTemplates).toEqual([
        {
          uriTemplate: "file:///{path}",
          name: "file-template",
        },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("subscribes to a resource and receives updated notification", async () => {
    const resourceUri = "file:///readme.txt";
    const updatedUris: string[] = [];
    const server = await createMockSubscribableResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onResourceUpdated: async (uri) => {
          updatedUris.push(uri);
        },
      })
    );

    try {
      await client.subscribe(resourceUri);
      await server.triggerResourceUpdated(resourceUri);

      await waitFor(() => updatedUris.includes(resourceUri));
      expect(updatedUris).toEqual([resourceUri]);
    } finally {
      await cleanup();
    }
  });

  it("unsubscribes from a resource and does not receive further updates", async () => {
    const resourceUri = "file:///readme.txt";
    const updatedUris: string[] = [];
    const server = await createMockSubscribableResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onResourceUpdated: async (uri) => {
          updatedUris.push(uri);
        },
      })
    );

    try {
      await client.subscribe(resourceUri);
      await server.triggerResourceUpdated(resourceUri);
      await waitFor(() => updatedUris.length === 1);

      await client.unsubscribe(resourceUri);
      updatedUris.length = 0;

      await server.triggerResourceUpdated(resourceUri);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(updatedUris).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("runs resource subscription lifecycle and receives notifications in order", async () => {
    const resourceUri = "file:///readme.txt";
    const notifications: string[] = [];
    const server = await createMockSubscribableResourceServer();
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
        onResourcesChanged: async () => {
          notifications.push("notifications/resources/list_changed");
        },
        onResourceUpdated: async (uri) => {
          notifications.push(`notifications/resources/updated:${uri}`);
        },
      })
    );

    try {
      const listResult = await client.listResources();
      expect(listResult.resources).toEqual([
        {
          uri: resourceUri,
          name: "readme.txt",
          mimeType: "text/plain",
        },
      ]);

      await client.subscribe(resourceUri);
      await server.triggerResourceListChanged();
      await server.triggerResourceUpdated(resourceUri, "Updated resource text after subscribe.");
      await waitFor(() => notifications.length === 2);

      const readResult = await client.readResource({ uri: resourceUri });
      expect(readResult.contents).toEqual([
        {
          uri: resourceUri,
          mimeType: "text/plain",
          text: "Updated resource text after subscribe.",
        },
      ]);
      expect(notifications).toEqual([
        "notifications/resources/list_changed",
        `notifications/resources/updated:${resourceUri}`,
      ]);

      await client.unsubscribe(resourceUri);
      await server.triggerResourceUpdated(resourceUri, "Ignored resource text after unsubscribe.");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(notifications).toEqual([
        "notifications/resources/list_changed",
        `notifications/resources/updated:${resourceUri}`,
      ]);
    } finally {
      await cleanup();
    }
  });
});
