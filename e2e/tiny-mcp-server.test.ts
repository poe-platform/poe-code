import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "../packages/tiny-http-mcp-server/src/http-server.js";
import { nodeFetch } from "../packages/tiny-http-mcp-server/src/test-support.js";

describe("tiny MCP server", () => {
  const cleanups: Array<() => Promise<void>> = [];
  const files: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
    await Promise.all(files.splice(0).map((file) => unlink(file).catch(() => undefined)));
  });

  it("serves prompts and resources over a spawned stdio process", async () => {
    const source = join(tmpdir(), `tiny-mcp-features-${process.pid}-${Date.now()}.ts`);
    files.push(source);
    await writeFile(
      source,
      `import { createServer } from ${JSON.stringify(new URL("../packages/tiny-stdio-mcp-server/src/index.ts", import.meta.url).href)};\n` +
        `createServer({ name: "e2e", version: "1.0.0" })\n` +
        `  .prompt({ name: "hello" }, () => ({ messages: [{ role: "user", content: { type: "text", text: "hello" } }] }))\n` +
        `  .resource({ uri: "memory://hello", name: "hello" }, () => ({ contents: [{ uri: "memory://hello", text: "hello" }] }))\n` +
        `  .listen();\n`,
      "utf8"
    );
    const client = new Client({ name: "e2e-client", version: "1.0.0" });
    cleanups.push(() => client.close());
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", source],
      stderr: "pipe",
    }));

    expect((await client.listPrompts()).prompts[0]?.name).toBe("hello");
    expect((await client.readResource({ uri: "memory://hello" })).contents[0]).toMatchObject({ text: "hello" });
  });

  it("serves prompts and resources over a real HTTP listener", async () => {
    const server = createHttpServer({ name: "e2e-http", version: "1.0.0" })
      .prompt({ name: "hello" }, () => ({ messages: [{ role: "user", content: { type: "text", text: "hello" } }] }))
      .resource({ uri: "memory://hello", name: "hello" }, () => ({ contents: [{ uri: "memory://hello", text: "hello" }] }));
    const handle = await server.listenHttp({ port: 0 });
    const client = new Client({ name: "e2e-http-client", version: "1.0.0" });
    cleanups.push(async () => {
      await client.close();
      await handle.close();
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url), { fetch: nodeFetch }));

    expect((await client.listPrompts()).prompts[0]?.name).toBe("hello");
    expect((await client.readResource({ uri: "memory://hello" })).contents[0]).toMatchObject({ text: "hello" });
  });
});
