import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestPair, type TestPair } from "tiny-stdio-mcp-server/testing";

const appendFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  appendFileSync,
}));

import {
  createEncryptServer,
  createTestServer,
  createWordOfTheDayServer,
} from "./index.js";

describe("tool call recording", () => {
  let testPair: TestPair | null = null;

  afterEach(async () => {
    delete process.env.TOOLCRAFT_TEST_TOOL_CALL_FILE;
    appendFileSync.mockReset();
    if (testPair) {
      await testPair.cleanup();
      testPair = null;
    }
  });

  it("records calls from every single-tool server", async () => {
    process.env.TOOLCRAFT_TEST_TOOL_CALL_FILE = "/calls";

    testPair = await createTestPair(createEncryptServer());
    await testPair.client.callTool({
      name: "caesar_cipher_encrypt",
      arguments: { text: "abc" },
    });
    await testPair.cleanup();

    testPair = await createTestPair(createWordOfTheDayServer());
    await testPair.client.callTool({
      name: "word_of_the_day",
      arguments: {},
    });

    expect(appendFileSync).toHaveBeenCalledWith("/calls", "caesar_cipher_encrypt\n");
    expect(appendFileSync).toHaveBeenCalledWith("/calls", "word_of_the_day\n");
  });

  it("records calls from the combined test server", async () => {
    process.env.TOOLCRAFT_TEST_TOOL_CALL_FILE = "/calls";
    testPair = await createTestPair(createTestServer());

    await testPair.client.callTool({
      name: "caesar_cipher_encrypt",
      arguments: { text: "abc" },
    });
    await testPair.client.callTool({
      name: "word_of_the_day",
      arguments: {},
    });

    expect(appendFileSync).toHaveBeenCalledWith("/calls", "caesar_cipher_encrypt\n");
    expect(appendFileSync).toHaveBeenCalledWith("/calls", "word_of_the_day\n");
  });
});
