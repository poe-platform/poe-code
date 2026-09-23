import { expect, it } from "vitest";
import { createMemoryFileSystem, createNodeFsBridge } from "@poe-code/safe-fs";
import { installSkill, type InstallSkillFileSystem } from "./skills.js";

it("installs skill content with a canonical safe-fs provider or its supported Node bridge", async () => {
  const fs = createMemoryFileSystem();
  const bridge: InstallSkillFileSystem = createNodeFsBridge(fs, { cwd: "/" });
  expect(typeof bridge.unlink).toBe("function");
  await installSkill(
    "claude",
    { name: "demo", content: "---\nname: demo\ndescription: Virtual skill\n---\n# Demo" },
    { fs, cwd: "/workspace", homeDir: "/home" }
  );
  expect(
    new TextDecoder().decode(await fs.readFile("/workspace/.claude/skills/demo/SKILL.md"))
  ).toContain("# Demo");
});
