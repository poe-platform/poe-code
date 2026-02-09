import { describe, it, expect } from "vitest";
import { Readable, Writable } from "stream";
import { createServer } from "./server.js";
import { defineSchema } from "./schema.js";
import { Image } from "./content/image.js";
import { Audio } from "./content/audio.js";
import { File } from "./content/file.js";

function createTestTransport() {
  const output: string[] = [];
  const readable = new Readable({
    read() {},
  });
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      output.push(chunk.toString());
      callback();
    },
  });

  return {
    readable,
    writable,
    output,
    send(msg: string) {
      readable.push(msg + "\n");
    },
    close() {
      readable.push(null);
    },
    getLastResponse() {
      for (let i = output.length - 1; i >= 0; i -= 1) {
        const parsed = JSON.parse(output[i].trim());
        if ("id" in parsed) {
          return parsed;
        }
      }
      return null;
    },
    getAllResponses() {
      return output.map((line) => JSON.parse(line.trim()));
    },
  };
}

function getResponsesWithId(responses: Array<Record<string, unknown>>) {
  return responses.filter((response) => "id" in response);
}

describe("createServer", () => {
  describe("server creation", () => {
    it("creates a server with options", () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      expect(server).toBeDefined();
      expect(server.tool).toBeDefined();
      expect(server.listen).toBeDefined();
      expect(server.connect).toBeDefined();
      expect(server.connectSDK).toBeDefined();
    });

    it("creates server with minimal options", () => {
      const server = createServer({ name: "s", version: "0" });
      expect(server).toBeDefined();
    });

    it("creates server with long name and version", () => {
      const server = createServer({
        name: "my-very-long-server-name-for-testing",
        version: "1.0.0-beta.1+build.123",
      });
      expect(server).toBeDefined();
    });
  });

  describe("fluent API", () => {
    it("supports fluent tool chaining", () => {
      const schema = defineSchema({ name: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("a", "Tool A", schema, async () => "a")
        .tool("b", "Tool B", schema, async () => "b")
        .tool("c", "Tool C", schema, async () => "c");

      expect(server).toBeDefined();
    });

    it("returns same server instance from tool()", () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" });
      const returned = server.tool("test", "Test", schema, async () => ({
        text: "",
      }));

      expect(returned).toBe(server);
    });

    it("allows registering many tools", () => {
      const schema = defineSchema({});
      let server = createServer({ name: "test", version: "1.0.0" });

      for (let i = 0; i < 50; i++) {
        server = server.tool(`tool${i}`, `Tool ${i}`, schema, async () => ({
          text: String(i),
        }));
      }

      expect(server).toBeDefined();
    });
  });

  describe("removeTool", () => {
    it("removes a registered tool", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First", schema, async () => "1")
        .tool("tool2", "Second", schema, async () => "2");

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');

      // Wait for messages to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      const removed = server.removeTool("tool1");
      expect(removed).toBe(true);

      transport.send('{"jsonrpc":"2.0","id":3,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.tools).toHaveLength(2);
      expect(responses[2].result.tools).toHaveLength(1);
      expect(responses[2].result.tools[0].name).toBe("tool2");
    });

    it("returns false when removing non-existent tool", () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      const removed = server.removeTool("nonexistent");
      expect(removed).toBe(false);
    });

    it("returns true when removing existing tool", () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => ""
      );

      const removed = server.removeTool("test");
      expect(removed).toBe(true);
    });

    it("tool is no longer callable after removal", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => "ok"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      server.removeTool("test");

      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"test","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error.code).toBe(-32602);
      expect(responses[1].error.message).toContain("Tool not found");
    });
  });

  describe("notifyToolsChanged", () => {
    it("sends notifications/tools/list_changed via stdio transport", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => "ok"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      await server.notifyToolsChanged();

      transport.close();

      await connectPromise;

      // Check raw output for notification
      const allOutput = transport.output;
      const hasNotification = allOutput.some((line) => {
        const parsed = JSON.parse(line.trim());
        return (
          parsed.method === "notifications/tools/list_changed" &&
          parsed.jsonrpc === "2.0" &&
          !("id" in parsed)
        );
      });
      expect(hasNotification).toBe(true);
    });

    it("does not send notification before initialization", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);

      // Should not throw or send notification
      await server.notifyToolsChanged();

      transport.close();

      await connectPromise;

      // No output should be sent
      expect(transport.output).toHaveLength(0);
    });

    it("notification is proper JSON-RPC 2.0 format", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test",
        schema,
        async () => "ok"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      await server.notifyToolsChanged();

      transport.close();

      await connectPromise;

      // Find the notification in output
      const notification = transport.output.find((line) => {
        const parsed = JSON.parse(line.trim());
        return parsed.method === "notifications/tools/list_changed";
      });

      expect(notification).toBeDefined();
      const parsed = JSON.parse(notification!.trim());
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("notifications/tools/list_changed");
      expect(parsed.id).toBeUndefined();
    });
  });
});

