import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("runs a pipeline task and persists its status without Node", async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))], bundle: true,
    write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent" });
  const runtime = runInNewContext(`${bundled.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder, Uint8Array, Error,
    crypto: globalThis.crypto, setTimeout, clearTimeout, AbortController });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/plans", { recursive: true });
  await fs.writeFile("/repo/plans/review.md", new TextEncoder().encode("kind: pipeline\nversion: 1\nsetup: null\nteardown: null\ntasks:\n  - id: review\n    title: Review\n    prompt: Review café.\n    status: open\n"));
  const prompts: string[] = [];
  await runtime.runPipeline({ cwd: "/repo", homeDir: "/home/user", plan: "plans/review.md", agent: "codex", fs, archive: false,
    runAgent: async (input: { prompt: string }) => { prompts.push(input.prompt); return { stdout: "done", stderr: "", exitCode: 0 }; } });
  expect(prompts).toEqual(["Review café."]);
  expect(new TextDecoder().decode(await fs.readFile("/repo/plans/review.md"))).toContain("status: done");
});

it("simulates a pipeline without Node dependencies", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./testing/simulation.ts", import.meta.url))], bundle: true,
    write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent" });
  const runtime = runInNewContext(`${bundle.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder, Uint8Array, Error,
    crypto: globalThis.crypto, setTimeout, clearTimeout, AbortController });
  const simulation = runtime.createPipelineSimulation({ plan: { setup: null, teardown: null, tasks: [
    { id: "review", title: "Review", prompt: "Review", status: "open" }
  ] }, turns: [runtime.successTurn()] });
  expect((await simulation.run()).prompts).toEqual(["Review"]);
});
