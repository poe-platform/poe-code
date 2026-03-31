import { describe, it, expect, beforeEach } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import { runMutations } from "./run-mutations.js";
import { fileMutation } from "../mutations/file-mutation.js";
import type { FileSystem } from "../types.js";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

describe("fileMutation.removeDirectory", () => {
  const homeDir = "/home/test";
  let fs: FileSystem;
  let vol: Volume;

  beforeEach(() => {
    ({ fs, vol } = createMemFs());
    vol.mkdirSync(homeDir, { recursive: true });
  });

  it("returns changed false for non-empty dir when force is not set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", {
      encoding: "utf8"
    });

    const result = await runMutations(
      [fileMutation.removeDirectory({ path: "~/.claude/skills" })],
      { fs, homeDir }
    );

    expect(result.changed).toBe(false);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(fs.readdir(`${homeDir}/.claude/skills`)).resolves.toContain("a.txt");
  });

  it("removes directory and contents when force is set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await fs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", {
      encoding: "utf8"
    });

    const result = await runMutations(
      [fileMutation.removeDirectory({ path: "~/.claude/skills", force: true })],
      { fs, homeDir }
    );

    expect(result.changed).toBe(true);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("removes empty directory when force is not set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });

    const result = await runMutations(
      [fileMutation.removeDirectory({ path: "~/.claude/skills" })],
      { fs, homeDir }
    );

    expect(result.changed).toBe(true);
    await expect(fs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });
});

