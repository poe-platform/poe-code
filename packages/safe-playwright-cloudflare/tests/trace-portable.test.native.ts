import { expect, test } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";

test.each([
  { name: "source", entry: "./src/index.ts", directory: "src" },
  { name: "package export", entry: "@poe-code/safe-playwright-cloudflare", directory: "dist" },
])("$name and trace lifecycle run in workerd without nodejs_compat", async ({ entry, directory }) => {
  const bundle = await build({
    stdin: { resolveDir: new URL("../", import.meta.url).pathname, contents: `
      import { createCloudflarePlaywrightAdapter } from ${JSON.stringify(entry)};
      import { generateBrowserActionCode } from "./${directory}/browser-codegen.js";
      import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
      import { createZipCodec } from "@poe-code/office-package/zip";
      import { writeTraceArchive } from "./${directory}/browser-trace-archive.js";
      import { captureBrowserArtifact } from "./${directory}/browser-artifact.js";
      import { validateTraceLimits } from "./${directory}/browser-trace-budget.js";
      export default { async fetch() {
        const fs = createMemoryFileSystem();
        const adapter = createCloudflarePlaywrightAdapter(undefined, undefined, undefined, { artifactFileSystem: fs });
        await fs.mkdir("/trace");
        await fs.mkdir("/tmp", { recursive: true });
        await fs.writeFile("/trace/文.ts", new TextEncoder().encode("export const café = 42;"));
        await fs.writeFile("/trace/events", new TextEncoder().encode('{"type":"event"}\\n'));
        const admitted = [];
        const bytes = await captureBrowserArtifact(zipFile => writeTraceArchive({ fs, entries: [{ name: "trace.trace", value: "/trace/events" }], zipFile,
          calls: [{ id: 1, stack: [{ file: "/trace/文.ts" }] }], includeSources: true,
          limits: validateTraceLimits({ maxFiles: 4 }), signal: new AbortController().signal,
          admitInput(path) { admitted.push(path); },
        }), { signal: new AbortController().signal, maxBytes: 65536, extension: "zip" }, fs);
        const codec = createZipCodec();
        const limits = { maxArchiveBytes: 65536, maxEntryBytes: 65536, maxTotalBytes: 65536,
          maxMembers: 4, maxPathBytes: 1024, maxDepth: 4, maxPaxBytes: 65536,
          maxTextBytes: 65536, chunkSize: 1024 };
        const signal = new AbortController().signal;
        const archive = await codec.readZipArchive(bytes, limits, signal);
        const contents = {};
        for (const entry of archive.entries) {
          const decoder = new TextDecoder();
          let text = "";
          for await (const chunk of codec.decodeZipEntry(entry, limits, signal)) text += decoder.decode(chunk, { stream: true });
          contents[entry.name] = text + decoder.decode();
        }
        const code = generateBrowserActionCode({ language: "python", action: {
          name: "click", selector: 'internal:role=button[name="Save"s]', button: "left", modifiers: 0, clickCount: 1,
        } });
        const failures = [];
        for (const mode of ["producer", "limit", "abort"]) {
          const abort = new AbortController();
          try {
            await captureBrowserArtifact(async path => {
              await fs.writeFile(path, new TextEncoder().encode("partial"));
              if (mode === "producer") throw new Error("Producer failed");
              if (mode === "abort") abort.abort(new Error("Capture aborted"));
            }, { signal: abort.signal, maxBytes: mode === "limit" ? 1 : 65536, extension: "zip" }, fs);
          } catch (error) { failures.push({ mode, message: error.message, files: await fs.readdir("/tmp") }); }
        }
        return Response.json({ failures, files: await fs.readdir("/tmp"), code, contents, admitted, adapter: typeof adapter.acquire, buffer: typeof globalThis.Buffer, bytes: bytes.length });
      } };
    ` },
    bundle: true, platform: "browser", conditions: ["workerd"], format: "esm", target: "es2022", write: false,
    // The optional browser provider is loaded only when acquiring a browser.
    // Exercise the complete adapter-owned graph without mocking its modules.
    external: ["@cloudflare/playwright", "cloudflare:workers"],
    tsconfigRaw: { compilerOptions: {} },
  });
  const worker = new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: bundle.outputFiles[0]!.text }], compatibilityDate: "2026-07-08" });
  try {
    const response = await worker.dispatchFetch("http://fixture/");
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json() as { failures: { mode: string; message: string; files: string[] }[]; files: string[]; code: string; contents: Record<string, string>; admitted: string[]; adapter: string; buffer: string; bytes: number };
    expect(result.adapter).toBe("function");
    expect(result.code).toBe('page.get_by_role("button", name="Save", exact=True).click()');
    expect(result.buffer).toBe("undefined");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.files).toEqual([]);
    expect(result.failures).toEqual([
      { mode: "producer", message: "Producer failed", files: [] },
      { mode: "limit", message: "Browser artifact byte limit exceeded", files: [] },
      { mode: "abort", message: "Capture aborted", files: [] },
    ]);
    const hash = createHash("sha1").update("/trace/文.ts").digest("hex");
    expect(result.contents).toEqual({
      "trace.trace": '{"type":"event"}\n',
      "trace.stacks": JSON.stringify({ files: ["/trace/文.ts"], stacks: [[1, [[0, 0, 0, ""]]]] }),
      [`resources/src@${hash}.txt`]: "export const café = 42;",
    });
    expect(result.admitted).toEqual(["/trace/events", "/trace/文.ts"]);
  } finally { await worker.dispose(); }
});
