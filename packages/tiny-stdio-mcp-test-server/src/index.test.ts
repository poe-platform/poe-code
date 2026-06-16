import { describe, it, expect, afterEach } from "vitest";
import { createTestPair, type TestPair } from "tiny-stdio-mcp-server/testing";
import { createTestServer, caesarEncrypt } from "./index.js";
import packageJson from "../package.json" with { type: "json" };

describe("caesarEncrypt", () => {
  it("encrypts lowercase letters with default shift", () => {
    expect(caesarEncrypt("abc", 3)).toBe("def");
    expect(caesarEncrypt("xyz", 3)).toBe("abc");
  });

  it("encrypts uppercase letters", () => {
    expect(caesarEncrypt("ABC", 3)).toBe("DEF");
    expect(caesarEncrypt("XYZ", 3)).toBe("ABC");
  });

  it("preserves non-alphabetic characters", () => {
    expect(caesarEncrypt("hello, world!", 3)).toBe("khoor, zruog!");
  });

  it("handles mixed case", () => {
    expect(caesarEncrypt("Hello World", 3)).toBe("Khoor Zruog");
  });

  it("handles different shift values", () => {
    expect(caesarEncrypt("abc", 1)).toBe("bcd");
    expect(caesarEncrypt("abc", 13)).toBe("nop");
    expect(caesarEncrypt("abc", 26)).toBe("abc");
  });

  it("wraps negative shifts backwards", () => {
    expect(caesarEncrypt("abc ABC", -1)).toBe("zab ZAB");
  });

  it.each([1.5, Number.NaN])("rejects invalid shifts %s", (shift) => {
    expect(() => caesarEncrypt("abc", shift)).toThrow("integer");
  });
});

describe("tiny-stdio-mcp-test-server via SDK", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  describe("initialization", () => {
    it("completes initialize handshake", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const serverInfo = testPair.client.getServerVersion();
      expect(serverInfo?.name).toBe("tiny-stdio-mcp-test-server");
      expect(serverInfo?.version).toBe(packageJson.version);
    });
  });

  describe("tools/list", () => {
    it("lists both tools", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.listTools();
      expect(result.tools).toHaveLength(2);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("caesar_cipher_encrypt");
      expect(toolNames).toContain("word_of_the_day");
    });

    it("caesar_cipher_encrypt has correct schema", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.listTools();
      const caesarTool = result.tools.find(
        (t) => t.name === "caesar_cipher_encrypt"
      );

      expect(caesarTool?.description).toBe(
        "Encrypts text using the Caesar cipher"
      );
      expect(caesarTool?.inputSchema.properties?.text?.type).toBe("string");
      expect(caesarTool?.inputSchema.properties?.shift?.type).toBe("integer");
      expect(caesarTool?.inputSchema.required).toContain("text");
      expect(caesarTool?.inputSchema.required).not.toContain("shift");
    });

    it("word_of_the_day has correct schema", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.listTools();
      const wordTool = result.tools.find((t) => t.name === "word_of_the_day");

      expect(wordTool?.description).toBe("Returns the word of the day");
      expect(wordTool?.inputSchema.required).toEqual([]);
    });
  });

  describe("caesar_cipher_encrypt tool", () => {
    it("encrypts text with default shift", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.callTool({
        name: "caesar_cipher_encrypt",
        arguments: { text: "hello" },
      });

      expect(result.content).toEqual([{ type: "text", text: "khoor" }]);
    });

    it("encrypts text with custom shift", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.callTool({
        name: "caesar_cipher_encrypt",
        arguments: { text: "hello", shift: 1 },
      });

      expect(result.content).toEqual([{ type: "text", text: "ifmmp" }]);
    });

    it("handles uppercase letters", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.callTool({
        name: "caesar_cipher_encrypt",
        arguments: { text: "HELLO" },
      });

      expect(result.content).toEqual([{ type: "text", text: "KHOOR" }]);
    });

    it("preserves non-alphabetic characters", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.callTool({
        name: "caesar_cipher_encrypt",
        arguments: { text: "Hello, World!" },
      });

      expect(result.content).toEqual([{ type: "text", text: "Khoor, Zruog!" }]);
    });
  });

  describe("word_of_the_day tool", () => {
    it("returns the word of the day", async () => {
      const server = createTestServer();
      testPair = await createTestPair(server);

      const result = await testPair.client.callTool({
        name: "word_of_the_day",
        arguments: {},
      });

      expect(result.content).toEqual([
        { type: "text", text: "Bumfuzzle - to confuse or fluster someone" },
      ]);
    });
  });
});
