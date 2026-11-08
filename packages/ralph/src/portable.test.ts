import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("runs and updates a Ralph plan through SafeFS without Node", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))], bundle: true,
    write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent" });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder, Uint8Array, Error,
    crypto: globalThis.crypto, setTimeout, clearTimeout, AbortController });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/plans", { recursive: true });
  await fs.writeFile("/repo/plans/review.md", new TextEncoder().encode("---\nkind: ralph\nagent: codex\niterations: 1\n---\nReview café."));
  const prompts: string[] = [];
  const resultRun = await runtime.runRalph({ cwd: "/repo", homeDir: "/home/user", docPath: "plans/review.md", fs,
    archive: false, runAgent: async (input: { prompt: string }) => { prompts.push(input.prompt); return { stdout: "done", stderr: "", exitCode: 0 }; } });
  expect(resultRun.iterationsCompleted).toBe(1);
  expect(prompts[0]).toContain("Review café.");
  expect(new TextDecoder().decode(await fs.readFile("/repo/plans/review.md"))).toContain("iteration: 1");
});

it("runs simulations without Node or memfs", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("./testing/index.ts", import.meta.url))], bundle: true,
    write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "runtime", logLevel: "silent" });
  const runtime = runInNewContext(`${result.outputFiles[0].text}; runtime`, { TextEncoder, TextDecoder, Uint8Array, Error,
    crypto: globalThis.crypto, setTimeout, clearTimeout, AbortController });
  const simulation = runtime.createRalphSimulation({ agent: "codex", maxIterations: 1, archive: false, turns: [runtime.successTurn()] });
  expect((await simulation.run()).result.iterationsCompleted).toBe(1);
});