describe("server protocol handlers", () => {
  describe("ping", () => {
    it("responds to ping", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result).toEqual({});
      expect(response.id).toBe(1);
    });

    it("responds to ping before initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({});
    });

    it("responds to multiple pings", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.send('{"jsonrpc":"2.0","id":2,"method":"ping"}');
      transport.send('{"jsonrpc":"2.0","id":3,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses).toHaveLength(3);
      expect(responses[0].id).toBe(1);
      expect(responses[1].id).toBe(2);
      expect(responses[2].id).toBe(3);
    });
  });

  describe("initialize", () => {
    it("responds to initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "my-server", version: "2.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.serverInfo.name).toBe("my-server");
      expect(response.result.serverInfo.version).toBe("2.0.0");
      expect(response.result.capabilities.tools).toEqual({ listChanged: true });
      expect(response.result.protocolVersion).toBeDefined();
    });

    it("returns listChanged capability", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.capabilities.tools.listChanged).toBe(true);
    });

    it("returns correct server info", async () => {
      const transport = createTestTransport();
      const server = createServer({
        name: "special-server",
        version: "3.1.4-alpha",
      });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.serverInfo).toEqual({
        name: "special-server",
        version: "3.1.4-alpha",
      });
    });

    it("returns tools capability", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.capabilities).toHaveProperty("tools");
    });

    it("accepts initialize with client info params", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error).toBeUndefined();
      expect(response.result.serverInfo).toBeDefined();
    });

    it("echoes requested protocol version when provided", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.result.protocolVersion).toBe("2025-06-18");
    });
  });

  describe("notifications/initialized", () => {
    it("accepts notifications/initialized notification", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      // Should only have 2 responses (initialize and ping), not 3
      // notifications/initialized is a notification (no id) and returns undefined
      expect(responses).toHaveLength(2);
      expect(responses[0].id).toBe(1);
      expect(responses[1].id).toBe(2);
    });

    it("does not respond to notifications/initialized", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );
      transport.close();

      await connectPromise;

      expect(transport.output).toHaveLength(0);
    });

    it("accepts notifications/initialized before full initialization", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      // notifications/initialized is allowed even before initialize
      transport.send(
        '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      );
      transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses).toHaveLength(1);
      expect(responses[0].result).toEqual({});
    });
  });

  describe("initialization state", () => {
    it("rejects tools/list before initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe("Server not initialized");
    });

    it("rejects tools/call before initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"test"}}'
      );
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe("Server not initialized");
    });

    it("allows tools/list after initialize", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error).toBeUndefined();
      expect(responses[1].result.tools).toBeDefined();
    });
  });

  describe("tools/list", () => {
    it("responds to tools/list after initialize", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({ name: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async () => "hello"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const toolsResponse = responses[1];
      expect(toolsResponse.result.tools).toHaveLength(1);
      expect(toolsResponse.result.tools[0].name).toBe("greet");
      expect(toolsResponse.result.tools[0].description).toBe("Say hello");
    });

    it("returns empty array when no tools registered", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.tools).toEqual([]);
    });

    it("returns all registered tools", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First tool", schema, async () => "1")
        .tool("tool2", "Second tool", schema, async () => "2")
        .tool("tool3", "Third tool", schema, async () => "3");

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.tools).toHaveLength(3);
    });

    it("includes inputSchema for each tool", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({
        name: { type: "string", description: "The name" },
        count: { type: "number", optional: true },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "test",
        "Test tool",
        schema,
        async () => ""
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"tools/list"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const tool = responses[1].result.tools[0];
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties.name.type).toBe("string");
      expect(tool.inputSchema.required).toContain("name");
    });
  });

  describe("tools/call", () => {
    it("responds to tools/call", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({ name: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async (args) => `Hello, ${args.name}!`
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"greet","arguments":{"name":"World"}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const callResponse = responses[1];
      expect(callResponse.result.content).toEqual([
        { type: "text", text: "Hello, World!" },
      ]);
    });

    it("calls correct tool handler", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First", schema, async () => "first")
        .tool("tool2", "Second", schema, async () => "second")
        .tool("tool3", "Third", schema, async () => "third");

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tool2","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("second");
    });

    it("passes arguments to handler", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({
        a: { type: "number" },
        b: { type: "number" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "add",
        "Add numbers",
        schema,
        async (args) => String(args.a + args.b)
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add","arguments":{"a":5,"b":3}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("8");
    });

    it("handles empty arguments", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "noop",
        "No-op",
        schema,
        async () => "done"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"noop","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("done");
    });

    it("handles missing arguments (defaults to empty)", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "noop",
        "No-op",
        schema,
        async () => "done"
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"noop"}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].text).toBe("done");
    });
  });

  describe("tool errors", () => {
    it("handles tool handler errors", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Always fails",
        schema,
        async () => {
          throw new Error("Something went wrong");
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const callResponse = responses[1];
      expect(callResponse.result.isError).toBe(true);
      expect(callResponse.result.content[0].text).toContain(
        "Something went wrong"
      );
    });

    it("handles sync throw", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Fails sync",
        schema,
        () => {
          throw new Error("Sync error");
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.isError).toBe(true);
      expect(responses[1].result.content[0].text).toContain("Sync error");
    });

    it("handles rejected promise", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Rejects",
        schema,
        async () => {
          await Promise.resolve(); // ensure async
          throw new Error("Rejected");
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      // Wait for async processing before closing
      await new Promise((resolve) => setTimeout(resolve, 10));
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.isError).toBe(true);
      expect(responses[1].result.content[0].text).toContain("Rejected");
    });

    it("handles non-Error throws", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Throws string",
        schema,
        () => {
          throw "string error";
        }
      );

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fail","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.isError).toBe(true);
      expect(responses[1].result.content[0].text).toContain("string error");
    });

    it("returns error for unknown tool", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"unknown","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const callResponse = responses[1];
      expect(callResponse.error.code).toBe(-32602);
      expect(callResponse.error.message).toContain("Tool not found");
    });

    it("returns error when tool name missing", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error.code).toBe(-32602);
    });
  });

  describe("unknown methods", () => {
    it("returns method not found for unknown method", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"unknown/method"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      const unknownResponse = responses[1];
      expect(unknownResponse.error.code).toBe(-32601);
      expect(unknownResponse.error.message).toBe("Method not found");
    });

    it("returns method not found for various unknown methods", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
      );
      transport.send('{"jsonrpc":"2.0","id":2,"method":"resources/list"}');
      transport.send('{"jsonrpc":"2.0","id":3,"method":"prompts/list"}');
      transport.send('{"jsonrpc":"2.0","id":4,"method":"sampling/complete"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].error.code).toBe(-32601);
      expect(responses[2].error.code).toBe(-32601);
      expect(responses[3].error.code).toBe(-32601);
    });
  });

  describe("JSON-RPC errors", () => {
    it("returns error for invalid JSON", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send("{invalid}");
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32700);
    });

    it("returns error for missing jsonrpc field", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"id":1,"method":"ping"}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
    });

    it("returns error for missing method", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1}');
      transport.close();

      await connectPromise;

      const response = transport.getLastResponse();
      expect(response.error.code).toBe(-32600);
    });

    it("handles multiple errors in sequence", async () => {
      const transport = createTestTransport();
      const server = createServer({ name: "test", version: "1.0.0" });

      const connectPromise = server.connect(transport);
      transport.send("{invalid}");
      transport.send('{"id":1,"method":"test"}');
      transport.send('{"jsonrpc":"2.0","id":2,"method":"ping"}');
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[0].error.code).toBe(-32700);
      expect(responses[1].error.code).toBe(-32600);
      expect(responses[2].result).toEqual({});
    });
  });
});

