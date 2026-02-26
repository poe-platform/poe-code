import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveTemplate } from "./resolver.js";

type FileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
};

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("resolveTemplate", () => {
  it("resolves from project directory first", async () => {
    const fs = createMemFs({
      "/project/.agents/poe-code-ralph/PROMPT_verify.md": "project template",
      "/home/.poe-code/ralph/PROMPT_verify.md": "home template",
      "/bundled/PROMPT_verify.md": "bundled template"
    });

    const content = await resolveTemplate("PROMPT_verify.md", {
      fs,
      cwd: "/project",
      homeDir: "/home",
      bundledDir: "/bundled"
    });

    expect(content).toBe("project template");
  });

  it("falls back to user home when not in project", async () => {
    const fs = createMemFs({
      "/home/.poe-code/ralph/PROMPT_verify.md": "home template",
      "/bundled/PROMPT_verify.md": "bundled template"
    });

    const content = await resolveTemplate("PROMPT_verify.md", {
      fs,
      cwd: "/project",
      homeDir: "/home",
      bundledDir: "/bundled"
    });

    expect(content).toBe("home template");
  });

  it("falls back to bundled when not in project or home", async () => {
    const fs = createMemFs({
      "/bundled/PROMPT_verify.md": "bundled template"
    });

    const content = await resolveTemplate("PROMPT_verify.md", {
      fs,
      cwd: "/project",
      homeDir: "/home",
      bundledDir: "/bundled"
    });

    expect(content).toBe("bundled template");
  });

  it("returns null when template not found anywhere", async () => {
    const fs = createMemFs({});

    const content = await resolveTemplate("PROMPT_missing.md", {
      fs,
      cwd: "/project",
      homeDir: "/home",
      bundledDir: "/bundled"
    });

    expect(content).toBeNull();
  });

  it("skips home directory when homeDir is not provided", async () => {
    const fs = createMemFs({
      "/bundled/PROMPT_verify.md": "bundled template"
    });

    const content = await resolveTemplate("PROMPT_verify.md", {
      fs,
      cwd: "/project",
      bundledDir: "/bundled"
    });

    expect(content).toBe("bundled template");
  });
});
