import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

import { appendExcludeBlock, removeExcludeBlock, setGitDirRunnerForTest } from "./git-exclude.js";

const cwd = "/repo";
const gitDir = "/repo/.git";
const excludePath = path.join(gitDir, "info/exclude");

function stubGitRepo(): () => void {
  return setGitDirRunnerForTest(() => gitDir);
}

describe("git exclude blocks", () => {
  let restoreRunner: () => void;

  beforeEach(() => {
    restoreRunner?.();
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    restoreRunner = stubGitRepo();
  });

  afterEach(() => {
    restoreRunner?.();
  });

  it("appends to a fresh exclude file and preserves pre-existing content", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "# user ignore\n.DS_Store\n");

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# user ignore",
        ".DS_Store",
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("creates the exclude file when it does not exist", () => {
    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("uses an optional marker prefix for sibling bridge features", () => {
    appendExcludeBlock(cwd, "run-1", [".codex/hooks.json"], "poe-code-spawn-hooks");

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-hooks:run-1 begin",
        ".codex/hooks.json",
        "# poe-code-spawn-hooks:run-1 end",
        ""
      ].join("\n")
    );

    removeExcludeBlock(cwd, "run-1", "poe-code-spawn-hooks");
    expect(vol.readFileSync(excludePath, "utf8")).toBe("");
  });

  it("resolves relative git dirs from cwd", () => {
    restoreRunner();
    restoreRunner = setGitDirRunnerForTest(() => ".git");

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("separates appended blocks from content without a final newline", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "node_modules/");

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "node_modules/",
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("appends when another run block is present so both coexist", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(
      excludePath,
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );

    appendExcludeBlock(cwd, "run-2", [".poe-code/skills/run-2"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        ""
      ].join("\n")
    );
  });

  it("removes this run block while leaving other run blocks intact", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(
      excludePath,
      [
        "# user ignore",
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        "node_modules/",
        ""
      ].join("\n")
    );

    removeExcludeBlock(cwd, "run-1");

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# user ignore",
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        "node_modules/",
        ""
      ].join("\n")
    );
  });

  it("is idempotent when removing an already removed block", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(
      excludePath,
      [
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        ""
      ].join("\n")
    );

    removeExcludeBlock(cwd, "run-1");
    removeExcludeBlock(cwd, "run-1");

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        ""
      ].join("\n")
    );
  });

  it("silently no-ops outside a git repo", () => {
    restoreRunner();
    restoreRunner = setGitDirRunnerForTest(() => undefined);

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);
    removeExcludeBlock(cwd, "run-1");

    expect(vol.existsSync(gitDir)).toBe(false);
  });
});