describe("server with multiple content items", () => {
  it("returns multiple content items from handler", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "multi",
      "Multiple items",
      schema,
      async () => [
        { type: "text", text: "A" } as const,
        { type: "text", text: "B" } as const,
      ]
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"multi","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    const callResponse = responses[1];
    expect(callResponse.result.content).toEqual([
      { type: "text", text: "A" },
      { type: "text", text: "B" },
    ]);
  });

  it("returns many content items", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const items = Array.from({ length: 10 }, (_, i) => ({
      type: "text" as const,
      text: `Item ${i}`,
    }));
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "many",
      "Many items",
      schema,
      async () => items
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"many","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses[1].result.content).toHaveLength(10);
  });

  it("returns empty text when handler returns empty text", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "empty",
      "Empty result",
      schema,
      async () => ""
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"empty","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses[1].result.content[0].text).toBe("");
  });
});

describe("async handlers", () => {
  it("handles async operations", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "delay",
      "Delayed response",
      schema,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "delayed";
      }
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"delay","arguments":{}}}'
    );
    // Wait for async handler to complete before closing
    await new Promise((resolve) => setTimeout(resolve, 50));
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses[1].result.content[0].text).toBe("delayed");
  });

  it("handles sync handlers", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "sync",
      "Sync response",
      schema,
      () => "sync"
    );

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sync","arguments":{}}}'
    );
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses[1].result.content[0].text).toBe("sync");
  });
});

