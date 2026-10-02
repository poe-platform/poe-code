import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs";

it("streams Unicode job logs from SafeFS without Node globals", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const result = await build({ entryPoints: [source("./log-stream.ts")], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#harness-tools-filesystem": source("./default-filesystem.workerd.ts") } });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, {
    TextEncoder, TextDecoder, Error, setTimeout, clearTimeout
  });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp/poe-jobs", { recursive: true });
  await fs.writeFile("/tmp/poe-jobs/test.log", new TextEncoder().encode("café 😀"));
  await fs.writeFile("/tmp/poe-jobs/test.exit", new TextEncoder().encode("0"));
  const chunks = [];
  for await (const chunk of runtime.streamLogFile({ fs }, "test", { follow: false })) chunks.push(chunk);
  expect(chunks).toEqual([{ byteOffset: 0, data: "café 😀" }]);
  expect(await runtime.waitForExit({ fs }, "test")).toEqual({ exitCode: 0 });
});

it("resolves workflow paths and stable log directories without Node", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const result = await build({ stdin: { contents: 'export { resolveWorkflowPath } from "./paths.ts"; export { slugifyPlanPath, ensureSafeRunLogDir } from "./run-logs.ts";', resolveDir: source(".") }, bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#harness-tools-filesystem": source("./default-filesystem.workerd.ts") } });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder });
  expect(runtime.resolveWorkflowPath("plans/review.md", "/workspace", "/home/user")).toBe("/workspace/plans/review.md");
  const fs = new MemoryFileSystem();
  const directory = await runtime.ensureSafeRunLogDir({ planPath: "/workspace/review.md", runner: "ralph", homeDir: "/home/user", fs });
  expect(directory).toBe(`/home/user/.poe-code/logs/ralph/${runtime.slugifyPlanPath("/workspace/review.md")}`);
  expect((await fs.stat(directory)).type).toBe("directory");
});

it("discovers and archives plans through SafeFS without Node", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const result = await build({ entryPoints: [source("./plans.ts")], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#harness-tools-filesystem": source("./default-filesystem.workerd.ts") } });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, { crypto: globalThis.crypto, TextEncoder, TextDecoder, Error, setTimeout, clearTimeout });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/workspace/plans", { recursive: true });
  await fs.writeFile("/workspace/plans/review.md", new TextEncoder().encode("---\nkind: ralph\nname: café\nstate: draft\nreadiness: ready\n---\nReview."));
  const options = { cwd: "/workspace", homeDir: "/home/user", planDirectory: "plans", fs };
  expect(await runtime.discoverPlans(options)).toMatchObject([{ id: "review", name: "café", readiness: "ready" }]);
  await runtime.archivePlan({ ...options, id: "review" });
  expect(await runtime.discoverPlans(options)).toEqual([]);
});
