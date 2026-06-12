import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { assertSafeSkillPath } from "./sync-skills.js";

describe("sync-skills agent templates", () => {
  it("rejects writes through a symlinked skill directory", () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume);
    volume.mkdirSync("/home/.codex", { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.symlinkSync("/outside", "/home/.codex/skills");

    expect(() =>
      assertSafeSkillPath("/home/.codex/skills/poe-code-plan/SKILL.md", "/home", fs)
    ).toThrow("symbolic link");
  });

  it("rejects writes through a symlinked agent config directory", () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume);
    volume.mkdirSync("/home", { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.symlinkSync("/outside", "/home/.codex");

    expect(() =>
      assertSafeSkillPath("/home/.codex/skills/poe-code-plan/SKILL.md", "/home", fs)
    ).toThrow("symbolic link");
  });

  it("allows symlinked filesystem ancestors outside the skill directory", () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume);
    volume.mkdirSync("/private/var/home/.codex/skills", { recursive: true });
    volume.symlinkSync("/private/var", "/var");

    expect(() =>
      assertSafeSkillPath("/var/home/.codex/skills/poe-code-plan/SKILL.md", "/var/home", fs)
    ).not.toThrow();
  });

});
