import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";

it("bridges and cleans skills in a Worker bundle with isolated filesystem ownership", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./runtime.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "skills", logLevel: "silent" });
  const runtime = new Function(`${bundle.outputFiles[0].text}; return skills;`)();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/.poe-code/skills/demo", { recursive: true });
  await fs.mkdir("/repo/.git/info", { recursive: true });
  await fs.writeFile("/repo/.poe-code/skills/demo/SKILL.md", new TextEncoder().encode("# Café"));
  const options = { fs, cwd: "/repo", homeDir: "/home/user" };
  const first = await runtime.bridgeActiveSkillsAsync("codex", ["demo"], "same", options);
  const second = await runtime.bridgeActiveSkillsAsync("codex", ["demo"], "same", options);
  expect(new TextDecoder().decode(await fs.readFile("/repo/.codex/skills/demo/SKILL.md"))).toBe("# Café");
  await runtime.cleanupBridgedSkillsAsync(first, options);
  expect((await fs.stat("/repo/.codex/skills/demo")).type).toBe("directory");
  await runtime.cleanupBridgedSkillsAsync(second, options);
  await expect(fs.stat("/repo/.codex/skills/demo")).rejects.toThrow();
  expect(new TextDecoder().decode(await fs.readFile("/repo/.git/info/exclude"))).toBe("");
});
