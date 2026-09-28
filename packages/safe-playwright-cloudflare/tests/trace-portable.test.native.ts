import { expect, test } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("trace archive runs in workerd without nodejs_compat", async () => {
  const bundle = await build({
    stdin: { resolveDir: new URL("../", import.meta.url).pathname, contents: `
      import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
      import { writeTraceArchive } from "./src/browser-trace-archive.ts";
      import { validateTraceLimits } from "./src/browser-trace-budget.ts";
      export default { async fetch() {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/trace");
        await fs.writeFile("/trace/source.ts", new TextEncoder().encode("export const answer = 42;"));
        await writeTraceArchive({ fs, entries: [], zipFile: "/trace/archive.zip",
          calls: [{ id: 1, stack: [{ file: "/trace/source.ts" }] }], includeSources: true,
          limits: validateTraceLimits({ maxFiles: 4 }), signal: new AbortController().signal,
          admitInput() {},
        });
        return Response.json({ buffer: typeof globalThis.Buffer, bytes: (await fs.readFile("/trace/archive.zip")).length });
      } };
    ` },
    bundle: true, platform: "browser", format: "esm", target: "es2022", write: false,
    tsconfigRaw: { compilerOptions: {} },
  });
  const worker = new Miniflare({ modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: "2026-07-08" });
  try {
    const response = await worker.dispatchFetch("http://fixture/");
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json() as { buffer: string; bytes: number };
    expect(result.buffer).toBe("undefined");
    expect(result.bytes).toBeGreaterThan(0);
  } finally { await worker.dispose(); }
});
