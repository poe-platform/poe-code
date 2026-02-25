import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMockResourceServer } from "./internal.js";

describe("createMockResourceServer", () => {
  it("responds to resources/list with both static resources", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listResources();

      expect(result.resources).toHaveLength(2);

      const resourcesByUri = new Map(result.resources.map((resource) => [resource.uri, resource]));
      expect(resourcesByUri.get("file:///readme.txt")).toMatchObject({
        uri: "file:///readme.txt",
        name: "readme.txt",
        mimeType: "text/plain",
      });
      expect(resourcesByUri.get("file:///image.png")).toMatchObject({
        uri: "file:///image.png",
        name: "image.png",
        mimeType: "image/png",
      });
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to resources/read for text resource", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.readResource({ uri: "file:///readme.txt" });

      expect(result.contents).toEqual([
        {
          uri: "file:///readme.txt",
          mimeType: "text/plain",
          text: "This is a mock README resource.",
        },
      ]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to resources/read for binary resource", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.readResource({ uri: "file:///image.png" });

      expect(result.contents).toEqual([
        {
          uri: "file:///image.png",
          mimeType: "image/png",
          blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgL9qj3QAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      await client.close();
      await clientTransport.close();
      await serverTransport.close();
      await serverPromise;
    }
  });

  it("responds to resources/templates/list with file template", async () => {
    const server = await createMockResourceServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, {});
    const serverPromise = server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listResourceTemplates();

      expect(result.resourceTemplates).toEqual([
        {
          uriTemplate: "file:///{path}",
          name: "file-template",
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
