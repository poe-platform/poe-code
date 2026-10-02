import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("runs a superintendent plan on portable storage without Node compatibility", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./loop.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "superintendent", logLevel: "silent" });
  const runtime = new Function(`${bundle.outputFiles[0].text}; return superintendent;`)();
  const fs = new MemoryFileSystem();
  const document = ["---", "kind: superintendent", "version: 1", "builder:", "  agent: codex", "  prompt: Build café",
    "superintendent:", "  agent: codex", "  prompt: Review", "owner:", "  agent: codex", "  prompt: Approve",
    "status:", "  state: in_progress", "  round: 0", "  review_turn: 0", "---", "## Task Board", "- [ ] Build café"].join("\n");
  await fs.mkdir("/repo", { recursive: true });
  await fs.writeFile("/repo/plan.md", new TextEncoder().encode(document));
  const prompts: string[] = [];
  const result = await runtime.runLoop({ fs, cwd: "/repo", homeDir: "/home/test", docPath: "plan.md", runAgent: async (input: { prompt: string }) => {
    prompts.push(input.prompt);
    await fs.writeFile("/repo/plan.md", new TextEncoder().encode(document.replace("state: in_progress", "state: completed")));
    return { stdout: "Built café", stderr: "", exitCode: 0 };
  } });
  expect(result.stopReason).toBe("completed");
  expect(prompts).toEqual(["Build café"]);
  expect(await fs.readdir("/repo")).toEqual([{ name: "plan.md", type: "file" }]);
});