describe("transport connection", () => {
  it("closes cleanly on EOF", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.close();

    await expect(connectPromise).resolves.toBeUndefined();
  });

  it("processes all messages before closing", async () => {
    const transport = createTestTransport();
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "test",
      "Test",
      schema,
      async () => "ok"
    );

    const connectPromise = server.connect(transport);

    transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    transport.send(
      '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}'
    );
    transport.send('{"jsonrpc":"2.0","id":3,"method":"tools/list"}');
    transport.close();

    await connectPromise;

    const responses = getResponsesWithId(transport.getAllResponses());
    expect(responses).toHaveLength(3);
  });
});

describe("request id handling", () => {
  it("preserves numeric request id", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":42,"method":"ping"}');
    transport.close();

    await connectPromise;

    expect(transport.getLastResponse().id).toBe(42);
  });

  it("preserves string request id", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":"request-abc","method":"ping"}');
    transport.close();

    await connectPromise;

    expect(transport.getLastResponse().id).toBe("request-abc");
  });

  it("preserves zero id", async () => {
    const transport = createTestTransport();
    const server = createServer({ name: "test", version: "1.0.0" });

    const connectPromise = server.connect(transport);
    transport.send('{"jsonrpc":"2.0","id":0,"method":"ping"}');
    transport.close();

    await connectPromise;

    expect(transport.getLastResponse().id).toBe(0);
  });
});

