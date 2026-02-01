import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "./server.js";
import { defineSchema } from "./schema.js";
import { createTestPair, type TestPair } from "./testing.js";

describe("SDK Client integration", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  describe("initialization", () => {
    it("completes initialize handshake with SDK Client", async () => {
      const server = createServer({ name: "test-server", version: "1.0.0" });
      testPair = await createTestPair(server);

      const serverInfo = testPair.client.getServerVersion();
      expect(serverInfo?.name).toBe("test-server");
      expect(serverInfo?.version).toBe("1.0.0");
    });

    it("returns correct server info with special characters", async () => {
      const server = createServer({
        name: "test-server-with-dashes",
        version: "1.0.0-beta.1+build.123",
      });
      testPair = await createTestPair(server);

      const serverInfo = testPair.client.getServerVersion();
      expect(serverInfo?.name).toBe("test-server-with-dashes");
      expect(serverInfo?.version).toBe("1.0.0-beta.1+build.123");
    });

    it("client receives tools capability", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      testPair = await createTestPair(server);

      const capabilities = testPair.client.getServerCapabilities();
      expect(capabilities?.tools).toBeDefined();
    });
  });

  describe("tools/list", () => {
    it("lists tools via SDK Client", async () => {
      const schema = defineSchema({
        name: { type: "string", description: "Name to greet" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async (args) => ({ text: `Hello, ${args.name}!` })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("greet");
      expect(result.tools[0].description).toBe("Say hello");
      expect(result.tools[0].inputSchema).toBeDefined();
    });

    it("returns empty tools array when no tools registered", async () => {
      const server = createServer({ name: "test", version: "1.0.0" });
      testPair = await createTestPair(server);

      const result = await testPair.client.listTools();
      expect(result.tools).toEqual([]);
    });

    it("lists many tools", async () => {
      const schema = defineSchema({});
      let server = createServer({ name: "test", version: "1.0.0" });

      for (let i = 0; i < 20; i++) {
        server = server.tool(
          `tool${i}`,
          `Tool number ${i}`,
          schema,
          async () => ({ text: String(i) })
        );
      }

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      expect(result.tools).toHaveLength(20);
    });

    it("returns correct schema for each tool", async () => {
      const schema1 = defineSchema({
        name: { type: "string", description: "User name" },
      });
      const schema2 = defineSchema({
        count: { type: "number" },
        enabled: { type: "boolean", optional: true },
      });

      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "First", schema1, async () => ({ text: "" }))
        .tool("tool2", "Second", schema2, async () => ({ text: "" }));

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool1 = result.tools.find((t) => t.name === "tool1");
      const tool2 = result.tools.find((t) => t.name === "tool2");

      expect(tool1?.inputSchema.properties?.name?.type).toBe("string");
      expect(tool1?.inputSchema.required).toContain("name");

      expect(tool2?.inputSchema.properties?.count?.type).toBe("number");
      expect(tool2?.inputSchema.properties?.enabled?.type).toBe("boolean");
      expect(tool2?.inputSchema.required).toContain("count");
      expect(tool2?.inputSchema.required).not.toContain("enabled");
    });
  });

  describe("tools/call", () => {
    it("calls tools via SDK Client", async () => {
      const schema = defineSchema({
        name: { type: "string" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "greet",
        "Say hello",
        schema,
        async (args) => ({ text: `Hello, ${args.name}!` })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "greet",
        arguments: { name: "World" },
      });

      expect(result.content).toEqual([{ type: "text", text: "Hello, World!" }]);
    });

    it("calls tool with empty arguments", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "noop",
        "No-op tool",
        schema,
        async () => ({ text: "done" })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "noop",
        arguments: {},
      });

      expect(result.content).toEqual([{ type: "text", text: "done" }]);
    });

    it("passes complex arguments correctly", async () => {
      const schema = defineSchema({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "complex",
        "Complex args",
        schema,
        async (args) => ({
          text: `str=${args.str}, num=${args.num}, bool=${args.bool}`,
        })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "complex",
        arguments: { str: "test", num: 42, bool: true },
      });

      expect(result.content).toEqual([
        { type: "text", text: "str=test, num=42, bool=true" },
      ]);
    });

    it("handles numeric calculations", async () => {
      const schema = defineSchema({
        a: { type: "number" },
        b: { type: "number" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "add",
        "Add numbers",
        schema,
        async (args) => ({ text: String(args.a + args.b) })
      );

      testPair = await createTestPair(server);

      const result1 = await testPair.client.callTool({
        name: "add",
        arguments: { a: 2, b: 3 },
      });
      expect(result1.content).toEqual([{ type: "text", text: "5" }]);

      const result2 = await testPair.client.callTool({
        name: "add",
        arguments: { a: -10, b: 5 },
      });
      expect(result2.content).toEqual([{ type: "text", text: "-5" }]);

      const result3 = await testPair.client.callTool({
        name: "add",
        arguments: { a: 0.1, b: 0.2 },
      });
      expect(parseFloat((result3.content[0] as { text: string }).text)).toBeCloseTo(0.3);
    });

    it("handles string with special characters", async () => {
      const schema = defineSchema({ text: { type: "string" } });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "echo",
        "Echo text",
        schema,
        async (args) => ({ text: args.text })
      );

      testPair = await createTestPair(server);

      const specialStrings = [
        'Contains "quotes"',
        "Has\nnewlines",
        "Has\ttabs",
        "Unicode: 日本語",
        "Emoji: 🎉",
        "Backslash: \\",
        "Mixed: \"hello\"\n\tworld\\end",
      ];

      for (const str of specialStrings) {
        const result = await testPair.client.callTool({
          name: "echo",
          arguments: { text: str },
        });
        expect(result.content).toEqual([{ type: "text", text: str }]);
      }
    });
  });

  describe("tool schema validation", () => {
    it("validates tool schema accepted by SDK Client", async () => {
      const schema = defineSchema({
        strField: { type: "string", description: "A string" },
        numField: { type: "number", optional: true },
        boolField: { type: "boolean", optional: true },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "typed",
        "Typed tool",
        schema,
        async () => ({ text: "ok" })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool = result.tools[0];
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
      expect(tool.inputSchema.required).toContain("strField");
    });

    it("schema includes all property types", async () => {
      const schema = defineSchema({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" },
        obj: { type: "object" },
        arr: { type: "array" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "allTypes",
        "All types",
        schema,
        async () => ({ text: "ok" })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool = result.tools[0];
      expect(tool.inputSchema.properties?.str?.type).toBe("string");
      expect(tool.inputSchema.properties?.num?.type).toBe("number");
      expect(tool.inputSchema.properties?.bool?.type).toBe("boolean");
      expect(tool.inputSchema.properties?.obj?.type).toBe("object");
      expect(tool.inputSchema.properties?.arr?.type).toBe("array");
    });

    it("schema includes descriptions", async () => {
      const schema = defineSchema({
        name: { type: "string", description: "The user's name" },
        age: { type: "number", description: "Age in years" },
      });
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "user",
        "User tool",
        schema,
        async () => ({ text: "ok" })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.listTools();

      const tool = result.tools[0];
      expect(tool.inputSchema.properties?.name?.description).toBe(
        "The user's name"
      );
      expect(tool.inputSchema.properties?.age?.description).toBe("Age in years");
    });
  });

  describe("tool error handling", () => {
    it("handles tool errors via SDK Client", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "fail",
        "Always fails",
        schema,
        async () => {
          throw new Error("Intentional failure");
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "fail",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Error: Intentional failure" },
      ]);
    });

    it("handles async rejection", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "reject",
        "Rejects",
        schema,
        async () => {
          await Promise.resolve();
          throw new Error("Async rejection");
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "reject",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "Async rejection"
      );
    });

    it("handles sync throw", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "syncFail",
        "Sync fail",
        schema,
        () => {
          throw new Error("Sync throw");
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "syncFail",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("Sync throw");
    });
  });

  describe("multiple content items", () => {
    it("returns multiple content items", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "multi",
        "Multiple items",
        schema,
        async () => ({
          content: [
            { type: "text", text: "First" },
            { type: "text", text: "Second" },
          ],
        })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "multi",
        arguments: {},
      });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "text", text: "First" });
      expect(result.content[1]).toEqual({ type: "text", text: "Second" });
    });

    it("returns many content items", async () => {
      const schema = defineSchema({});
      const items = Array.from({ length: 10 }, (_, i) => ({
        type: "text" as const,
        text: `Item ${i}`,
      }));
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "many",
        "Many items",
        schema,
        async () => ({ content: items })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "many",
        arguments: {},
      });

      expect(result.content).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(result.content[i]).toEqual({ type: "text", text: `Item ${i}` });
      }
    });

    it("returns single item via text shorthand", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "single",
        "Single text",
        schema,
        async () => ({ text: "Just one" })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "single",
        arguments: {},
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: "text", text: "Just one" });
    });
  });

  describe("multiple tools", () => {
    it("supports multiple tools", async () => {
      const schema1 = defineSchema({
        a: { type: "number" },
        b: { type: "number" },
      });
      const schema2 = defineSchema({ name: { type: "string" } });

      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("add", "Add numbers", schema1, async (args) => ({
          text: String(args.a + args.b),
        }))
        .tool("greet", "Say hello", schema2, async (args) => ({
          text: `Hi ${args.name}`,
        }));

      testPair = await createTestPair(server);

      const addResult = await testPair.client.callTool({
        name: "add",
        arguments: { a: 2, b: 3 },
      });
      expect(addResult.content).toEqual([{ type: "text", text: "5" }]);

      const greetResult = await testPair.client.callTool({
        name: "greet",
        arguments: { name: "Alice" },
      });
      expect(greetResult.content).toEqual([{ type: "text", text: "Hi Alice" }]);
    });

    it("calls same tool multiple times", async () => {
      let callCount = 0;
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "counter",
        "Count calls",
        schema,
        async () => {
          callCount++;
          return { text: String(callCount) };
        }
      );

      testPair = await createTestPair(server);

      const result1 = await testPair.client.callTool({
        name: "counter",
        arguments: {},
      });
      expect(result1.content).toEqual([{ type: "text", text: "1" }]);

      const result2 = await testPair.client.callTool({
        name: "counter",
        arguments: {},
      });
      expect(result2.content).toEqual([{ type: "text", text: "2" }]);

      const result3 = await testPair.client.callTool({
        name: "counter",
        arguments: {},
      });
      expect(result3.content).toEqual([{ type: "text", text: "3" }]);
    });

    it("maintains separate state per tool", async () => {
      const counters = { tool1: 0, tool2: 0 };
      const schema = defineSchema({});

      const server = createServer({ name: "test", version: "1.0.0" })
        .tool("tool1", "Tool 1", schema, async () => {
          counters.tool1++;
          return { text: `tool1: ${counters.tool1}` };
        })
        .tool("tool2", "Tool 2", schema, async () => {
          counters.tool2++;
          return { text: `tool2: ${counters.tool2}` };
        });

      testPair = await createTestPair(server);

      await testPair.client.callTool({ name: "tool1", arguments: {} });
      await testPair.client.callTool({ name: "tool1", arguments: {} });
      await testPair.client.callTool({ name: "tool2", arguments: {} });

      expect(counters.tool1).toBe(2);
      expect(counters.tool2).toBe(1);
    });
  });

  describe("async behavior", () => {
    it("handles delayed responses", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "delay",
        "Delayed",
        schema,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { text: "delayed" };
        }
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "delay",
        arguments: {},
      });

      expect(result.content).toEqual([{ type: "text", text: "delayed" }]);
    });

    it("handles sync handlers", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "sync",
        "Sync",
        schema,
        () => ({ text: "sync" })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "sync",
        arguments: {},
      });

      expect(result.content).toEqual([{ type: "text", text: "sync" }]);
    });
  });

  describe("edge cases", () => {
    it("handles empty text response", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "empty",
        "Empty",
        schema,
        async () => ({ text: "" })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "empty",
        arguments: {},
      });

      expect(result.content).toEqual([{ type: "text", text: "" }]);
    });

    it("handles very long text response", async () => {
      const longText = "x".repeat(100000);
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "long",
        "Long response",
        schema,
        async () => ({ text: longText })
      );

      testPair = await createTestPair(server);
      const result = await testPair.client.callTool({
        name: "long",
        arguments: {},
      });

      expect((result.content[0] as { text: string }).text).toBe(longText);
    });

    it("handles tool with long name", async () => {
      const longName = "a".repeat(100);
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        longName,
        "Long name tool",
        schema,
        async () => ({ text: "ok" })
      );

      testPair = await createTestPair(server);
      const listResult = await testPair.client.listTools();
      expect(listResult.tools[0].name).toBe(longName);

      const callResult = await testPair.client.callTool({
        name: longName,
        arguments: {},
      });
      expect(callResult.content).toEqual([{ type: "text", text: "ok" }]);
    });

    it("handles tool with unicode name", async () => {
      const schema = defineSchema({});
      const server = createServer({ name: "test", version: "1.0.0" }).tool(
        "工具",
        "Unicode tool",
        schema,
        async () => ({ text: "ok" })
      );

      testPair = await createTestPair(server);
      const listResult = await testPair.client.listTools();
      expect(listResult.tools[0].name).toBe("工具");
    });
  });
});

