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
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, { crypto: globalThis.crypto, TextEncoder, TextDecoder, Error, AbortController, setTimeout, clearTimeout });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/workspace/plans", { recursive: true });
  await fs.writeFile("/workspace/plans/review.md", new TextEncoder().encode("---\nkind: ralph\nname: café\nstate: draft\nreadiness: ready\n---\nReview."));
  const options = { cwd: "/workspace", homeDir: "/home/user", planDirectory: "plans", fs };
  expect(await runtime.discoverPlans(options)).toMatchObject([{ id: "review", name: "café", readiness: "ready" }]);
  await runtime.archivePlan({ ...options, id: "review" });
  expect(await runtime.discoverPlans(options)).toEqual([]);
});

it("resolves command execution from an injected config filesystem without Node", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const result = await build({ stdin: { contents: 'export { resolvePoeCommandExecution } from "./poe-command-execution.ts"; export { registerExecutionEnvFactory } from "./execution-env.ts";', resolveDir: source(".") }, bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#harness-tools-filesystem": source("./default-filesystem.workerd.ts"), "#harness-tools-state": source("./default-state.workerd.ts") } });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder, Error });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/.poe-code", { recursive: true });
  await fs.writeFile("/repo/.poe-code/config.json", new TextEncoder().encode(JSON.stringify({ runtime: { type: "docker", image: "test:portable", runner: { detach: true } } })));
  runtime.registerExecutionEnvFactory({ type: "docker", supportsDetach: true });
  const state = {};
  const execution = await runtime.resolvePoeCommandExecution({ cwd: "/repo", env: {}, argv: ["agent"], tool: "test", context: { homeDir: "/home/user", fs, state } });
  expect(execution.detach).toBe(true);
  expect(execution.openSpec.runtime.image).toBe("test:portable");
  expect(execution.state).toBe(state);
});

it("runs an injected command lifecycle with Web Crypto job IDs", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const bundle = await build({ entryPoints: [source("./run-poe-command.ts")], bundle: true, write: false,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent",
    alias: { "#harness-tools-filesystem": source("./default-filesystem.workerd.ts") } });
  const runtime = runInNewContext(`${bundle.outputFiles[0].text}; runtime`, { crypto: globalThis.crypto, TextEncoder, TextDecoder, Error, AbortController, setTimeout, clearTimeout });
  const jobs = new Map<string, unknown>();
  const state = { jobs: { put: async (job: { id: string }) => { jobs.set(job.id, job); }, update: async () => {} } };
  let closed = false;
  const factory = { type: "host", open: async () => ({ id: "remote", uploadWorkspace: async () => {},
    exec: () => ({ stdout: null, stderr: null, stdin: null, result: Promise.resolve({ exitCode: 0 }), kill() {} }),
    downloadWorkspace: async () => ({ files: 0, bytes: 0, conflicts: [] }), close: async () => { closed = true; } }) };
  const result = await runtime.runPoeCommand({ factory, state, detach: false, openSpec: { cwd: "/repo", env: {}, runtime: { type: "host" }, jobLabel: { tool: "test", argv: ["test"] }, execution: { wrapForLogTee: false } } });
  expect(result).toMatchObject({ kind: "sync", exitCode: 0 });
  expect([...jobs.keys()][0]).toHaveLength(26);
  expect(closed).toBe(true);
});

it("bundles the complete public runtime without Node dependencies", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent" });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder, Uint8Array, crypto: globalThis.crypto });
  expect(runtime.uploadWorkspace).toBeTypeOf("function");
  expect(runtime.createHarnessDashboard).toBeTypeOf("function");
  expect(runtime.resolvePoeCommandExecution).toBeTypeOf("function");
});
