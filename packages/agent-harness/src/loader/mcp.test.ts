import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { dump, makeMcpModule } from "@poe-code/safe-js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

const { runHarnessPair } = await import("./run.js");

describe("managed MCP through the harness loader", () => {
  beforeEach(() => vol.reset());

  it("rebinds named methods without reconnecting or repeating completed tools", async () => {
    vol.fromJSON({
      "/repo/test.md": "---\nkind: test\nversion: 1\n---\n",
      "/repo/test.ajs":
        'import {server,client} from "mcp"; export default async(frontmatter)=>{const docs=await client(server("docs")); return await docs.tool("echo",{value:7});};'
    });
    const methods: string[] = [];
    const fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(null, { status: 405 });
      if (init?.method === "DELETE") {
        methods.push("close");
        return new Response(null, { status: 204 });
      }
      const request = JSON.parse(String(init?.body));
      methods.push(request.method);
      if (request.id === undefined) return new Response(null, { status: 202 });
      const result =
        request.method === "initialize"
          ? {
              protocolVersion: request.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "test", version: "1" }
            }
          : { content: [{ type: "text", text: "7" }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
        headers: { "content-type": "application/json", "mcp-session-id": "test" }
      });
    };
    const options = {
      modulesFor: () => ({
        mcp: makeMcpModule({ servers: { docs: { url: "https://example.test/mcp" } }, fetch })
      }),
      snapshotPath: "/repo/snapshot.json"
    };
    let result = await runHarnessPair("/repo/test.md", options);
    expect(result).toMatchObject({ ok: true, returnValue: { content: [{ text: "7" }] } });
    expect(methods.at(-1)).toBe("close");
    const count = methods.length;
    for (let generation = 0; generation < 2; generation++) {
      vol.writeFileSync(options.snapshotPath, await dump(result));
      result = await runHarnessPair("/repo/test.md", options);
      expect(result).toMatchObject({ ok: true, returnValue: { content: [{ text: "7" }] } });
    }
    expect(methods).toHaveLength(count);
  });
});