describe("createTestPair", () => {
  it("creates connected client and server", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    const pair = await createTestPair(server);

    expect(pair.client).toBeDefined();
    expect(pair.cleanup).toBeDefined();
    expect(typeof pair.cleanup).toBe("function");

    await pair.cleanup();
  });

  it("cleanup function can be called multiple times safely", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    const pair = await createTestPair(server);

    await pair.cleanup();
    await pair.cleanup();
    await pair.cleanup();
  });
});

describe("removeTool via SDK", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("removes tool and reflects in tools/list", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" })
      .tool("tool1", "First", schema, async () => ({ text: "1" }))
      .tool("tool2", "Second", schema, async () => ({ text: "2" }));

    testPair = await createTestPair(server);

    const before = await testPair.client.listTools();
    expect(before.tools).toHaveLength(2);

    const removed = server.removeTool("tool1");
    expect(removed).toBe(true);

    const after = await testPair.client.listTools();
    expect(after.tools).toHaveLength(1);
    expect(after.tools[0].name).toBe("tool2");
  });

  it("calling removed tool returns error", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "test",
      "Test",
      schema,
      async () => ({ text: "ok" })
    );

    testPair = await createTestPair(server);

    // Call tool successfully first
    const before = await testPair.client.callTool({
      name: "test",
      arguments: {},
    });
    expect(before.content).toEqual([{ type: "text", text: "ok" }]);

    // Remove the tool
    server.removeTool("test");

    // Calling again should fail
    await expect(
      testPair.client.callTool({ name: "test", arguments: {} })
    ).rejects.toThrow();
  });
});

