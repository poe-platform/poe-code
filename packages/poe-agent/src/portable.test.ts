import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import type { PluginApi } from "./runtime/plugin-types.js";
import { toAcpModelResponse } from "./testing/model-response.js";

it("runs an agent over portable storage without Node compatibility", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "agentRuntime", logLevel: "silent" });
  const runtime = new Function(`${bundle.outputFiles[0].text}; return agentRuntime;`)();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/home", { recursive: true });
  await fs.writeFile("/repo/sample.txt", new TextEncoder().encode("Café needle"));
  const results: unknown[] = [];
  await runtime.agent({ fs, cwd: "/repo", homeDir: "/repo/home" })
    .use(runtime.filesPlugin())
    .use({ name: "inspect", async setup(api: PluginApi) {
      const ctx = { runtime: api.runtime, signal: api.signal, fork: vi.fn(), spawn: vi.fn() };
      for (const [name, args] of [
        ["read_file", { path: "sample.txt" }],
        ["glob", { pattern: "**/*.txt" }],
        ["grep", { pattern: "needle", path: "sample.txt", line_numbers: true }]
      ] as const) results.push((await api.getTool(name)!.invoke(args, ctx).next()).value);
    } })
    .run("Inspect", { logPath: "/repo/transcript.jsonl", acpModel: { complete: async () => toAcpModelResponse({ content: "done" }) } });
  expect(results).toEqual(["Café needle", "sample.txt", "sample.txt:1:Café needle"]);
  expect((await fs.stat("/repo/transcript.jsonl")).type).toBe("file");
  const web = runtime.webPlugin({ fetch: async () => new Response("<h1>Café</h1><p>Portable page</p>", { headers: { "content-type": "text/html" } }) });
  const fetched = await web.tools.find((tool: { name: string }) => tool.name === "fetch_url").call({ url: "https://example.com" }, { signal: new AbortController().signal });
  expect(fetched).toContain("# Café");
});
