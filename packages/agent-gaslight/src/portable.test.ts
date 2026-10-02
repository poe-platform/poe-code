import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("runs and archives a Gaslight plan using an injected portable filesystem", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "gaslight", logLevel: "silent" });
  const runtime = new Function(`${bundle.outputFiles[0].text}; return gaslight;`)();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/plans", { recursive: true });
  await fs.writeFile("/repo/plans/plan.md", new TextEncoder().encode("---\nkind: plan\n---\nReview café."));
  const prompts: string[] = [];
  const result = await runtime.runGaslight({ cwd: "/repo", homeDir: "/home/user", fs,
    planPaths: ["plans/plan.md"], agent: "codex", prompt: "Review", followups: ["Check tests"], archive: true,
    spawn: async (_agent: string, options: { prompt: string }) => { prompts.push(options.prompt); return { stdout: "done", stderr: "", exitCode: 0, threadId: "portable-thread" }; } });
  expect(prompts).toHaveLength(2);
  expect(result.plans[0].archivedPath).toBeTruthy();
  await expect(fs.stat("/repo/plans/plan.md")).rejects.toThrow();
  const ingested = await runtime.ingestGaslight({ cwd: "/repo", homeDir: "/home/user", fs, analysisAgent: "codex",
    collectHumanPrompts: async () => ({ traceCount: 1, records: [{ traceId: "one", source: "codex", text: "Review café." }] }),
    spawn: async () => ({ stdout: "prompt: Implement\nfollowups:\n  - Check it\n", stderr: "", exitCode: 0 }) });
  expect(ingested.promptCount).toBe(1);
  const config = await runtime.loadGaslightConfig("/repo", "/home/user", fs);
  expect(config.followups).toEqual(["Check it"]);
  expect(await fs.readdir("/repo/.poe-code/ingest")).toEqual([]);
});