describe("dynamic tool management via SDK", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("adding tool dynamically reflects in tools/list", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" });

    testPair = await createTestPair(server);

    // Initially no tools
    const before = await testPair.client.listTools();
    expect(before.tools).toHaveLength(0);

    // Add tool dynamically
    server.tool("dynamic", "Dynamic tool", schema, async () => ({
      text: "dynamic",
    }));

    // Verify tool is now available
    const after = await testPair.client.listTools();
    expect(after.tools).toHaveLength(1);
    expect(after.tools[0].name).toBe("dynamic");
  });

  it("dynamically added tool is callable", async () => {
    const schema = defineSchema({ msg: { type: "string" } });
    const server = createServer({ name: "test", version: "1.0.0" });

    testPair = await createTestPair(server);

    // Add tool dynamically
    server.tool("echo", "Echo message", schema, async (args) => ({
      text: args.msg,
    }));

    // Call the dynamically added tool
    const result = await testPair.client.callTool({
      name: "echo",
      arguments: { msg: "hello" },
    });

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("removing tool reflects in tools/list", async () => {
    const schema = defineSchema({});
    const server = createServer({ name: "test", version: "1.0.0" }).tool(
      "test",
      "Test",
      schema,
      async () => ({ text: "ok" })
    );

    testPair = await createTestPair(server);

    // Initially one tool
    const before = await testPair.client.listTools();
    expect(before.tools).toHaveLength(1);

    // Remove tool
    server.removeTool("test");

    // Verify tool is removed
    const after = await testPair.client.listTools();
    expect(after.tools).toHaveLength(0);
  });
});

describe("listChanged capability via SDK", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("client receives listChanged capability", async () => {
    const server = createServer({ name: "test", version: "1.0.0" });
    testPair = await createTestPair(server);

    const capabilities = testPair.client.getServerCapabilities();
    expect(capabilities?.tools?.listChanged).toBe(true);
  });
});
