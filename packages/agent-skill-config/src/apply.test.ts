import { beforeEach, describe, expect, it } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { configure, unconfigure, UnsupportedAgentError } from "./apply.js";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

describe("configure", () => {
  const homeDir = "/home/test";
  const cwd = "/project";
  let fs: FileSystem;
  let vol: Volume;

  beforeEach(() => {
    ({ fs, vol } = createMemFs());
    vol.mkdirSync(homeDir, { recursive: true });
    vol.mkdirSync(cwd, { recursive: true });
  });

  it("throws UnsupportedAgentError for unknown agent", async () => {
    await expect(configure("invalid", { fs, homeDir, cwd })).rejects.toBeInstanceOf(
      UnsupportedAgentError
    );
  });

  it("creates global skill directory by default and writes bundled skills", async () => {
    await configure("claude-code", { fs, homeDir, cwd });

    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    const content = await fs.readFile(`${homeDir}/.claude/skills/poe-generate.md`, {
      encoding: "utf8"
    });
    expect(content).toContain("name: poe-generate");
    expect(content).toContain("# poe-code generate");
  });

  it("creates local skill directory in cwd and writes bundled skills", async () => {
    await configure("claude-code", { fs, homeDir, cwd, scope: "local" });

    await expect(fs.stat(`${cwd}/.claude/skills`)).resolves.toBeDefined();
    const content = await fs.readFile(`${cwd}/.claude/skills/poe-generate.md`, {
      encoding: "utf8"
    });
    expect(content).toContain("name: poe-generate");
    expect(content).toContain("# poe-code generate");
  });
});

describe("unconfigure", () => {
  const homeDir = "/home/test";
  const cwd = "/project";
  let fs: FileSystem;
  let vol: Volume;

  beforeEach(() => {
    ({ fs, vol } = createMemFs());
    vol.mkdirSync(homeDir, { recursive: true });
    vol.mkdirSync(cwd, { recursive: true });
  });

  it("throws UnsupportedAgentError for unknown agent", async () => {
    await expect(
      unconfigure("unknown", { fs, homeDir, cwd })
    ).rejects.toBeInstanceOf(UnsupportedAgentError);
  });

  it("removes global skill directory by default when force is set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", {
      encoding: "utf8"
    });

    await unconfigure("claude-code", { fs, homeDir, cwd, force: true });

    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("does nothing for non-empty global skill directory without force", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", {
      encoding: "utf8"
    });

    await unconfigure("claude-code", { fs, homeDir, cwd });

    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(fs.readdir(`${homeDir}/.claude/skills`)).resolves.toContain("a.txt");
  });

  it("removes empty global skill directory without force", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });

    await unconfigure("claude-code", { fs, homeDir, cwd });

    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("removes local skill directory in cwd when force is set", async () => {
    vol.mkdirSync(`${cwd}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${cwd}/.claude/skills/a.txt`, "hello", {
      encoding: "utf8"
    });

    await unconfigure("claude-code", { fs, homeDir, cwd, scope: "local", force: true });

    await expect(fs.stat(`${cwd}/.claude/skills`)).rejects.toThrow("ENOENT");
  });
});
