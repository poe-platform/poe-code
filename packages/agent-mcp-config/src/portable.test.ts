import { build } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function loadPortableRuntime(entry = "./index.ts") {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["workerd"],
    format: "iife",
    globalName: "runtime",
    logLevel: "silent",
    alias: {
      "@poe-code/safe-fs/contracts": fileURLToPath(new URL("../../safe-fs/src/contracts/index.ts", import.meta.url)),
      "toolcraft-design/components/template": fileURLToPath(new URL("../../toolcraft-design/src/components/template.ts", import.meta.url)),
      "@poe-code/frontmatter": fileURLToPath(new URL("../../frontmatter/src/index.ts", import.meta.url)),
      "@poe-code/config-mutations": fileURLToPath(new URL("../../config-mutations/src/index.ts", import.meta.url)),
      "@poe-code/agent-defs": fileURLToPath(new URL("../../agent-defs/src/index.ts", import.meta.url)),
      "@poe-code/user-error": fileURLToPath(new URL("../../user-error/src/index.ts", import.meta.url))
    }
  });
  return runInNewContext(`${result.outputFiles[0].text}; runtime`, {
    crypto: globalThis.crypto,
    Error,
    TextEncoder,
    TextDecoder,
    setTimeout
  });
}

describe("portable MCP configuration", () => {
  it("configures idempotently and preserves conflicting servers without Node built-ins", async () => {
    const runtime = await loadPortableRuntime();
    const volume = Volume.fromJSON({ "/home/agent/.claude.json": "{}" });
    const fs = createFsFromVolume(volume).promises;
    const options = { fs, homeDir: "/home/agent", platform: "linux" };
    const server = { name: "tools", config: { transport: "stdio", command: "tools", args: ["serve"], env: { A: "a", B: "b" } } };
    await runtime.configure("claude-code", server, options);
    const before = await fs.readFile("/home/agent/.claude.json", "utf8");
    await runtime.configure("claude-code", {
      ...server, config: { ...server.config, env: { B: "b", A: "a" } }
    }, options);
    expect(await fs.readFile("/home/agent/.claude.json", "utf8")).toBe(before);
    await expect(runtime.configure("claude-code", {
      ...server, config: { ...server.config, args: ["different"] }
    }, options)).rejects.toThrow("different configuration");
    await runtime.unconfigure("claude-code", server, options);
    expect(JSON.parse(await fs.readFile("/home/agent/.claude.json", "utf8"))).toEqual({});
  });
});
