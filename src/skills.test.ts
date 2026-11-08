import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "./utils/file-system.js";
import { installSkill } from "./skills.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

describe("skills SDK", () => {
  it("installs arbitrary skill content through the public helper", async () => {
    const { fs } = createMemFs();

    const result = await installSkill(
      "codex",
      { name: "poe-agent-tools", content: "# Poe Agent Tools\n" },
      { fs, cwd, homeDir, scope: "local" }
    );

    expect(result).toEqual({
      displayPath: ".codex/skills/poe-agent-tools/SKILL.md",
      skillPath: "/repo/.codex/skills/poe-agent-tools/SKILL.md"
    });
    await expect(
      fs.readFile("/repo/.codex/skills/poe-agent-tools/SKILL.md", "utf8")
    ).resolves.toBe("# Poe Agent Tools\n");
  });

  it("reads skill content from a source file and honors dry-run", async () => {
    const { fs } = createMemFs();
    await fs.mkdir("/repo/.agents/skills/poe-agent-tools", { recursive: true });
    await fs.writeFile(
      "/repo/.agents/skills/poe-agent-tools/SKILL.md",
      "# Poe Agent Tools\n",
      "utf8"
    );

    const result = await installSkill(
      "codex",
      {
        name: "poe-agent-tools",
        file: ".agents/skills/poe-agent-tools/SKILL.md"
      },
      { fs, cwd, homeDir, scope: "local", dryRun: true }
    );

    expect(result.displayPath).toBe(".codex/skills/poe-agent-tools/SKILL.md");
    await expect(
      fs.stat("/repo/.codex/skills/poe-agent-tools/SKILL.md")
    ).rejects.toThrow("ENOENT");
  });
});