describe("content helpers integration", () => {
  describe("string return type", () => {
    it("handles tool returning plain string", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async () => "Hello, World!"
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"greet","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "text", text: "Hello, World!" },
      ]);
    });
  });

  describe("Image helper return type", () => {
    it("handles tool returning Image instance", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const base64Data = "iVBORw0KGgo=";
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-image",
        "Get image",
        schema,
        async () => Image.fromBase64(base64Data, "image/png")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-image","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "image", data: base64Data, mimeType: "image/png" },
      ]);
    });

    it("handles tool returning Image from bytes", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-image",
        "Get image",
        schema,
        async () => Image.fromBytes(pngData)
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-image","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].type).toBe("image");
      expect(responses[1].result.content[0].mimeType).toBe("image/png");
    });
  });

  describe("Audio helper return type", () => {
    it("handles tool returning Audio instance", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const base64Data = "SUQzBAAAAAA=";
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-audio",
        "Get audio",
        schema,
        async () => Audio.fromBase64(base64Data, "audio/mpeg")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-audio","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "audio", data: base64Data, mimeType: "audio/mpeg" },
      ]);
    });
  });

  describe("File helper return type", () => {
    it("handles tool returning File instance (binary)", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-file",
        "Get file",
        schema,
        async () => File.fromBytes(data, "video/mp4")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-file","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].type).toBe("resource");
      expect(responses[1].result.content[0].resource.mimeType).toBe("video/mp4");
      expect(responses[1].result.content[0].resource.blob).toBe(
        Buffer.from(data).toString("base64")
      );
    });

    it("handles tool returning File instance (text)", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "get-file",
        "Get file",
        schema,
        async () => File.fromText("Hello, world!", "text/plain")
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-file","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content[0].type).toBe("resource");
      expect(responses[1].result.content[0].resource.mimeType).toBe("text/plain");
      expect(responses[1].result.content[0].resource.text).toBe("Hello, world!");
    });
  });

  describe("array return type", () => {
    it("handles tool returning array of strings", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "multi",
        "Multiple strings",
        schema,
        async () => ["First", "Second", "Third"]
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"multi","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
        { type: "text", text: "Third" },
      ]);
    });

    it("handles tool returning mixed array with Image", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "mixed",
        "Mixed content",
        schema,
        async () => [
          "Here is an image:",
          Image.fromBase64("iVBORw0KGgo=", "image/png"),
        ]
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mixed","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toHaveLength(2);
      expect(responses[1].result.content[0]).toEqual({
        type: "text",
        text: "Here is an image:",
      });
      expect(responses[1].result.content[1]).toEqual({
        type: "image",
        data: "iVBORw0KGgo=",
        mimeType: "image/png",
      });
    });

    it("handles tool returning array with Image, Audio, and File", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "all",
        "All content types",
        schema,
        async () => [
          "Content:",
          Image.fromBase64("iVBORw0KGgo=", "image/png"),
          Audio.fromBase64("SUQzBAAAAAA=", "audio/mpeg"),
          File.fromText("data", "text/plain"),
        ]
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"all","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toHaveLength(4);
      expect(responses[1].result.content[0].type).toBe("text");
      expect(responses[1].result.content[1].type).toBe("image");
      expect(responses[1].result.content[2].type).toBe("audio");
      expect(responses[1].result.content[3].type).toBe("resource");
    });
  });

  describe("raw ContentBlock passthrough", () => {
    it("handles tool returning raw content block", async () => {
      const transport = createTestTransport();
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "raw",
        "Raw content",
        schema,
        async () => ({ type: "text", text: "raw block" })
      );

      const connectPromise = server.connect(transport);
      transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      transport.send(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"raw","arguments":{}}}'
      );
      transport.close();

      await connectPromise;

      const responses = getResponsesWithId(transport.getAllResponses());
      expect(responses[1].result.content).toEqual([
        { type: "text", text: "raw block" },
      ]);
    });
  });

});
